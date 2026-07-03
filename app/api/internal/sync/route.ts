import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { userSettings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'
import { rebuildCache } from '@/lib/op-cache'
import { getOpBaseUrl } from '@/lib/user-config'

export const runtime = 'nodejs'

const KAFI_KEY = process.env.KAFI_API_KEY || 'kafi-bridge-2026'

// POST /api/internal/sync?key=<kafi-key>
// Triggers OP cache rebuild for a given uid without requiring browser session.
// Intended for: manual trigger from host/Launcher when UI sync is inaccessible.
export async function POST(req: Request) {
  const url = new URL(req.url)
  const key = req.headers.get('x-kafi-key') ?? url.searchParams.get('key')
  if (key !== KAFI_KEY) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const uid = Number(url.searchParams.get('uid') ?? 1)
  if (!uid || uid < 1) return NextResponse.json({ error: 'invalid uid' }, { status: 400 })

  const rows = await db.select().from(userSettings).where(eq(userSettings.userId, uid)).limit(1)
  const row = rows[0]
  if (!row) return NextResponse.json({ error: `no user_settings for uid=${uid}` }, { status: 404 })

  const rawToken = row.opApiToken ?? ''
  const opToken  = rawToken ? decrypt(rawToken) : ''
  if (!opToken) return NextResponse.json({ error: 'no op token for user' }, { status: 422 })

  const opUserId  = row.opUserId ?? 0
  const userName  = row.opUserName ?? ''
  const opBaseUrl = getOpBaseUrl() || process.env.OP_BASE_URL || 'https://tokek.integrity-asia.com'

  let projects: string[] = (row.watchedProjects as string[] | null) ?? []
  if (!projects.length) projects = ['integritys-websites', 'know-your-vendor-kyv', 'scrum-project']

  try {
    const cache = await rebuildCache(opToken, opBaseUrl, projects, opUserId, userName, uid)
    return NextResponse.json({
      ok: true,
      uid,
      opUserId,
      lastSync: cache.lastSync,
      sprintCount: (cache.sprints ?? []).length,
      openTaskCount: (cache.myOpenTasks ?? []).length,
      incomingCount: (cache.incomingTasks ?? []).length,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
