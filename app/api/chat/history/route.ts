import { NextResponse } from 'next/server'
import { getAllTaskChats } from '@/lib/chat-store'

export const runtime = 'nodejs'

export async function GET() {
  const all = await getAllTaskChats()
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
