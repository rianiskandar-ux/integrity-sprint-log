import { NextRequest, NextResponse } from 'next/server'
import { getTaskChat, getTaskChatByOpTask, saveTaskChat, deleteTaskChat, type TaskChat } from '@/lib/chat-store'

export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let chat = await getTaskChat(id)
  // Fallback: the same OP ticket may have been chatted under a different
  // surface-specific id (sprinttask-N vs banner-N vs incoming-N). Reuse that
  // history instead of presenting a fresh chat.
  if (!chat) {
    const opTaskId = Number(req.nextUrl.searchParams.get('opTaskId'))
    if (Number.isFinite(opTaskId) && opTaskId > 0) chat = await getTaskChatByOpTask(opTaskId)
  }
  return NextResponse.json({ chat })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json() as Partial<TaskChat>
  let targetId = id
  let existing = await getTaskChat(id)
  // One chat row per OP ticket: if this id has no row yet but the ticket
  // already has a chat (under another surface id), save into THAT row instead
  // of creating a duplicate.
  if (!existing && typeof body.opTaskId === 'number' && body.opTaskId > 0) {
    const byOp = await getTaskChatByOpTask(body.opTaskId)
    if (byOp) { existing = byOp; targetId = byOp.id }
  }
  const now = new Date().toISOString()
  const chat: TaskChat = {
    id: targetId,
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
  const saved = await saveTaskChat(chat)
  return NextResponse.json({ chat: saved })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await deleteTaskChat(id)
  return NextResponse.json({ ok: true })
}
