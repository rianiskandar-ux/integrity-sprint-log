import { NextResponse } from 'next/server'
import { getAllSessions } from '@/lib/session-store'
import { loadCache } from '@/lib/op-cache'

export async function GET() {
  try {
    const sessions = getAllSessions()
    const cache    = loadCache()

    // Push Queue — pending sessions awaiting approval
    const queueSessions = sessions.filter(s => s.pushStatus === 'pending')

    // Auto Log — pushed sessions
    const pushedSessions = sessions.filter(s => s.pushStatus === 'pushed')
    const recentPushed   = pushedSessions
      .sort((a, b) => (b.updatedAt ?? b.createdAt ?? '').localeCompare(a.updatedAt ?? a.createdAt ?? ''))
      .slice(0, 5)
      .map(s => ({ id: s.id, title: s.title, date: s.date, opTaskId: s.opTaskId ?? null, actualMins: s.actualMins ?? s.estimatedMins }))

    // Incoming — OP tasks not yet matched to ISL
    const pushedTaskIds = new Set(sessions.filter(s => s.opTaskId).map(s => s.opTaskId))
    const incomingTasks = (cache.incomingTasks ?? []).filter(
      (t: { islStatus?: string }) => t.islStatus !== 'done' && t.islStatus !== 'rejected'
    )
    const newIncoming = incomingTasks.filter((t: { id: number }) => !pushedTaskIds.has(t.id))

    // Sprint stats from cache
    const currentSprint = (cache.sprints ?? []).find((s: { isCurrent: boolean }) => s.isCurrent) ?? null

    // Sprint progress: count my open tasks in current sprint
    const myOpen   = (cache.myOpenTasks   ?? []) as { versionId?: number | null }[]
    const myClosed = (cache.myClosedTasks ?? []) as { versionId?: number | null }[]
    const sprintStats = currentSprint ? (() => {
      const done  = myClosed.filter(t => t.versionId === currentSprint.id).length
      const open  = myOpen.filter(t => t.versionId === currentSprint.id).length
      const total = done + open
      return total > 0 ? { total, done, pct: Math.round(done / total * 100) } : null
    })() : null

    // Backlog — my open tasks with no sprint/version assigned
    const staleTasks = myOpen.filter(
      (t: { versionId?: number | null }) => !t.versionId
    ) as { id: number; subject: string }[]

    // Today's activity
    const today = new Date().toISOString().slice(0, 10)
    const todaySessions = sessions.filter(s => s.date === today && s.pushStatus === 'pushed')
    const todayMins     = todaySessions.reduce((a, s) => a + (s.actualMins ?? s.estimatedMins ?? 0), 0)

    return NextResponse.json({
      queue: {
        count:    queueSessions.length,
        sessions: queueSessions.slice(0, 3).map(s => ({ id: s.id, title: s.title, date: s.date })),
      },
      autoLog: {
        totalPushed: pushedSessions.length,
        recent:      recentPushed,
        todayCount:  todaySessions.length,
        todayMins,
      },
      incoming: {
        total:    incomingTasks.length,
        newCount: newIncoming.length,
        preview:  incomingTasks.slice(0, 3).map((t: { id: number; subject: string; status?: string }) => ({
          id: t.id, subject: t.subject, status: t.status ?? '',
        })),
      },
      sprint: {
        current:    currentSprint,
        stats:      sprintStats,
      },
      backlog: {
        count:   staleTasks.length,
        preview: staleTasks.slice(0, 3).map((t: { id: number; subject: string }) => ({ id: t.id, subject: t.subject })),
      },
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
