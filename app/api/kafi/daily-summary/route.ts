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

  const [logs, memory, kafiSessions, allTodaySessions] = await Promise.all([
    db.select().from(dailyLogs)
      .where(and(eq(dailyLogs.userId, OWNER_UID), eq(dailyLogs.date, today)))
      .orderBy(desc(dailyLogs.loggedAt)),
    db.select().from(taskMemory)
      .where(and(eq(taskMemory.userId, OWNER_UID), eq(taskMemory.date, today)))
      .orderBy(desc(taskMemory.loggedAt)),
    db.select().from(sessions)
      .where(and(eq(sessions.date, today), eq(sessions.source, 'kafi'))),
    // Fallback signal: dailyLogs/taskMemory only ever get written by the Claude
    // Code Stop hook, which never fires mid-session (long/continuous sessions,
    // or activity captured via git-capture instead) — so on a day where work
    // DID happen but no session has stopped yet, this report would otherwise
    // wrongly say "no activity today" even though sessions (e.g. git-capture)
    // already show it in the Hub queue. Scoped to OWNER_UID like the two
    // queries above — this route is the OWNER's personal daily report; without
    // this filter a teammate's own sessions today would mix in unlabeled.
    db.select({ title: sessions.title, source: sessions.source, bullets: sessions.bullets }).from(sessions)
      .where(and(eq(sessions.date, today), eq(sessions.userId, OWNER_UID))),
  ])

  return NextResponse.json({
    date:          today,
    dailyLogs:     logs,
    taskMemory:    memory,
    kafiPushCount: kafiSessions.length,
    fallbackActivity: (logs.length === 0 && memory.length === 0)
      ? allTodaySessions.map(s => ({ title: s.title, source: s.source ?? 'unknown', bullets: s.bullets ?? [] }))
      : [],
    hasData:       logs.length > 0 || memory.length > 0 || allTodaySessions.length > 0,
  })
}
