import fs from 'fs'
import path from 'path'

export interface Session {
  title: string
  time: string
  bullets: string[]
}

export interface SprintDay {
  date: string
  sessions: Session[]
  op_done: string[]
  open_tasks: string[]
}

export function getSprintDir(): string {
  return process.env.SPRINT_OUTPUT_DIR ?? path.join(process.cwd(), 'sprints')
}

export function parseSprintFile(date: string): SprintDay | null {
  const dir = getSprintDir()
  const filePath = path.join(dir, `${date}.md`)
  if (!fs.existsSync(filePath)) return null

  const raw = fs.readFileSync(filePath, 'utf-8')
  const lines = raw.split('\n')

  const day: SprintDay = { date, sessions: [], op_done: [], open_tasks: [] }
  let section: 'done' | 'tasks' | 'notes' | null = null
  let currentSession: Session | null = null

  for (const line of lines) {
    if (line.startsWith('## Dikerjakan')) { section = 'done'; continue }
    if (line.startsWith('## Open Tasks')) { section = 'tasks'; continue }
    if (line.startsWith('## Technical Notes')) { section = 'notes'; continue }

    if (section === 'notes' && line.startsWith('### ')) {
      if (currentSession) day.sessions.push(currentSession)
      const match = line.match(/^### (.+?) [-—] (.+)$/)
      if (match) {
        currentSession = { title: match[1].trim(), time: match[2].trim(), bullets: [] }
      } else {
        currentSession = { title: line.replace(/^### /, '').trim(), time: '', bullets: [] }
      }
      continue
    }

    if (section === 'notes' && currentSession && line.startsWith('- ')) {
      currentSession.bullets.push(line.slice(2).trim())
      continue
    }

    if (section === 'done' && line.startsWith('- ')) {
      day.op_done.push(line.slice(2).trim())
      continue
    }

    if (section === 'tasks' && line.startsWith('- ')) {
      day.open_tasks.push(line.slice(2).trim())
      continue
    }
  }
  if (currentSession) day.sessions.push(currentSession)

  // Sort sessions by time ascending (08:00 → 09:26 → 16:38)
  day.sessions.sort((a, b) => {
    const toMinutes = (t: string) => {
      const m = t.match(/(\d{1,2})[:.:](\d{2})/)
      if (!m) return 9999
      return parseInt(m[1]) * 60 + parseInt(m[2])
    }
    return toMinutes(a.time) - toMinutes(b.time)
  })

  return day
}

export function getAllSprintDays(): SprintDay[] {
  const dir = getSprintDir()
  if (!fs.existsSync(dir)) return []

  const files = fs.readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort()
    .reverse()

  return files
    .map((f) => parseSprintFile(f.replace('.md', '')))
    .filter(Boolean) as SprintDay[]
}

export function getSprintDates(): string[] {
  const dir = getSprintDir()
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .map((f) => f.replace('.md', ''))
    .sort()
    .reverse()
}

// Sprint number: 2-week cycles anchored at 2026-01-05
const SPRINT_ANCHOR = new Date('2026-01-12').getTime()
const SPRINT_DURATION = 14 * 24 * 60 * 60 * 1000

export function getSprintNumber(ts: number): number {
  return Math.floor((ts - SPRINT_ANCHOR) / SPRINT_DURATION) + 1
}

export function getSprintWindow(sprintNo: number): [number, number] {
  const start = SPRINT_ANCHOR + (sprintNo - 1) * SPRINT_DURATION
  const end = start + SPRINT_DURATION - 1
  return [start, end]
}
