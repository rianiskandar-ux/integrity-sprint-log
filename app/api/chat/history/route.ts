import { NextResponse } from 'next/server'
import { getAllTaskChats } from '@/lib/chat-store'
import { getRequestContext } from '@/lib/request-auth'

export const runtime = 'nodejs'

export async function GET() {
  // Scoped per user — this used to return the WHOLE table, so every teammate
  // saw the owner's entire chat history (found in the first real 2-account test).
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const all = await getAllTaskChats(ctx.uid)
  const chats = all.map(c => ({
    id: c.id,
    title: c.title,
    taskType: c.taskType,
    opTaskId: c.opTaskId ?? null,
    opStoryId: c.opStoryId ?? null,
    sprintName: c.sprintName ?? null,
    msgCount: c.messages.length,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }))
  return NextResponse.json({ chats })
}
