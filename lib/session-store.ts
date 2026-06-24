import { db, sessions } from './db'
import { eq, desc, isNull, or, sql } from 'drizzle-orm'

export interface SessionLog {
  id: string
  sessionId?: string
  userId?: number | null
  date: string

  title: string
  bullets: string[]
  source?: string

  startedAt: string
  endedAt?: string | null
  actualMins?: number | null
  estimatedMins: number

  opTaskId?: number | null
  opStoryId?: number | null
  opEpicId?: number | null
  isNewTask?: boolean

  taskStatus?: string | null
  aiStatus?: string | null
  hasExplicitCmd?: boolean
  needsValidation?: boolean
  command?: string | null
  ticketBinding?: number | null
  relatedOldTaskId?: number | null

  tokenUsage?: { inputTokens: number; outputTokens: number } | null

  pushStatus: 'pending' | 'pushed' | 'discarded' | 'hub' | 'live'
  autoPushed?: boolean
  undoneAt?: string | null
  createdAt: string
  updatedAt: string
}

function normalizeBullets(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw === 'string' && raw.length > 0) return raw.split('\n').map(s => s.trim()).filter(Boolean)
  return []
}

function rowToLog(r: typeof sessions.$inferSelect): SessionLog {
  return {
    id:               r.id,
    sessionId:        r.sessionId ?? undefined,
    userId:           r.userId,
    date:             r.date,
    title:            r.title,
    bullets:          normalizeBullets(r.bullets),
    source:           r.source ?? undefined,
    startedAt:        r.startedAt,
    endedAt:          r.endedAt,
    actualMins:       r.actualMins,
    estimatedMins:    r.estimatedMins,
    opTaskId:         r.opTaskId,
    opStoryId:        r.opStoryId,
    opEpicId:         r.opEpicId,
    isNewTask:        r.isNewTask ?? false,
    taskStatus:       r.taskStatus,
    aiStatus:         r.aiStatus,
    hasExplicitCmd:   r.hasExplicitCmd ?? false,
    needsValidation:  r.needsValidation ?? false,
    command:          r.command,
    ticketBinding:    r.ticketBinding,
    relatedOldTaskId: r.relatedOldTaskId,
    tokenUsage:       r.tokenUsage as SessionLog['tokenUsage'],
    pushStatus:       (r.pushStatus as SessionLog['pushStatus']) ?? 'pending',
    autoPushed:       r.autoPushed ?? false,
    undoneAt:         r.undoneAt,
    createdAt:        r.createdAt.toISOString(),
    updatedAt:        r.updatedAt.toISOString(),
  }
}

export async function getAllSessions(uid?: number | null): Promise<SessionLog[]> {
  if (uid != null) {
    const rows = await db.select().from(sessions)
      .where(eq(sessions.userId, uid))
      .orderBy(desc(sessions.startedAt))
    return rows.map(rowToLog)
  }
  const rows = await db.select().from(sessions).orderBy(desc(sessions.startedAt))
  return rows.map(rowToLog)
}

/**
 * Legacy one-shot: assign null-userId sessions to the owner (uid=1).
 * UNSAFE in multi-user mode — null rows may belong to ANY member, so vacuuming
 * them into the owner would mis-attribute team data. No-op when multi-user is on.
 */
export async function migrateNullSessionsToOwner(): Promise<number> {
  if (process.env.ISL_MULTIUSER === '1') return 0
  const result = await db.execute(sql`UPDATE sessions SET user_id = 1 WHERE user_id IS NULL`)
  return (result as unknown as { rowCount?: number }).rowCount ?? 0
}

export async function getSession(id: string): Promise<SessionLog | null> {
  const rows = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1)
  return rows[0] ? rowToLog(rows[0]) : null
}

export async function getSessionBySessionId(sessionId: string): Promise<SessionLog | null> {
  const rows = await db.select().from(sessions).where(eq(sessions.sessionId, sessionId)).limit(1)
  return rows[0] ? rowToLog(rows[0]) : null
}

