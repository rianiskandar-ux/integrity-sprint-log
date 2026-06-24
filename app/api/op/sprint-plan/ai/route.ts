import { callLLM, getLLMConfig } from '@/lib/llm'
import { NextResponse } from 'next/server'
import { loadCache } from '@/lib/op-cache'
import { loadUserConfig } from '@/lib/user-config'
import { getRequestContext } from '@/lib/request-auth'

export const runtime = 'nodejs'

export async function GET() {
  // Fall back to the local Claude CLI (always available) when no global LLM is set,
  // so AI generate works without configuring an API key in Settings.
  const llmCfg = getLLMConfig() ?? { provider: 'claude-cli' as const, apiKey: '', model: 'claude' }

  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { opToken: OP_TOKEN, opBaseUrl: OP_BASE, uid, opUserId } = ctx

  try {  // outer guard — ALWAYS return JSON, never an HTML error page

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

  // Keep the prompt LEAN — a huge prompt makes claude-cli slow enough to 504.
  const carryLines = carryOver.slice(0, 12).map(t =>
    `- ${t.subject} (${t.status})`
  ).join('\n')
  const doneLines = doneTasks.slice(0, 10).map(t => `- ${t.subject}`).join('\n')

  // ISL work notes for this sprint — the DETAIL behind the tasks (source of insights).
  // Capped tight so the prompt stays small and fast.
  const { getAllSessions } = await import('@/lib/session-store')
  const sprintSessions = (await getAllSessions(uid))
    .filter(s => s.pushStatus !== 'discarded' && s.date >= currentSprint.startDate && s.date <= currentSprint.endDate)
  const findingsBlock = sprintSessions.slice(0, 8).map(s =>
    `- ${s.title}${(s.bullets?.length ? ': ' + s.bullets.slice(0, 2).map(b => b.slice(0, 90)).join('; ') : '')}`
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

WORK NOTES & FINDINGS (detail dari ISL — SUMBER UTAMA buat insight & ide task baru):
${findingsBlock || '(none)'}

ALL output (theme, goal, summary, task subjects & reasons) MUST be in ENGLISH —
this content goes to OpenProject, which is English by default.

Reply with JSON only — no markdown, no extra text:
{
  "theme": "2-4 word sprint theme",
  "goal": "one clear sentence sprint goal for Sprint #${suggestedNum}",
  "suggestions": ["alt theme 1", "alt theme 2"],
  "suggestedTasks": [
    {
      "subject": "task title (specific, actionable, English)",
      "type": "Task|Bug|Feature|User Story",
      "projectHint": "project name or area",
      "estimatedHours": 2,
      "priority": "high|medium|low",
      "reason": "one sentence why — if from WORK NOTES/findings, name the finding"
    }
  ]
}

Rules for suggestedTasks:
- Suggest 3-6 NEW tasks (not carry-over, those are already tracked)
- PRIORITIZE ideas surfaced by the WORK NOTES & FINDINGS (follow-up, edge case, tech debt, bug spotted while working)
- Then what logically comes AFTER the done tasks or unblocks carry-over
- Specific & actionable — not generic like "fix bugs"
- Realistic total hours for one sprint

After the JSON above, write a line that is EXACTLY: ===SUMMARY===
Then below it write the sprint recap as PLAIN TEXT (not JSON; multi-line & emoji OK).
Write in ENGLISH — this goes to OpenProject, which is English by default. Natural,
like a real team member reflecting (not a stiff status report). EXACT format:

Sprint #${currentNum} — ${sprintPeriod}
${projectNames} · ${displayName}

[1-2 SHORT sentences, to the point: what got done + overall state (blocked or smooth). No filler, no jargon, no the-team. Keep it tight — this is a quick read.]

✅ COMPLETED
[each done task, one line: ✓ subject]

➡️ CARRYING OVER → Sprint #${suggestedNum}
[each carry-over, one line: → subject (status)]

🔍 FINDINGS & NEW TASK IDEAS
[2-4 insights from the WORK NOTES above — things discovered while working (edge case, tech debt, follow-up, bug) worth turning into new tasks. Each: • insight → task idea]

🎯 NEXT SPRINT FOCUS
[1 sentence: the most important thing to do in Sprint #${suggestedNum}]

${doneTasks.length} done · ${carryOver.length} carrying over · ${openEst.toFixed(1)}h remaining`

  try {
    const text = await callLLM(prompt, llmCfg)
    // Summary is emitted as PLAIN TEXT after ===SUMMARY=== (robust — avoids the
    // fragile multi-line-string-inside-JSON parsing that silently produced null).
    const parts = text.split(/===\s*SUMMARY\s*===/i)
    const summary = (parts[1] ?? '').trim() || null
    let json: Record<string, unknown> = {}
    try { json = JSON.parse((parts[0] ?? text).match(/\{[\s\S]*\}/)?.[0] ?? '{}') } catch { /* keep summary even if JSON fails */ }
    return NextResponse.json({
      aiName: json.theme ? {
        full: `Sprint #${suggestedNum}: ${json.theme}`,
        theme: json.theme,
        goal: json.goal ?? null,
        suggestions: json.suggestions ?? [],
      } : null,
      aiSummary: summary ?? (json.summary as string) ?? null,
      aiSuggestedTasks: json.suggestedTasks ?? [],
    })
  } catch (e) {
    console.error('[sprint-plan/ai] LLM error:', e)
    return NextResponse.json({ aiName: null, aiSummary: null, aiSuggestedTasks: [], error: String(e) })
  }

  } catch (outer) {
    console.error('[sprint-plan/ai] fatal:', outer)
    return NextResponse.json({ aiName: null, aiSummary: null, aiSuggestedTasks: [], error: String(outer) }, { status: 200 })
  }
}
