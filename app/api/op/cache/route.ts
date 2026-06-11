import { getOpToken, getOpBaseUrl, loadUserConfig } from '@/lib/user-config'
import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { loadCache, rebuildCache } from '@/lib/op-cache'
import { getTelegramConfig, sendTelegram, notifIncoming, notifSprintDeadline } from '@/lib/telegram'

const DATA_DIR  = process.env.CACHE_DATA_DIR ?? process.cwd()
const MODE_FILE = path.join(DATA_DIR, 'op-mode.json')

function readMode() {
  try { return JSON.parse(fs.readFileSync(MODE_FILE, 'utf-8')) } catch { return null }
}

// GET — return current cache
export async function GET() {
  return NextResponse.json(loadCache())
}

// POST — rebuild cache
// Body (all optional, falls back to op-mode.json config):
//   { projects?: string[], userId?: number, userName?: string }
export async function POST(req: Request) {
  const body  = await req.json().catch(() => ({}))
  const token = process.env.OP_API_TOKEN
  const base  = process.env.OP_BASE_URL

  if (!token || !base) return NextResponse.json({ error: 'OP not configured' }, { status: 500 })

  // Resolve userId + projects from: request body → op-mode.json → defaults
  const mode     = readMode()
  const userId: number   = body.userId   ?? mode?.userId   ?? 8
  const userName: string = body.userName ?? mode?.userName ?? ''

  // watchedProjects: from body, or from mode, or fallback defaults
  const projects: string[] = body.projects
    ?? mode?.watchedProjects
    ?? ['integritys-websites', 'know-your-vendor-kyv', 'scrum-project']

  // Persist watchedProjects + userId back to op-mode.json so server-side scripts use them too
  try {
    const existing = mode ?? {}
    fs.writeFileSync(MODE_FILE, JSON.stringify({
      ...existing,
      userId,
      userName,
      watchedProjects: projects,
      updatedAt: new Date().toISOString(),
    }, null, 2))
  } catch { /* non-fatal */ }

  try {
    const prevCache = loadCache()
    const prevIncoming = ((prevCache.incomingTasks ?? []) as { islStatus?: string }[])
      .filter(t => t.islStatus !== 'done' && t.islStatus !== 'rejected').length

    const cache = await rebuildCache(token, base, projects, userId, userName)

    // Telegram notifications — fire and forget
    const tg = getTelegramConfig()
    if (tg) {
      const newIncoming = ((cache.incomingTasks ?? []) as { islStatus?: string; id: number; subject: string }[])
        .filter(t => t.islStatus !== 'done' && t.islStatus !== 'rejected')
      const newCount = newIncoming.length - prevIncoming

      // Notify new incoming tasks
      if (newCount > 0) {
        sendTelegram(notifIncoming(newCount, newIncoming.slice(-newCount).map(t => ({ id: t.id, subject: t.subject })))).catch(() => {})
      }

      // Notify sprint deadline (1d and 3d warnings)
      const sprint = (cache.sprints ?? []).find((s: { isCurrent: boolean }) => s.isCurrent) as { name: string; endDate: string } | undefined
      if (sprint) {
        const daysLeft = Math.ceil((new Date(sprint.endDate).getTime() - Date.now()) / 86400000)
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

    return NextResponse.json({ ok: true, ...cache })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
