import { NextResponse } from 'next/server'
import { getAllSessions } from '@/lib/session-store'
import { loadCache } from '@/lib/op-cache'
import { getRequestContext } from '@/lib/request-auth'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    // Accept date range (from sprintMeta) instead of ISL sprint number
    const startDateParam = searchParams.get('startDate') ?? ''
    const endDateParam   = searchParams.get('endDate') ?? ''

    const ctx      = await getRequestContext()
    const sessions = await getAllSessions()
    const cache    = loadCache(ctx?.uid)

    const currentSprint = (cache.sprints ?? []).find((s: { isCurrent: boolean }) => s.isCurrent) ?? null
    const allSprints    = (cache.sprints ?? []) as { id: number; name: string; startDate: string; endDate: string; status: string; projectIdentifier: string; isCurrent: boolean }[]

    // Find OP sprint by date overlap with given range, fall back to current
    let targetSprint = currentSprint
    if (startDateParam && endDateParam) {
      const match = allSprints.find(s =>
        s.startDate <= endDateParam && s.endDate >= startDateParam
      )
      if (match) targetSprint = match
    }

    // ISL sessions for this sprint — filter by the OP sprint's actual date range if available,
    // otherwise fall back to the requested date range
    const filterStart = targetSprint?.startDate ?? startDateParam
    const filterEnd   = targetSprint?.endDate   ?? endDateParam

    let islSessions = sessions.filter(s => s.pushStatus === 'pushed' || s.pushStatus === 'pending')
    if (filterStart && filterEnd) {
      islSessions = islSessions.filter(s => s.date >= filterStart && s.date <= filterEnd)
    }

    // ISL stats — cap per-session at 480 min (8h) to prevent hook timer bugs inflating totals
    const MAX_SESSION_MINS = 480
    const totalRealMins = islSessions.reduce((a, s) => a + Math.min(s.actualMins ?? s.estimatedMins ?? 0, MAX_SESSION_MINS), 0)
    const totalEstMins  = islSessions.reduce((a, s) => a + Math.min(s.estimatedMins ?? 0, MAX_SESSION_MINS), 0)
    const sessionCount  = islSessions.length

    // Topic/keyword frequency from session titles + bullets
    const wordFreq: Record<string, number> = {}
    for (const s of islSessions) {
      const words = [s.title, ...(s.bullets ?? [])].join(' ')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3 && !['with','that','this','from','have','been','will','when','they','their','were','also','into','more','than','then','your','what','just','about','made','make','using','used','added','fixed'].includes(w))
      for (const w of words) wordFreq[w] = (wordFreq[w] ?? 0) + 1
    }
    const topTopics = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([word, count]) => ({ word, count }))

    // Projects worked on
    const projectFreq: Record<string, number> = {}
    for (const s of islSessions) {
      const proj = s.source ?? 'General'
      projectFreq[proj] = (projectFreq[proj] ?? 0) + 1
    }

    // OP stats for this sprint
    type WP = { id: number; subject: string; versionId?: number | null; status?: string; estimatedTime?: string | null; spentTime?: string | null }
    const myOpen   = (cache.myOpenTasks   ?? []) as WP[]
    const myClosed = (cache.myClosedTasks ?? []) as WP[]

    function parseIsoDur(dur: unknown): number {
      if (!dur || typeof dur !== 'string') return 0
      const m = dur.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/)
      if (!m) return 0
      return (Number(m[1] ?? 0) * 24) + Number(m[2] ?? 0) + (Number(m[3] ?? 0) / 60)
    }

    const opOpen   = targetSprint ? myOpen.filter(t => t.versionId === targetSprint!.id) : []
    const opClosed = targetSprint ? myClosed.filter(t => t.versionId === targetSprint!.id) : []
    const opAll    = [...opOpen, ...opClosed]

    const opTotalEst   = opAll.reduce((a, t) => a + parseIsoDur(t.estimatedTime), 0)
    const opTotalSpent = opAll.reduce((a, t) => a + parseIsoDur(t.spentTime), 0)
    const opDone       = opClosed.length
    const opTotal      = opAll.length
    const opPct        = opTotal > 0 ? Math.round(opDone / opTotal * 100) : 0

    // Days remaining
    const daysLeft = targetSprint
      ? Math.max(0, Math.floor((new Date(targetSprint.endDate).getTime() - Date.now()) / 86400000))
      : null

    // Recent sessions (last 5)
    const recentSessions = islSessions
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
      .slice(0, 5)
      .map(s => ({
        id: s.id, date: s.date, title: s.title,
        mins: s.actualMins ?? s.estimatedMins ?? 0,
        opTaskId: s.opTaskId ?? null,
        pushStatus: s.pushStatus,
      }))

    // Deduplicate sprints by id (same sprint appears once per project in cache)
    const seenIds = new Set<number>()
    const uniqueSprints = allSprints.filter(s => { if (seenIds.has(s.id)) return false; seenIds.add(s.id); return true })

    return NextResponse.json({
      sprint: targetSprint,
      allSprints: uniqueSprints.map(s => ({ id: s.id, name: s.name, startDate: s.startDate, endDate: s.endDate, isCurrent: s.isCurrent })),
      isl: {
        sessionCount, totalRealMins, totalEstMins,
        topTopics, projectFreq, recentSessions,
      },
      op: {
        total: opTotal, done: opDone, pct: opPct,
        totalEst: opTotalEst, totalSpent: opTotalSpent,
        openCount: opOpen.length,
      },
      daysLeft,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
