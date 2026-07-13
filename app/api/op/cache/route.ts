import { getOpBaseUrl } from '@/lib/user-config'
import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { loadCache, rebuildCache } from '@/lib/op-cache'
import { getTelegramConfig, sendTelegram, notifIncoming, notifSprintDeadline } from '@/lib/telegram'
import { getRequestContext } from '@/lib/request-auth'
import { isOwnerUid } from '@/lib/auth'
import { db } from '@/lib/db'
import { userSettings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export const runtime = 'nodejs'

const DATA_DIR  = process.env.CACHE_DATA_DIR ?? process.cwd()
const MODE_FILE = path.join(DATA_DIR, 'op-mode.json')

function readMode() {
  try { return JSON.parse(fs.readFileSync(MODE_FILE, 'utf-8')) } catch { return null }
}

// GET — return current user's cache + server-side config for frontend
export async function GET() {
  const ctx = await getRequestContext()
  const cache = loadCache(ctx?.uid)
  const opUrl = getOpBaseUrl() || 'https://tokek.integrity-asia.com'
  return NextResponse.json({
    ...cache,
    _opUrl:  opUrl,
    _userId: ctx?.opUserId ?? (cache.userId ?? null),
  })
}

// POST — rebuild cache for the logged-in user using their own OP token
// Body (all optional, falls back to userSettings → op-mode.json → defaults):
//   { projects?: string[], userId?: number, userName?: string }
export async function POST(req: Request) {
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { opToken: token, opBaseUrl: base, uid, opUserId } = ctx

  // Always read this user's settings row (for userName + fallback projects)
  const rows = await db.select().from(userSettings).where(eq(userSettings.userId, uid)).limit(1)
  const row = rows[0]
  const userName = row?.opUserName ?? ''

  // Resolve watchedProjects: request body → userSettings row. The op-mode.json /
  // hardcoded fallback is OWNER-ONLY — it is the owner's own project list, and
  // letting non-owners fall through to it meant every new teammate's cache got
  // built against the owner's project selection.
  let projects: string[] = body.projects ?? null
  if (projects?.length) {
    // Persist the explicit selection so the next rebuild (auto-sync sends no
    // body) uses THEIR list — watched projects were localStorage-only before,
    // so they never survived a browser change and the DB column stayed empty.
    await db.update(userSettings).set({ watchedProjects: projects, updatedAt: new Date() })
      .where(eq(userSettings.userId, uid)).catch(() => {})
  }
  if (!projects?.length && row?.watchedProjects?.length) projects = row.watchedProjects as string[]
  if (!projects?.length) {
    if (isOwnerUid(uid)) {
      const mode = readMode()
      projects = mode?.watchedProjects ?? ['integritys-websites', 'know-your-vendor-kyv', 'scrum-project']
    } else {
      projects = []  // teammate with nothing configured: pick projects in Settings first
    }
  }

  // SECURITY: ignore client-supplied body.userId — always use the session's OP user id.
  // A fresh browser's localStorage defaults to Rian (userId=8); trusting it would fetch his tasks.
  const resolvedUserId: number = opUserId
  const resolvedUserName: string = userName || body.userName || ''

  try {
    const prevCache = loadCache(uid)
    const prevIncoming = ((prevCache.incomingTasks ?? []) as { islStatus?: string }[])
      .filter(t => t.islStatus !== 'done' && t.islStatus !== 'rejected').length

    const cache = await rebuildCache(token, base, projects, resolvedUserId, resolvedUserName, uid)

    // Telegram notifications — fire and forget
    const tg = getTelegramConfig()
    if (tg) {
      const newIncoming = ((cache.incomingTasks ?? []) as { islStatus?: string; id: number; subject: string }[])
        .filter(t => t.islStatus !== 'done' && t.islStatus !== 'rejected')
      const newCount = newIncoming.length - prevIncoming

      if (newCount > 0) {
        sendTelegram(notifIncoming(newCount, newIncoming.slice(-newCount).map(t => ({ id: t.id, subject: t.subject })))).catch(() => {})
      }

      const sprint = (cache.sprints ?? []).find((s: { isCurrent: boolean }) => s.isCurrent) as { name: string; endDate: string } | undefined
      if (sprint) {
        const daysLeft = Math.max(0, Math.floor((new Date(sprint.endDate).getTime() - Date.now()) / 86400000))
        const myOpen   = ((cache.myOpenTasks ?? []) as { sprintId?: number | null; id?: number }[])
        const myClosed = ((cache.myClosedTasks ?? []) as { sprintId?: number | null; id?: number }[])
        const currentSprintId = (cache.sprints ?? []).find((s: { isCurrent: boolean }) => s.isCurrent)?.id
        const done  = myClosed.filter(t => t.sprintId === currentSprintId).length
        const open  = myOpen.filter(t => t.sprintId === currentSprintId).length
        const pct   = done + open > 0 ? Math.round(done / (done + open) * 100) : 0
        if (daysLeft === 1 || daysLeft === 3) {
          sendTelegram(notifSprintDeadline(sprint.name, daysLeft, pct), tg).catch(() => {})
        }
      }
    }

    // Fire status-sync after cache rebuild (fire-and-forget)
    fetch(`${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/api/op/status-sync`).catch(() => {})

    return NextResponse.json({ ok: true, ...cache })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
