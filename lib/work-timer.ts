/**
 * Tool-agnostic work timer. Stores a per-user "started at" timestamp server-side
 * so the elapsed time is measured by wall-clock regardless of WHERE the work
 * happens (ISL, terminal, Kiro, editor, anywhere). Start when you begin, stop
 * when done → elapsed minutes become the session's actual time.
 */
import fs from 'fs'
import path from 'path'

const DIR = process.env.CACHE_DATA_DIR ?? process.cwd()
function timerFile(uid: number): string {
  return path.join(DIR, `work-timer-${uid}.json`)
}

export interface WorkTimer {
  startedAt: string            // ISO timestamp when work began
  taskTitle: string
  sessionId?: string | null    // ISL session to write actualMins to on stop
  opTaskId?: number | null
}

export function getTimer(uid: number): WorkTimer | null {
  try { return JSON.parse(fs.readFileSync(timerFile(uid), 'utf-8')) as WorkTimer } catch { return null }
}

export function startTimer(uid: number, t: { taskTitle: string; sessionId?: string | null; opTaskId?: number | null; startedAt?: string }): WorkTimer {
  const timer: WorkTimer = {
    startedAt: t.startedAt ?? new Date().toISOString(),
    taskTitle: t.taskTitle || 'Work',
    sessionId: t.sessionId ?? null,
    opTaskId:  t.opTaskId ?? null,
  }
  fs.writeFileSync(timerFile(uid), JSON.stringify(timer), 'utf-8')
  return timer
}

export function stopTimer(uid: number): { timer: WorkTimer; elapsedMins: number } | null {
  const t = getTimer(uid)
  if (!t) return null
  const elapsedMs = Date.now() - new Date(t.startedAt).getTime()
  const elapsedMins = Math.max(1, Math.round(elapsedMs / 60000))
  try { fs.unlinkSync(timerFile(uid)) } catch { /* already gone */ }
  return { timer: t, elapsedMins }
}
