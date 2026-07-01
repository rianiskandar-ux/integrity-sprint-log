import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dailyLogs, taskMemory, sessions } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { OWNER_UID } from '@/lib/auth'

export const runtime = 'nodejs'

function verifyKey(req: Request): boolean {
  const key = process.env.KAFI_API_KEY || 'kafi-bridge-2026'
  return req.headers.get('x-kafi-key') === key
}

export async function GET(req: Request) {
  if (!verifyKey(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const today = new Date().toISOString().slice(0, 10)

  const [logs, memory, hubSessions] = await Promise.all([
    db.select().from(dailyLogs)
      .where(and(eq(dailyLogs.userId, OWNER_UID), eq(dailyLogs.date, today)))
      .orderBy(desc(dailyLogs.loggedAt)),
    db.select().from(taskMemory)
      .where(and(eq(taskMemory.userId, OWNER_UID), eq(taskMemory.date, today)))
      .orderBy(desc(taskMemory.loggedAt)),
    db.select().from(sessions)
      .where(and(eq(sessions.date, today), eq(sessions.source, 'kafi'))),
  ])

  return NextResponse.json({
    date:          today,
    dailyLogs:     logs,
    taskMemory:    memory,
    kafiPushCount: hubSessions.length,
    hasData:       logs.length > 0 || memory.length > 0,
  })
}
