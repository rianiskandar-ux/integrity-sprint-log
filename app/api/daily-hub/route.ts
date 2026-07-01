import { NextResponse } from 'next/server'
import { getAllSessions, updateSession } from '@/lib/session-store'
import { getAllKBEntries, saveKBEntry, createKBId } from '@/lib/kb-store'
import { loadCache } from '@/lib/op-cache'
import { getRequestContext } from '@/lib/request-auth'

// GET /api/daily-hub — hub sessions + KB entries + AI suggest context
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10)
    const ctx  = await getRequestContext()

    const hubSessions = (await getAllSessions(ctx?.uid)).filter(s =>
      (s.pushStatus === 'hub' || s.pushStatus === 'live') && s.taskStatus !== 'backlog'
    )
    const kbEntries = (await getAllKBEntries(ctx?.uid)).filter(e => e.triageStatus === 'hub')

    // Load sprint context for AI suggest
    let sprintContext = null
    try {
      const cache = loadCache(ctx?.uid)
      const today = new Date().toISOString().slice(0, 10)
      const currentSprint = (cache.sprints ?? []).find((s: { isCurrent?: boolean; startDate?: string; endDate?: string }) =>
        s.isCurrent === true || ((s.startDate ?? '') <= today && (s.endDate ?? '') >= today)
      )
      const openTasks = (cache.myOpenTasks ?? []).slice(0, 10).map((t: { id: number; subject: string; status?: string; estimatedTime?: string }) => ({
        id: t.id, subject: t.subject, status: t.status, estimatedTime: t.estimatedTime,
      }))
      sprintContext = { sprint: currentSprint, openTasks }
    } catch {}

    return NextResponse.json({ hubSessions, kbEntries, sprintContext, date })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// POST /api/daily-hub — save KB entry dari session
export async function POST(req: Request) {
  try {
    const ctx = await getRequestContext()
    if (process.env.ISL_MULTIUSER === '1' && !ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const body = await req.json()
    const now = new Date().toISOString()
    const entry = {
      id: createKBId(),
      userId: ctx?.uid ?? null,
      sessionId: body.sessionId,
      date: body.date ?? now.slice(0, 10),
      title: body.title ?? 'Untitled',
      summary: body.summary ?? '',
      keyPoints: body.keyPoints ?? [],
      suggestedTask: body.suggestedTask,
      estimatedMins: body.estimatedMins,
      triageStatus: 'hub' as const,
      sprintTarget: body.sprintTarget,
      createdAt: now,
      updatedAt: now,
    }
    await saveKBEntry(entry)
    return NextResponse.json({ ok: true, entry })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// PATCH /api/daily-hub — triage: move session to queue/backlog/discard
export async function PATCH(req: Request) {
  try {
    const body = await req.json()
    const { sessionId, kbId, action, sprintTarget } = body
    // action: 'queue' | 'backlog' | 'discard'

    if (sessionId) {
      const patchCtx    = await getRequestContext()
      const allSessions = await getAllSessions(patchCtx?.uid)
      const session = allSessions.find(s => s.id === sessionId || s.sessionId === sessionId)
      if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

      const newPushStatus = action === 'queue' ? 'pending'
        : action === 'discard' ? 'discarded'
        : 'hub'

      await updateSession(session.id, {
        pushStatus: newPushStatus,
        taskStatus: action === 'backlog' ? 'backlog' : session.taskStatus,
      })
    }

    if (kbId) {
      const { updateKBEntry } = await import('@/lib/kb-store')
      await updateKBEntry(kbId, {
        triageStatus: action === 'queue' ? 'queue'
          : action === 'backlog' ? 'backlog'
          : 'discarded',
        sprintTarget: sprintTarget ?? (action === 'backlog' ? 'backlog' : 'current'),
      })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
