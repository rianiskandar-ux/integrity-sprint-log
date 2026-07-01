import { NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/request-auth'
import { getTimer, startTimer, stopTimer, pauseTimer, resumeTimer } from '@/lib/work-timer'
import { updateSession, getSession } from '@/lib/session-store'
import { OWNER_UID } from '@/lib/auth'

function toISODuration(minutes: number): string {
  const h = Math.floor(minutes / 60), m = minutes % 60
  return h > 0 ? `PT${h}H${m > 0 ? m + 'M' : ''}` : `PT${m}M`
}

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

    // Auto-push to OP if timer was linked to an OP task
    let opPushed = false
    if (r.timer.opTaskId && !r.suspicious && r.elapsedMins > 0) {
      try {
        const ctx = await getRequestContext()
        if (ctx?.opToken && ctx?.opBaseUrl) {
          const auth = 'Basic ' + Buffer.from(`apikey:${ctx.opToken}`).toString('base64')
          const res  = await fetch(`${ctx.opBaseUrl}/api/v3/time_entries`, {
            method: 'POST',
            headers: { Authorization: auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              hours:   toISODuration(r.elapsedMins),
              spentOn: new Date().toISOString().split('T')[0],
              comment: { format: 'plain', raw: r.timer.taskTitle ?? 'Timer via ISL' },
              _links:  { workPackage: { href: `/api/v3/work_packages/${r.timer.opTaskId}` } },
            }),
          })
          opPushed = res.ok
        }
      } catch { /* non-fatal — OP push failure shouldn't block timer stop */ }
    }

    return NextResponse.json({ ok: true, elapsedMins: r.elapsedMins, totalActual, suspicious: r.suspicious, timer: r.timer, opPushed })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