export async function getSessionsByStatus(status: SessionLog['pushStatus']): Promise<SessionLog[]> {
  const rows = await db.select().from(sessions)
    .where(eq(sessions.pushStatus, status))
    .orderBy(desc(sessions.startedAt))
  return rows.map(rowToLog)
}

export async function saveSession(session: SessionLog): Promise<void> {
  await db.insert(sessions).values({
    id:               session.id,
    sessionId:        session.sessionId ?? null,
    userId:           session.userId ?? null,
    date:             session.date,
    title:            session.title,
    bullets:          session.bullets,
    source:           session.source ?? null,
    startedAt:        session.startedAt,
    endedAt:          session.endedAt ?? null,
    actualMins:       session.actualMins ?? null,
    estimatedMins:    session.estimatedMins,
    opTaskId:         session.opTaskId ?? null,
    opStoryId:        session.opStoryId ?? null,
    opEpicId:         session.opEpicId ?? null,
    isNewTask:        session.isNewTask ?? false,
    taskStatus:       session.taskStatus ?? null,
    aiStatus:         session.aiStatus ?? null,
    hasExplicitCmd:   session.hasExplicitCmd ?? false,
    needsValidation:  session.needsValidation ?? false,
    command:          session.command ?? null,
    ticketBinding:    session.ticketBinding ?? null,
    relatedOldTaskId: session.relatedOldTaskId ?? null,
    tokenUsage:       session.tokenUsage ?? null,
    pushStatus:       session.pushStatus,
    autoPushed:       session.autoPushed ?? false,
    undoneAt:         session.undoneAt ?? null,
    createdAt:        new Date(session.createdAt),
    updatedAt:        new Date(session.updatedAt),
  }).onConflictDoUpdate({
    target: sessions.id,
    set: {
      title:           session.title,
      bullets:         session.bullets,
      actualMins:      session.actualMins ?? null,
      estimatedMins:   session.estimatedMins,
      opTaskId:        session.opTaskId ?? null,
      opStoryId:       session.opStoryId ?? null,
      opEpicId:        session.opEpicId ?? null,
      taskStatus:      session.taskStatus ?? null,
      aiStatus:        session.aiStatus ?? null,
      pushStatus:      session.pushStatus,
      autoPushed:      session.autoPushed ?? false,
      undoneAt:        session.undoneAt ?? null,
      needsValidation: session.needsValidation ?? false,
      updatedAt:       new Date(session.updatedAt),
    }
  })
}

// Only these columns may be patched — anything else (e.g. a stray key from a raw
// request body) is dropped so Drizzle never receives an unknown column.
const EDITABLE_SESSION_KEYS: ReadonlySet<string> = new Set([
  'sessionId', 'userId', 'date', 'title', 'bullets', 'source', 'startedAt', 'endedAt',
  'actualMins', 'estimatedMins', 'opTaskId', 'opStoryId', 'opEpicId', 'isNewTask',
  'taskStatus', 'aiStatus', 'hasExplicitCmd', 'needsValidation', 'command',
  'ticketBinding', 'relatedOldTaskId', 'tokenUsage', 'pushStatus', 'autoPushed',
  'undoneAt', 'createdAt',
])

export async function updateSession(id: string, updates: Partial<SessionLog>): Promise<SessionLog | null> {
  const patch: Record<string, unknown> = { updatedAt: new Date() }
  for (const [k, v] of Object.entries(updates)) {
    if (EDITABLE_SESSION_KEYS.has(k)) patch[k] = v
  }
  if (patch.createdAt != null) {
    const d = new Date(patch.createdAt as string)
    if (isNaN(d.getTime())) delete patch.createdAt
    else patch.createdAt = d
  }

  const rows = await db.update(sessions).set(patch).where(eq(sessions.id, id)).returning()
  return rows[0] ? rowToLog(rows[0]) : null
}

export function createSessionId(): string {
  return `sl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

// No longer used — kept for import compatibility during migration
export const SESSION_LOGS_DIR = ''
