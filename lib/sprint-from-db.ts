/**
 * Build the same SprintDay[] shape the markdown parser produces, but from the
 * per-user PostgreSQL sessions table. Used in multi-user mode for non-owner users
 * so Sprint/Month/Skills views show their own data instead of the owner's markdown.
 *
 * Shape parity with lib/parser.ts is intentional — downstream views (SprintView,
 * MonthView, SkillsView, DailyView) consume SprintDay/Session unchanged.
 */
import { getAllSessions } from './session-store'
import type { SprintDay, Session } from './parser'

/** Extract HH:MM from an ISO-ish timestamp; '' if unparseable. */
function timeFromISO(iso?: string | null): string {
  if (!iso) return ''
  const m = iso.match(/T(\d{2}):(\d{2})/)
  return m ? `${m[1]}:${m[2]}` : ''
}

export async function getSprintDaysFromDB(uid: number): Promise<SprintDay[]> {
  const sessions = await getAllSessions(uid)

  const byDate = new Map<string, Session[]>()
  for (const s of sessions) {
    if (s.pushStatus === 'discarded') continue
    const list = byDate.get(s.date) ?? []
    list.push({
      title:        s.title,
      time:         timeFromISO(s.startedAt),
      bullets:      s.bullets ?? [],
      islSessionId: s.id,
    })
    byDate.set(s.date, list)
  }

  const days: SprintDay[] = []
  for (const [date, sess] of byDate) {
    // Sort by time ascending within the day (empty times last), like the parser
    sess.sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'))
    days.push({ date, sessions: sess, op_done: [], open_tasks: [] })
  }
  // Newest day first — matches getAllSprintDays()' reverse-sorted order
  days.sort((a, b) => b.date.localeCompare(a.date))
  return days
}

export async function getSprintDatesFromDB(uid: number): Promise<string[]> {
  const days = await getSprintDaysFromDB(uid)
  return days.map(d => d.date)
}

export async function getSprintDayFromDB(uid: number, date: string): Promise<SprintDay | null> {
  const days = await getSprintDaysFromDB(uid)
  return days.find(d => d.date === date) ?? null
}
