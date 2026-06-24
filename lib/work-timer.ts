/**
 * Tool-agnostic work timer with pause/resume. Stores per-user timer state
 * server-side so elapsed time is measured by wall-clock regardless of WHERE the
 * work happens (ISL, terminal, Kiro, editor). Start when you begin, pause for
 * interruptions (lunch, meeting), stop when done → elapsed becomes actual time.
 */
import fs from 'fs'
import path from 'path'

const DIR = process.env.CACHE_DATA_DIR ?? process.cwd()
function timerFile(uid: number): string {
  return path.join(DIR, `work-timer-${uid}.json`)
}

// A timer running longer than this on stop is almost certainly a forgotten one.
export const STALE_THRESHOLD_MINS = 600 // 10h

export interface WorkTimer {
  startedAt: string            // when the CURRENT running segment started
  accumulatedMs: number        // worked time from previous (resumed) segments
  paused: boolean
  taskTitle: string
  sessionId?: string | null
  opTaskId?: number | null
}

function read(uid: number): WorkTimer | null {
  try { return JSON.parse(fs.readFileSync(timerFile(uid), 'utf-8')) as WorkTimer } catch { return null }
}
function write(uid: number, t: WorkTimer) {
  fs.writeFileSync(timerFile(uid), JSON.stringify(t), 'utf-8')
}

/** Total worked milliseconds so far (excludes paused time). */
export function elapsedMs(t: WorkTimer): number {
  return t.accumulatedMs + (t.paused ? 0 : Date.now() - new Date(t.startedAt).getTime())
}

export function getTimer(uid: number): (WorkTimer & { elapsedMins: number }) | null {
  const t = read(uid)
  if (!t) return null
  return { ...t, elapsedMins: Math.max(0, Math.round(elapsedMs(t) / 60000)) }
}

export function startTimer(uid: number, t: { taskTitle: string; sessionId?: string | null; opTaskId?: number | null }): WorkTimer {
  const timer: WorkTimer = {
    startedAt:     new Date().toISOString(),
    accumulatedMs: 0,
    paused:        false,
    taskTitle:     t.taskTitle || 'Work',
    sessionId:     t.sessionId ?? null,
    opTaskId:      t.opTaskId ?? null,
  }
  write(uid, timer)
  return timer
}

export function pauseTimer(uid: number): WorkTimer | null {
  const t = read(uid)
  if (!t || t.paused) return t
  t.accumulatedMs += Date.now() - new Date(t.startedAt).getTime()
  t.paused = true
  write(uid, t)
  return t
}

export function resumeTimer(uid: number): WorkTimer | null {
  const t = read(uid)
  if (!t || !t.paused) return t
  t.startedAt = new Date().toISOString()
  t.paused = false
  write(uid, t)
  return t
}

export function stopTimer(uid: number): { timer: WorkTimer; elapsedMins: number; suspicious: boolean } | null {
  const t = read(uid)
  if (!t) return null
  const elapsedMins = Math.max(1, Math.round(elapsedMs(t) / 60000))
  try { fs.unlinkSync(timerFile(uid)) } catch { /* already gone */ }
  return { timer: t, elapsedMins, suspicious: elapsedMins > STALE_THRESHOLD_MINS }
}
