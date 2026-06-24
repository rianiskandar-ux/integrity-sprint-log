import { NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/request-auth'
import { getTimer, startTimer, stopTimer, pauseTimer, resumeTimer } from '@/lib/work-timer'
import { updateSession, getSession } from '@/lib/session-store'
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

  if (body.action === 'pause')  return NextResponse.json({ ok: true, timer: pauseTimer(uid) })
  if (body.action === 'resume') return NextResponse.json({ ok: true, timer: resumeTimer(uid) })

  if (body.action === 'stop') {
    const r = stopTimer(uid)
    if (!r) return NextResponse.json({ ok: true, elapsedMins: 0, timer: null })
    let totalActual: number | null = null
    // Don't auto-write an obviously-forgotten timer (left running overnight);
    // surface it so the user sets the real time manually instead.
    if (r.timer.sessionId && !r.suspicious) {
      try {
        // ACCUMULATE: add this run to any existing actual, so stopping early then
        // resuming the timer on the same task sums up instead of overwriting.
        const existing = await getSession(r.timer.sessionId)
        const prev = existing?.actualMins ?? 0
        totalActual = prev + r.elapsedMins
        await updateSession(r.timer.sessionId, { actualMins: totalActual, endedAt: new Date().toISOString() })
      } catch { /* session may not exist anymore */ }
    }
    return NextResponse.json({ ok: true, elapsedMins: r.elapsedMins, totalActual, suspicious: r.suspicious, timer: r.timer })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
