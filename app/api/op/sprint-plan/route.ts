import { getOpToken, getOpBaseUrl } from '@/lib/user-config'
import { getLLMConfig } from '@/lib/llm'
import { NextResponse } from 'next/server'
import { loadCache } from '@/lib/op-cache'

const OP_BASE = getOpBaseUrl()
const OP_TOKEN = getOpToken()

export async function GET() {
  if (!OP_BASE || !OP_TOKEN) return NextResponse.json({ error: 'OP not configured' }, { status: 500 })

  const auth  = 'Basic ' + Buffer.from(`apikey:${OP_TOKEN}`).toString('base64')
  const cache = loadCache()

  const sprintList = (cache.sprints ?? [])
  const currentSprint = sprintList.find(s => s.isCurrent)
  if (!currentSprint) return NextResponse.json({ error: 'No current sprint' }, { status: 404 })

  const nextSprint = sprintList
    .filter(s => !s.isCurrent && s.startDate > currentSprint.startDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null

  // Get current user ID from cache (set during rebuild from /users/me)
  const userId = String(cache.userId ?? 8)

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

  // Fetch ALL my tasks in current sprint — single query, no status filter
  // Filter into carryOver/done in code to avoid status ID uncertainty
  const allFilters = encodeURIComponent(JSON.stringify([
    { version:     { operator: '=', values: [String(currentSprint.id)] } },
    { type:        { operator: '!', values: ['5'] } },  // not epic
    { assigned_to: { operator: '=', values: [userId] } },
  ]))

  let carryOver: WPItem[] = []
  let doneTasks: WPItem[] = []

  try {
    const res = await fetch(`${OP_BASE}/api/v3/work_packages?filters=${allFilters}&pageSize=200`, { headers: { Authorization: auth } })
    if (res.ok) {
      const all = parseWPs((await res.json())._embedded?.elements ?? [])
      // Closed = Closed status (title). Everything else = carry-over.
      carryOver = all.filter(t => t.status !== 'Closed' && t.status !== 'Rejected')
      doneTasks = all.filter(t => t.status === 'Closed')
    }
  } catch { /* non-fatal */ }

  // Sprint number
  const currentNum = parseInt(currentSprint.name.replace(/\D/g, '')) || 0
  const suggestedNum = currentNum + 1

  // Work stats for AI context
  const totalEst   = [...carryOver, ...doneTasks].reduce((a, t) => a + (t.estimatedHours ?? 0), 0)
  const totalSpent = [...carryOver, ...doneTasks].reduce((a, t) => a + (t.spentHours ?? 0), 0)
  const openEst    = carryOver.reduce((a, t) => a + (t.estimatedHours ?? 0), 0)

  return NextResponse.json({
    currentSprint, nextSprint, carryOver, doneTasks,
    aiConfigured: !!getLLMConfig(),
    aiName: null,
    aiSummary: null,
    aiSuggestedTasks: [],
    suggestedNum,
  })
}
