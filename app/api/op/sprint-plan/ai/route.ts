import { callLLM, getLLMConfig } from '@/lib/llm'
import { NextResponse } from 'next/server'
import { loadCache } from '@/lib/op-cache'
import { loadUserConfig } from '@/lib/user-config'
import { getRequestContext } from '@/lib/request-auth'

export const runtime = 'nodejs'

export async function GET() {
  const llmCfg = getLLMConfig()
  if (!llmCfg) return NextResponse.json({ aiName: null, aiSummary: null, aiSuggestedTasks: [] })

  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { opToken: OP_TOKEN, opBaseUrl: OP_BASE, uid, opUserId } = ctx

  const auth  = 'Basic ' + Buffer.from(`apikey:${OP_TOKEN}`).toString('base64')
  const cache = loadCache(uid)

  const sprintList = (cache.sprints ?? [])
  const currentSprint = sprintList.find(s => s.isCurrent)
  if (!currentSprint) return NextResponse.json({ error: 'No current sprint' }, { status: 404 })

  const userCfg      = loadUserConfig()
  const displayName  = userCfg.displayName || 'Team Member'
  const userId       = String(cache.userId ?? opUserId)
  const currentNum   = parseInt(currentSprint.name.replace(/\D/g, '')) || 0
  const suggestedNum = currentNum + 1
  const sprintPeriod = `${currentSprint.startDate} – ${currentSprint.endDate}`
  const projectNames = [...new Set([
    ...((cache.myOpenTasks ?? []) as { project?: string }[]).map(t => t.project),
    ...((cache.myClosedTasks ?? []) as { project?: string }[]).map(t => t.project),
  ].filter(Boolean))].join(', ') || 'Integrity Asia'

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
- Period: ${sprintPeriod}
- Projects: ${projectNames}
- Member: ${displayName}
- Total tasks: ${carryOver.length + doneTasks.length} (${doneTasks.length} done, ${carryOver.length} carry-over)
- Total estimated: ${totalEst.toFixed(1)}h | Total spent: ${totalSpent.toFixed(1)}h
- Remaining open work: ${openEst.toFixed(1)}h

CARRY-OVER (${carryOver.length} tasks):
${carryLines || '(none)'}

DONE THIS SPRINT (${doneTasks.length} tasks):
${doneLines || '(none)'}

Reply with JSON only — no markdown, no extra text:
{
  "theme": "2-4 word sprint theme",
  "goal": "one clear sentence sprint goal for Sprint #${suggestedNum}",
  "suggestions": ["alt theme 1", "alt theme 2"],
  "summary": "Sprint report in this exact format — output plain text, not JSON string:\\nSprint #${currentNum} — ${sprintPeriod}\\n${projectNames} · ${displayName}\\n\\n[1 short paragraph: what got done, what's still going, and why. Write like a real team member reflecting, not a status report. No jargon, no 'the team', no 'momentum'. Max 3 sentences.]\\n\\nCOMPLETED\\n[list each done task as: ✓ subject]\\n\\nCARRYING OVER → Sprint #${suggestedNum}\\n[list each carry-over as: → subject (status)]\\n\\nNEXT SPRINT FOCUS\\n[1 sentence: what specifically needs to happen in Sprint #${suggestedNum}]\\n\\n${doneTasks.length} done · ${carryOver.length} carry-over · ${openEst.toFixed(1)}h remaining",
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
