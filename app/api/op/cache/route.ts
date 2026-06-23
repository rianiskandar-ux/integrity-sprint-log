import { getOpBaseUrl } from '@/lib/user-config'
import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { loadCache, rebuildCache } from '@/lib/op-cache'
import { getTelegramConfig, sendTelegram, notifIncoming, notifSprintDeadline } from '@/lib/telegram'
import { getRequestContext } from '@/lib/request-auth'
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

  // Resolve watchedProjects from: request body → userSettings → op-mode.json → defaults
  let projects: string[] = body.projects ?? null
  let userName = ''

  if (!projects) {
    // Try to get from userSettings
    const rows = await db.select().from(userSettings).where(eq(userSettings.userId, uid)).limit(1)
    const row = rows[0]
    if (row?.watchedProjects?.length) projects = row.watchedProjects as string[]
    userName = row?.opUserName ?? ''
  }

  if (!projects) {
    const mode = readMode()
    projects = mode?.watchedProjects ?? ['integritys-websites', 'know-your-vendor-kyv', 'scrum-project']
  }

  const resolvedUserId: number = body.userId ?? opUserId
  const resolvedUserName: string = body.userName ?? userName

  try {
    const prevCache = loadCache(uid)
    const prevIncoming = ((prevCache.incomingTasks ?? []) as { islStatus?: string }[])
      .filter(t => t.islStatus !== 'done' && t.islStatus !== 'rejected').length

    const cache = await rebuildCache(token, base, projects, resolvedUserId, resolvedUserName)

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
        const myOpen   = ((cache.myOpenTasks ?? []) as { versionId?: number | null; id?: number }[])
        const myClosed = ((cache.myClosedTasks ?? []) as { versionId?: number | null; id?: number }[])
        const sprintId = (cache.sprints ?? []).find((s: { isCurrent: boolean }) => s.isCurrent)?.id
        const done  = myClosed.filter(t => t.versionId === sprintId).length
        const open  = myOpen.filter(t => t.versionId === sprintId).length
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
