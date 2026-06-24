import { NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/request-auth'
import { getTimer, startTimer, stopTimer } from '@/lib/work-timer'
import { updateSession } from '@/lib/session-store'
import { OWNER_UID } from '@/lib/auth'

export const runtime = 'nodejs'

// Resolve the acting user id from either the browser session cookie OR a local
// timer key header (for the `isl` terminal command, which has no browser cookie).
// The key path maps to the instance owner — fine for a personal Model-B instance.
async function resolveUid(req: Request): Promise<number | null> {
  const key = req.headers.get('x-isl-timer-key')
  const expected = process.env.ISL_TIMER_KEY || process.env.ISL_ENCRYPTION_KEY || ''
  if (key && expected && key === expected) return OWNER_UID
  const ctx = await getRequestContext()
  return ctx?.uid ?? null
}

export async function GET(req: Request) {
  const uid = await resolveUid(req)
  if (uid == null) return NextResponse.json({ timer: null })
  return NextResponse.json({ timer: getTimer(uid) })
}

// POST { action: 'start'|'stop', taskTitle?, sessionId?, opTaskId? }
export async function POST(req: Request) {
  const uid = await resolveUid(req)
  if (uid == null) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))

  if (body.action === 'start') {
    const timer = startTimer(uid, {
      taskTitle: body.taskTitle ?? 'Work',
      sessionId: body.sessionId ?? null,
      opTaskId:  body.opTaskId ?? null,
    })
    return NextResponse.json({ ok: true, timer })
  }

  if (body.action === 'stop') {
    const r = stopTimer(uid)
    if (!r) return NextResponse.json({ ok: true, elapsedMins: 0, timer: null })
    if (r.timer.sessionId) {
      try {
        await updateSession(r.timer.sessionId, { actualMins: r.elapsedMins, endedAt: new Date().toISOString() })
      } catch { /* session may not exist anymore */ }
    }
    return NextResponse.json({ ok: true, elapsedMins: r.elapsedMins, timer: r.timer })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
