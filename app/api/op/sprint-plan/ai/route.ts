import { getOpToken, getOpBaseUrl } from '@/lib/user-config'
import { callLLM, getLLMConfig } from '@/lib/llm'
import { NextResponse } from 'next/server'
import { loadCache } from '@/lib/op-cache'

const OP_BASE = getOpBaseUrl()
const OP_TOKEN = getOpToken()

export async function GET() {
  const llmCfg = getLLMConfig()
  if (!llmCfg) return NextResponse.json({ aiName: null, aiSummary: null, aiSuggestedTasks: [] })
  if (!OP_BASE || !OP_TOKEN) return NextResponse.json({ error: 'OP not configured' }, { status: 500 })

  const auth  = 'Basic ' + Buffer.from(`apikey:${OP_TOKEN}`).toString('base64')
  const cache = loadCache()

  const sprintList = (cache.sprints ?? [])
  const currentSprint = sprintList.find(s => s.isCurrent)
  if (!currentSprint) return NextResponse.json({ error: 'No current sprint' }, { status: 404 })

  const userId = String(cache.userId ?? 8)
  const currentNum   = parseInt(currentSprint.name.replace(/\D/g, '')) || 0
  const suggestedNum = currentNum + 1

  function parseIsoDur(dur: unknown): number | null {
    if (!dur || typeof dur !== 'string') return null
    const m = dur.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/)
    if (!m) return null
    return (Number(m[1] ?? 0) * 24) + Number(m[2] ?? 0) + (Number(m[3] ?? 0) / 60)
  }

  type WPItem = {
    id: number; subject: string; status: string; type: string; project: string
    estimatedHours: number | null; spentHours: number | null; percentDone: number
  }

  function parseWPs(elements: Record<string, unknown>[]): WPItem[] {
    return elements.map(wp => {
      const links = (wp._links ?? {}) as Record<string, { title?: string } | null>
      return {
        id:             wp.id as number,
        subject:        wp.subject as string,
        status:         links.status?.title ?? '',
        type:           links.type?.title ?? '',
        project:        links.project?.title ?? '',
        estimatedHours: parseIsoDur(wp.estimatedTime),
        spentHours:     parseIsoDur(wp.spentTime),
        percentDone:    (wp.percentageDone as number) ?? 0,
      }
    })
  }

  const allFilters = encodeURIComponent(JSON.stringify([
    { version:     { operator: '=', values: [String(currentSprint.id)] } },
    { type:        { operator: '!', values: ['5'] } },
    { assigned_to: { operator: '=', values: [userId] } },
  ]))

  let carryOver: WPItem[] = []
  let doneTasks: WPItem[] = []

  try {
    const res = await fetch(`${OP_BASE}/api/v3/work_packages?filters=${allFilters}&pageSize=200`, { headers: { Authorization: auth } })
    if (res.ok) {
      const all = parseWPs((await res.json())._embedded?.elements ?? [])
      carryOver = all.filter(t => t.status !== 'Closed' && t.status !== 'Rejected')
      doneTasks = all.filter(t => t.status === 'Closed')
    }
  } catch { /* non-fatal */ }

  const totalEst   = [...carryOver, ...doneTasks].reduce((a, t) => a + (t.estimatedHours ?? 0), 0)
  const totalSpent = [...carryOver, ...doneTasks].reduce((a, t) => a + (t.spentHours ?? 0), 0)
  const openEst    = carryOver.reduce((a, t) => a + (t.estimatedHours ?? 0), 0)

  const carryLines = carryOver.slice(0, 20).map(t =>
    `- #${t.id} [${t.type}] ${t.subject} | ${t.project} | ${t.status} | est ${t.estimatedHours ?? 0}h spent ${t.spentHours ?? 0}h (${t.percentDone}%)`
  ).join('\n')
  const doneLines = doneTasks.slice(0, 10).map(t =>
    `- #${t.id} [${t.type}] ${t.subject} | ${t.project} | est ${t.estimatedHours ?? 0}h spent ${t.spentHours ?? 0}h`
  ).join('\n')

  const prompt = `You are a sprint planning assistant for a software team. Analyze Sprint #${currentNum} and create a complete plan for Sprint #${suggestedNum}.

SPRINT #${currentNum} DATA:
- Period: ${currentSprint.startDate} → ${currentSprint.endDate}
- Total tasks: ${carryOver.length + doneTasks.length} (${doneTasks.length} done, ${carryOver.length} carry-over)
- Total estimated: ${totalEst.toFixed(1)}h | Total spent: ${totalSpent.toFixed(1)}h
- Remaining open work: ${openEst.toFixed(1)}h

CARRY-OVER (${carryOver.length} tasks — these must enter Sprint #${suggestedNum}):
${carryLines || '(none)'}

DONE THIS SPRINT (${doneTasks.length} tasks):
${doneLines || '(none)'}

Reply with JSON only — no markdown, no extra text:
{
  "theme": "2-4 word sprint theme",
  "goal": "one clear sentence sprint goal for Sprint #${suggestedNum}",
  "suggestions": ["alt theme 1", "alt theme 2"],
  "summary": "2-3 sentence sprint retrospective: what was accomplished, what's carrying over, and key focus for next sprint",
  "suggestedTasks": [
    {
      "subject": "task title (be specific, actionable)",
      "type": "Task|Bug|Feature|User Story",
      "projectHint": "project name or area",
      "estimatedHours": 2,
      "priority": "high|medium|low",
      "reason": "one sentence why this should be in Sprint #${suggestedNum}"
    }
  ]
}

Rules for suggestedTasks:
- Suggest 3-6 NEW tasks (not carry-over, those are already tracked)
- Focus on what logically comes AFTER the done tasks or unblocks carry-over
- Be specific and actionable — not generic like "fix bugs"
- Total estimated hours for new tasks should fit a realistic sprint capacity`

  try {
    const text = await callLLM(prompt, llmCfg)
    const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '{}')
    return NextResponse.json({
      aiName: json.theme ? {
        full: `Sprint #${suggestedNum}: ${json.theme}`,
        theme: json.theme,
        goal: json.goal ?? null,
        suggestions: json.suggestions ?? [],
      } : null,
      aiSummary: json.summary ?? null,
      aiSuggestedTasks: json.suggestedTasks ?? [],
    })
  } catch (e) {
    console.error('[sprint-plan/ai] LLM error:', e)
    return NextResponse.json({ aiName: null, aiSummary: null, aiSuggestedTasks: [], error: String(e) })
  }
}
