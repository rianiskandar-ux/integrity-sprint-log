import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { userSettings, agentEvents } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'
import { rebuildCache } from '@/lib/op-cache'
import { generateSprintSummary } from '@/lib/sprint-summary'
import { listSummaries, saveSummary } from '@/lib/sprint-summary-store'
import { getOpBaseUrl } from '@/lib/user-config'

export const runtime = 'nodejs'

const KAFI_KEY = process.env.KAFI_API_KEY
const DEFAULT_PROJECTS = ['integritys-websites', 'know-your-vendor-kyv', 'scrum-project']

// POST /api/internal/sprint-summary?key=<kafi-key>&uid=<uid>
//
// Root cause of the 2026-08-05 "forgot to save Sprint #120" report: the recap
// only ever got saved via a human clicking Generate → Save on the Agenda tab,
// and there's no natural moment that reminds anyone to do it — by the time the
// NEXT sprint starts, the Agenda tab has already moved on to it and the one
// that just ended is easy to forget. This closes that gap structurally: run
// daily (Task Scheduler, same pattern as ISL Watchdog/Git-Capture), and the
// idempotency check below means it's a no-op every day except the one day
// after a sprint actually ends.
//
// Deliberately NOT "whenever a sprint starts" event-driven — ISL has no sprint
// webhook from OP, so a cheap daily poll + skip-if-already-saved is the
// simplest reliable trigger, same shape as Kafi's daily digest.
export async function POST(req: Request) {
  const url = new URL(req.url)
  const key = req.headers.get('x-kafi-key') ?? url.searchParams.get('key')
  if (key !== KAFI_KEY) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const uid = Number(url.searchParams.get('uid') ?? 1)
  if (!uid || uid < 1) return NextResponse.json({ error: 'invalid uid' }, { status: 400 })

  const rows = await db.select().from(userSettings).where(eq(userSettings.userId, uid)).limit(1)
  const row = rows[0]
  if (!row) return NextResponse.json({ error: `no user_settings for uid=${uid}` }, { status: 404 })

  const opToken = row.opApiToken ? decrypt(row.opApiToken) : ''
  if (!opToken) return NextResponse.json({ error: 'no op token for user' }, { status: 422 })

  const opUserId  = row.opUserId ?? 0
  const opBaseUrl = getOpBaseUrl() || process.env.OP_BASE_URL || 'https://tokek.integrity-asia.com'
  const projects  = (row.watchedProjects as string[] | null)?.length ? (row.watchedProjects as string[]) : DEFAULT_PROJECTS

  // Refresh first — this job's whole premise is "don't rely on someone having
  // opened ISL recently", so it can't rely on a possibly-stale cache either.
  let cache
  try {
    cache = await rebuildCache(opToken, opBaseUrl, projects, opUserId, row.opUserName ?? undefined, uid)
  } catch (e) {
    return NextResponse.json({ error: `OP sync failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }

  const currentSprint = (cache.sprints ?? []).find(s => s.isCurrent)
  if (!currentSprint) return NextResponse.json({ ok: true, skipped: 'no current sprint' })

  const previousSprint = (cache.sprints ?? [])
    .filter(s => s.endDate < currentSprint.startDate)
    .sort((a, b) => b.endDate.localeCompare(a.endDate))[0]
  if (!previousSprint) return NextResponse.json({ ok: true, skipped: 'no previous sprint in cache window' })

  const already = listSummaries(uid).some(s => s.sprint === previousSprint.name)
  if (already) return NextResponse.json({ ok: true, skipped: 'already saved', sprint: previousSprint.name })

  const result = await generateSprintSummary({ opToken, opBaseUrl, uid, opUserId, sprintId: previousSprint.id })
  if (!result.aiSummary) {
    return NextResponse.json({ ok: false, error: result.error ?? 'AI returned no summary', sprint: previousSprint.name }, { status: 502 })
  }

  saveSummary(uid, { sprint: previousSprint.name, summary: result.aiSummary, savedAt: new Date().toISOString() })

  await db.insert(agentEvents).values({
    id:    `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    agent: 'sage',
    event: 'sprint_summary_saved',
    meta:  { sprint: previousSprint.name, uid },
  }).catch(() => { /* best-effort — the summary itself is already saved */ })

  return NextResponse.json({ ok: true, saved: previousSprint.name })
}
