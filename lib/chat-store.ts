import { db, taskChats } from './db'
import { eq, desc, and } from 'drizzle-orm'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  ts: string
}

export interface TaskChat {
  id: string           // session/task ID
  title: string
  taskType: 'session' | 'incoming' | 'new' | 'general' | 'idea' | 'plan'
  opTaskId?: number | null
  opStoryId?: number | null
  sprintName?: string | null
  date?: string
  messages: ChatMessage[]
  createdAt: string
  updatedAt: string
}

// Every function is scoped by userId — found 2026-07-10 (real 2-account test):
// the list route returned the whole table and every saved row had userId NULL,
// so teammates saw the owner's entire chat history. PK is now (id, user_id):
// surface-generated ids are deterministic (e.g. incoming-6004), so two users
// chatting on the same OP ticket produce the SAME id — a single-column PK
// would make them silently overwrite each other's history.

function rowToChat(r: typeof taskChats.$inferSelect): TaskChat {
  return {
    id:         r.id,
    title:      r.title,
    taskType:   (r.taskType ?? 'general') as TaskChat['taskType'],
    opTaskId:   r.opTaskId,
    opStoryId:  r.opStoryId,
    sprintName: r.sprintName,
    date:       r.date ?? undefined,
    messages:   (r.messages ?? []) as ChatMessage[],
    createdAt:  r.createdAt.toISOString(),
    updatedAt:  r.updatedAt.toISOString(),
  }
}

export async function getTaskChat(id: string, userId: number): Promise<TaskChat | null> {
  const rows = await db.select().from(taskChats)
    .where(and(eq(taskChats.id, id), eq(taskChats.userId, userId)))
    .limit(1)
  return rows[0] ? rowToChat(rows[0]) : null
}

// Latest chat linked to an OP work package. Different UI surfaces historically
// generated different ids for the same ticket (sprinttask-N, banner-N,
// incoming-N, …) — this lets load/save converge on ONE row per ticket instead
// of creating a new row per surface.
export async function getTaskChatByOpTask(opTaskId: number, userId: number): Promise<TaskChat | null> {
  const rows = await db.select().from(taskChats)
    .where(and(eq(taskChats.opTaskId, opTaskId), eq(taskChats.userId, userId)))
    .orderBy(desc(taskChats.updatedAt))
    .limit(1)
  return rows[0] ? rowToChat(rows[0]) : null
}

// Empty/"..." assistant bubbles are never-completed stream placeholders — they
// must never reach the database, regardless of which UI wrote the history.
function stripPlaceholders(messages: ChatMessage[]): ChatMessage[] {
  return (messages ?? []).filter(m => {
    if (m.role !== 'assistant') return true
    const t = (m.content ?? '').trim()
    return t !== '' && t !== '...' && t !== '…'
  })
}

export async function saveTaskChat(chat: TaskChat, userId: number): Promise<TaskChat> {
  const now = new Date()
  const values = {
    id:         chat.id,
    userId,
    title:      chat.title,
    taskType:   chat.taskType,
    opTaskId:   chat.opTaskId ?? null,
    opStoryId:  chat.opStoryId ?? null,
    sprintName: chat.sprintName ?? null,
    date:       chat.date ?? null,
    messages:   stripPlaceholders(chat.messages),
    updatedAt:  now,
  }
  await db.insert(taskChats).values(values).onConflictDoUpdate({
    target: [taskChats.id, taskChats.userId],
    set: {
      title:      values.title,
      taskType:   values.taskType,
      opTaskId:   values.opTaskId,
      opStoryId:  values.opStoryId,
      sprintName: values.sprintName,
      date:       values.date,
      messages:   values.messages,
      updatedAt:  now,
    },
  })
  const saved = await getTaskChat(chat.id, userId)
  return saved ?? { ...chat, updatedAt: now.toISOString() }
}

export async function appendMessage(
  id: string,
  meta: Omit<TaskChat, 'messages' | 'createdAt' | 'updatedAt'>,
  msg: ChatMessage,
  userId: number,
): Promise<TaskChat> {
  const existing = await getTaskChat(id, userId)
  const nowIso = new Date().toISOString()
  const chat: TaskChat = existing ?? {
    ...meta,
    messages: [],
    createdAt: nowIso,
    updatedAt: nowIso,
  }
  chat.messages.push(msg)
  return saveTaskChat(chat, userId)
}

export async function getAllTaskChats(userId: number): Promise<TaskChat[]> {
  const rows = await db.select().from(taskChats)
    .where(eq(taskChats.userId, userId))
    .orderBy(desc(taskChats.updatedAt))
  // Defensive: a corrupted unique index once produced physical duplicates.
  // Keep only the newest row per id (rows are already ordered by updatedAt
  // desc) so the UI never renders duplicate entries.
  const seen = new Set<string>()
  const unique: typeof rows = []
  for (const r of rows) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    unique.push(r)
  }
  return unique.map(rowToChat)
}

export async function deleteTaskChat(id: string, userId: number): Promise<void> {
  await db.delete(taskChats).where(and(eq(taskChats.id, id), eq(taskChats.userId, userId)))
}
