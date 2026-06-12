import { NextRequest, NextResponse } from 'next/server'
import { getTaskChat, saveTaskChat, deleteTaskChat, type TaskChat } from '@/lib/chat-store'

export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const chat = getTaskChat(id)
  return NextResponse.json({ chat })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json() as Partial<TaskChat>
  const existing = getTaskChat(id)
  const now = new Date().toISOString()
  const chat: TaskChat = {
    id,
    title:     body.title     ?? existing?.title     ?? 'Untitled',
    taskType:  body.taskType  ?? existing?.taskType  ?? 'session',
    opTaskId:  body.opTaskId  ?? existing?.opTaskId  ?? null,
    opStoryId: body.opStoryId ?? existing?.opStoryId ?? null,
    sprintName:body.sprintName?? existing?.sprintName?? null,
    date:      body.date      ?? existing?.date,
    messages:  body.messages  ?? existing?.messages  ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  const saved = saveTaskChat(chat)
  return NextResponse.json({ chat: saved })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  deleteTaskChat(id)
  return NextResponse.json({ ok: true })
}
