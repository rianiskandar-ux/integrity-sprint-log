import { db, taskChats } from './db'
import { eq, desc } from 'drizzle-orm'

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

// userId stays null until real users exist (Phase 1a auth). Column is FK to users(id);
// users table is empty now, so forcing an id would violate the constraint.
const DEFAULT_USER_ID = null as number | null

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

export async function getTaskChat(id: string): Promise<TaskChat | null> {
  const rows = await db.select().from(taskChats).where(eq(taskChats.id, id)).limit(1)
  return rows[0] ? rowToChat(rows[0]) : null
}

export async function saveTaskChat(chat: TaskChat): Promise<TaskChat> {
  const now = new Date()
  const values = {
    id:         chat.id,
    userId:     DEFAULT_USER_ID,
    title:      chat.title,
    taskType:   chat.taskType,
    opTaskId:   chat.opTaskId ?? null,
    opStoryId:  chat.opStoryId ?? null,
    sprintName: chat.sprintName ?? null,
    date:       chat.date ?? null,
    messages:   chat.messages,
    updatedAt:  now,
  }
  await db.insert(taskChats).values(values).onConflictDoUpdate({
    target: taskChats.id,
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
  const saved = await getTaskChat(chat.id)
  return saved ?? { ...chat, updatedAt: now.toISOString() }
}

export async function appendMessage(
  id: string,
  meta: Omit<TaskChat, 'messages' | 'createdAt' | 'updatedAt'>,
  msg: ChatMessage,
): Promise<TaskChat> {
  const existing = await getTaskChat(id)
  const nowIso = new Date().toISOString()
  const chat: TaskChat = existing ?? {
    ...meta,
    messages: [],
    createdAt: nowIso,
    updatedAt: nowIso,
  }
  chat.messages.push(msg)
  return saveTaskChat(chat)
}

export async function getAllTaskChats(): Promise<TaskChat[]> {
  const rows = await db.select().from(taskChats).orderBy(desc(taskChats.updatedAt))
  return rows.map(rowToChat)
}

export async function deleteTaskChat(id: string): Promise<void> {
  await db.delete(taskChats).where(eq(taskChats.id, id))
}
