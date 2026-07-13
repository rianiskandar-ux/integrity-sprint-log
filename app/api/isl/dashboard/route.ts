import { NextResponse } from 'next/server'
import { getAllSessions } from '@/lib/session-store'
import { loadCache } from '@/lib/op-cache'
import { getRequestContext } from '@/lib/request-auth'

export async function GET() {
  try {
    const ctx = await getRequestContext()
    // Multi-user: require auth so the dashboard never aggregates across users.
    if (process.env.ISL_MULTIUSER === '1' && !ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const sessions = await getAllSessions(ctx?.uid)
    const cache    = loadCache(ctx?.uid)

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
    const myOpen   = (cache.myOpenTasks   ?? []) as { sprintId?: number | null }[]
    const myClosed = (cache.myClosedTasks ?? []) as { sprintId?: number | null }[]
    const sprintStats = currentSprint ? (() => {
      const done  = myClosed.filter(t => t.sprintId === currentSprint.id).length
      const open  = myOpen.filter(t => t.sprintId === currentSprint.id).length
      const total = done + open
      return total > 0 ? { total, done, pct: Math.round(done / total * 100) } : null
    })() : null

    // Backlog — my open tasks with no sprint/version assigned
    const staleTasks = myOpen.filter(
      (t: { sprintId?: number | null }) => !t.sprintId
    ) as { id: number; subject: string }[]

    // Today's activity
    const today = new Date().toISOString().slice(0, 10)
    const todaySessions = sessions.filter(s => s.date === today && s.pushStatus === 'pushed')
    const todayMins     = todaySessions.reduce((a, s) => a + (s.actualMins ?? s.estimatedMins ?? 0), 0)

    // Sprint capacity — two sources of truth:
    // 1. ISL logged: sessions pushed to OP in this sprint (actual work tracked via ISL)
    // 2. OP scheduled: estimatedTime on tasks assigned to this sprint (planned work from OP side)
    function parseIsoDur(dur: unknown): number {
      if (!dur || typeof dur !== 'string') return 0
      const m = dur.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/)
      if (!m) return 0
      return ((Number(m[1] ?? 0) * 24) + Number(m[2] ?? 0) + (Number(m[3] ?? 0) / 60)) * 60
    }

    const sprintStart = currentSprint?.startDate ?? ''
    const sprintEnd   = currentSprint?.endDate ?? ''

    // ISL logged: pushed sessions whose date falls in sprint range
    const islLoggedMins = currentSprint
      ? sessions
          .filter(s => s.pushStatus === 'pushed' && s.date >= sprintStart && s.date <= sprintEnd)
          .reduce((a, s) => a + (s.actualMins ?? s.estimatedMins ?? 0), 0)
      : 0

    // ISL pending: not yet pushed but in sprint range
    const islPendingMins = currentSprint
      ? sessions
          .filter(s => s.pushStatus === 'pending' && s.date >= sprintStart && s.date <= sprintEnd)
          .reduce((a, s) => a + (s.actualMins ?? s.estimatedMins ?? 0), 0)
      : 0

    // Note: OP direct time entries not cached — capacity shows ISL actual only

    // Estimation accuracy — only sessions with a MEASURED actual time (not defaulted).
    // Period: current sprint if available, else last 14 days.
    const since14 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const accPeriodStart = currentSprint ? sprintStart : since14
    const accPeriodEnd   = currentSprint ? sprintEnd   : today
    const accuracySessions = sessions.filter(s =>
      s.actualMins != null && s.actualMins > 0 &&
      s.estimatedMins != null && s.estimatedMins > 0 &&
      s.date >= accPeriodStart && s.date <= accPeriodEnd
    )
    const accEst    = accuracySessions.reduce((a, s) => a + (s.estimatedMins ?? 0), 0)
    const accActual = accuracySessions.reduce((a, s) => a + (s.actualMins ?? 0), 0)
    const accuracy = accuracySessions.length >= 2 && accEst > 0 ? {
      count:       accuracySessions.length,
      totalEst:    Math.round(accEst),
      totalActual: Math.round(accActual),
      variancePct: Math.round((accActual - accEst) / accEst * 100),  // + = over estimate, - = under
      period:      currentSprint ? (currentSprint.name ?? 'sprint ini') : '14 hari terakhir',
    } : { count: accuracySessions.length, period: currentSprint ? (currentSprint.name ?? 'sprint ini') : '14 hari terakhir' }

    return NextResponse.json({
      accuracy,
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
      capacity: {
        islLoggedMins:  Math.round(islLoggedMins),
        islPendingMins: Math.round(islPendingMins),
        targetMinMins:  2400,  // 40h
        targetMaxMins:  3600,  // 60h
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
