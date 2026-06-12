import fs from 'fs'
import path from 'path'

const DATA_DIR   = process.env.CACHE_DATA_DIR ?? process.cwd()
const CHATS_DIR  = path.join(DATA_DIR, 'task-chats')

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  ts: string
}

export interface TaskChat {
  id: string           // session/task ID
  title: string
  taskType: 'session' | 'incoming' | 'new'
  opTaskId?: number | null
  opStoryId?: number | null
  sprintName?: string | null
  date?: string
  messages: ChatMessage[]
  createdAt: string
  updatedAt: string
}

function ensureDir() {
  if (!fs.existsSync(CHATS_DIR)) fs.mkdirSync(CHATS_DIR, { recursive: true })
}

function filePath(id: string) {
  return path.join(CHATS_DIR, `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`)
}

export function getTaskChat(id: string): TaskChat | null {
  ensureDir()
  const fp = filePath(id)
  try {
    if (!fs.existsSync(fp)) return null
    return JSON.parse(fs.readFileSync(fp, 'utf-8'))
  } catch { return null }
}

export function saveTaskChat(chat: TaskChat): TaskChat {
  ensureDir()
  const updated = { ...chat, updatedAt: new Date().toISOString() }
  fs.writeFileSync(filePath(chat.id), JSON.stringify(updated, null, 2))
  return updated
}

export function appendMessage(id: string, meta: Omit<TaskChat, 'messages' | 'createdAt' | 'updatedAt'>, msg: ChatMessage): TaskChat {
  ensureDir()
  const existing = getTaskChat(id)
  const now = new Date().toISOString()
  const chat: TaskChat = existing ?? {
    ...meta,
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
  chat.messages.push(msg)
  return saveTaskChat(chat)
}

export function getAllTaskChats(): TaskChat[] {
  ensureDir()
  const files = fs.readdirSync(CHATS_DIR).filter(f => f.endsWith('.json'))
  const chats: TaskChat[] = []
  for (const f of files) {
    try { chats.push(JSON.parse(fs.readFileSync(path.join(CHATS_DIR, f), 'utf-8'))) } catch {}
  }
  return chats.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

export function deleteTaskChat(id: string) {
  const fp = filePath(id)
  if (fs.existsSync(fp)) fs.unlinkSync(fp)
}
