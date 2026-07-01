import { getLLMConfig } from '@/lib/llm'
import { NextResponse } from 'next/server'
import { loadCache } from '@/lib/op-cache'
import { getRequestContext } from '@/lib/request-auth'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { opToken: OP_TOKEN, opBaseUrl: OP_BASE, uid, opUserId } = ctx

  const auth  = 'Basic ' + Buffer.from(`apikey:${OP_TOKEN}`).toString('base64')
  const cache = loadCache(uid)

  const sprintList = (cache.sprints ?? [])
  const currentSprint = sprintList.find(s => s.isCurrent)

  const userId = String(cache.userId ?? opUserId)

  type WPItem = {
    id: number; subject: string; status: string; type: string; project: string; assignee: string | null
    estimatedHours: number | null; spentHours: number | null; percentDone: number
  }

  function parseIsoDur(dur: unknown): number | null {
    if (!dur || typeof dur !== 'string') return null
    const m = dur.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/)
    if (!m) return null
    return (Number(m[1] ?? 0) * 24) + Number(m[2] ?? 0) + (Number(m[3] ?? 0) / 60)
  }

  function parseWPs(elements: Record<string, unknown>[]): WPItem[] {
    return elements.map(wp => {
      const links = (wp._links ?? {}) as Record<string, { title?: string; href?: string } | null>
      return {
        id:             wp.id as number,
        subject:        wp.subject as string,
        status:         links.status?.title ?? '',
        type:           links.type?.title ?? '',
        project:        links.project?.title ?? '',
        assignee:       links.assignee?.title ?? null,
        estimatedHours: parseIsoDur(wp.estimatedTime),
        spentHours:     parseIsoDur(wp.spentTime),
        percentDone:    (wp.percentageDone as number) ?? 0,
      }
    })
  }

  async function fetchSprintTasks(versionId: number): Promise<WPItem[]> {
    const filters = encodeURIComponent(JSON.stringify([
      { version:  { operator: '=', values: [String(versionId)] } },
      { type:     { operator: '!', values: ['5'] } },  // exclude Epics; US/Feature shown as read-only
      { assignee: { operator: '=', values: [userId] } },
    ]))
    try {
      const res = await fetch(`${OP_BASE}/api/v3/work_packages?filters=${filters}&pageSize=200`, { headers: { Authorization: auth } })
      if (res.ok) return parseWPs((await res.json())._embedded?.elements ?? [])
    } catch { /* non-fatal */ }
    return []
  }

  // Historical sprint view — fetch by sprintId param
  const { searchParams } = new URL(req.url)
  const sprintIdParam = searchParams.get('sprintId')

  if (sprintIdParam) {
    const targetId = parseInt(sprintIdParam)
    const targetSprint = sprintList.find(s => s.id === targetId)
    if (!targetSprint) return NextResponse.json({ error: 'Sprint tidak ditemukan' }, { status: 404 })

    const allTasks  = await fetchSprintTasks(targetId)
    const carryOver = allTasks.filter(t => t.status !== 'Closed' && t.status !== 'Rejected')
    const doneTasks = allTasks.filter(t => t.status === 'Closed' || t.status === 'Rejected')

    return NextResponse.json({
      currentSprint:  targetSprint,
      nextSprint:     null,
      carryOver,
      doneTasks,
      nextTasks:      [],
      isHistorical:   !targetSprint.isCurrent,
      aiConfigured:   false,
      aiName:         null,
      aiSummary:      null,
      aiSuggestedTasks: [],
      suggestedNum:   0,
    })
  }

  // Active sprint (default)
  if (!currentSprint) return NextResponse.json({ error: 'No current sprint' }, { status: 404 })

  const nextSprint = sprintList
    .filter(s => !s.isCurrent && s.startDate > currentSprint.startDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null

  const allCurrent = await fetchSprintTasks(currentSprint.id)
  const carryOver  = allCurrent.filter(t => t.status !== 'Closed' && t.status !== 'Rejected')
  const doneTasks  = allCurrent.filter(t => t.status === 'Closed')
  const nextTasks  = nextSprint ? await fetchSprintTasks(nextSprint.id) : []

  const currentNum = parseInt(currentSprint.name.replace(/\D/g, '')) || 0

  return NextResponse.json({
    currentSprint, nextSprint, carryOver, doneTasks, nextTasks,
    isHistorical:   false,
    aiConfigured:   !!getLLMConfig(),
    aiName:         null,
    aiSummary:      null,
    aiSuggestedTasks: [],
    suggestedNum:   currentNum + 1,
  })
}
