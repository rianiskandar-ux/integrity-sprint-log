import fs from 'fs'
import path from 'path'

const DATA_DIR = process.env.CACHE_DATA_DIR ?? process.cwd()
export const SESSION_LOGS_DIR = path.join(DATA_DIR, 'session-logs')

export interface SessionLog {
  id: string
  sessionId?: string
  userId?: number
  date: string                   // YYYY-MM-DD

  title: string
  bullets: string[]
  source?: string

  startedAt: string
  endedAt?: string
  actualMins?: number
  estimatedMins: number

  opTaskId?: number | null
  opStoryId?: number | null
  opEpicId?: number | null
  isNewTask?: boolean

  taskStatus?: string            // ISL-local: in_progress | on_hold | done | abandoned
  aiStatus?: string
  hasExplicitCmd?: boolean
  needsValidation?: boolean
  command?: string | null
  ticketBinding?: number | null
  relatedOldTaskId?: number | null

  tokenUsage?: { inputTokens: number; outputTokens: number } | null

  pushStatus: 'pending' | 'pushed' | 'discarded'
  autoPushed?: boolean
  undoneAt?: string | null
  createdAt: string
  updatedAt: string
}

function ensureDir() {
  if (!fs.existsSync(SESSION_LOGS_DIR)) fs.mkdirSync(SESSION_LOGS_DIR, { recursive: true })
}

function fileNameFor(date: string, sessionId?: string): string {
  const sid = sessionId ? sessionId.slice(0, 8) : `${Date.now()}`
  return `${date}_${sid}.json`
}

export function getAllSessions(): SessionLog[] {
  ensureDir()
  const files = fs.readdirSync(SESSION_LOGS_DIR).filter(f => f.endsWith('.json'))
  const sessions: SessionLog[] = []
  for (const f of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(SESSION_LOGS_DIR, f), 'utf-8'))
      sessions.push(raw)
    } catch {}
  }
  return sessions.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
}

export function getSession(id: string): SessionLog | null {
  ensureDir()
  const files = fs.readdirSync(SESSION_LOGS_DIR).filter(f => f.endsWith('.json'))
  for (const f of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(SESSION_LOGS_DIR, f), 'utf-8'))
      if (raw.id === id) return raw
    } catch {}
  }
  return null
}

export function getSessionBySessionId(sessionId: string): SessionLog | null {
  ensureDir()
  const files = fs.readdirSync(SESSION_LOGS_DIR).filter(f => f.endsWith('.json'))
  for (const f of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(SESSION_LOGS_DIR, f), 'utf-8'))
      if (raw.sessionId === sessionId) return raw
    } catch {}
  }
  return null
}

export function saveSession(session: SessionLog) {
  ensureDir()
  const fileName = fileNameFor(session.date, session.sessionId)
  fs.writeFileSync(path.join(SESSION_LOGS_DIR, fileName), JSON.stringify(session, null, 2), 'utf-8')
}

export function updateSession(id: string, updates: Partial<SessionLog>): SessionLog | null {
  ensureDir()
  const files = fs.readdirSync(SESSION_LOGS_DIR).filter(f => f.endsWith('.json'))
  for (const f of files) {
    try {
      const filePath = path.join(SESSION_LOGS_DIR, f)
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      if (raw.id === id) {
        const updated = { ...raw, ...updates, updatedAt: new Date().toISOString() }
        fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf-8')
        return updated
      }
    } catch {}
  }
  return null
}

export function createSessionId(): string {
  return `sl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}
