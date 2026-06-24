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

  // ISL work notes for this sprint — the DETAIL behind the tasks (source of insights)
  const { getAllSessions } = await import('@/lib/session-store')
  const sprintSessions = (await getAllSessions(uid))
    .filter(s => s.pushStatus !== 'discarded' && s.date >= currentSprint.startDate && s.date <= currentSprint.endDate)
  const findingsBlock = sprintSessions.slice(0, 25).map(s =>
    `- ${s.title}${(s.bullets?.length ? ':\n' + s.bullets.slice(0, 4).map(b => `    • ${b}`).join('\n') : '')}`
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

Reply with JSON only — no markdown, no extra text:
{
  "theme": "2-4 word sprint theme",
  "goal": "one clear sentence sprint goal for Sprint #${suggestedNum}",
  "suggestions": ["alt theme 1", "alt theme 2"],
  "suggestedTasks": [
    {
      "subject": "task title (spesifik, actionable)",
      "type": "Task|Bug|Feature|User Story",
      "projectHint": "project name or area",
      "estimatedHours": 2,
      "priority": "high|medium|low",
      "reason": "one sentence why — kalau dari WORK NOTES/findings, sebutkan temuannya"
    }
  ]
}

Rules for suggestedTasks:
- Suggest 3-6 NEW tasks (not carry-over, those are already tracked)
- PRIORITASKAN ide yang muncul dari WORK NOTES & FINDINGS (follow-up, edge case, tech debt, bug yang ke-spot saat ngerjain)
- Lalu yang logis datang SETELAH task done atau yang unblock carry-over
- Spesifik & actionable — bukan generik seperti "fix bugs"
- Total jam realistis buat 1 sprint

SETELAH JSON di atas, tulis baris berisi PERSIS: ===SUMMARY===
Lalu di bawahnya tulis recap sprint sebagai TEKS BIASA (bukan JSON, boleh multi-baris & emoji),
Bahasa Indonesia natural seperti orang cerita (bukan laporan kaku), format PERSIS ini:

Sprint #${currentNum} — ${sprintPeriod}
${projectNames} · ${displayName}

[2-3 kalimat NARATIF: apa yang sudah dikerjakan & hasilnya, ada kendala/blocker atau lancar. Ceritakan inti & dampaknya, jangan cuma sebut nama task. Hindari jargon & kata 'tim'.]

✅ SELESAI
[tiap task done: ✓ subject — (kalau ada di work notes, tambah 1 frasa hasil/dampaknya)]

➡️ LANJUT KE Sprint #${suggestedNum}
[tiap carry-over: → subject (status) — (1 frasa kenapa belum kelar / saran biar kelar)]

🔍 TEMUAN & IDE TASK BARU
[2-4 poin insight dari WORK NOTES di atas — hal yang ke-discover saat ngerjain (edge case, tech debt, follow-up, bug) yang layak jadi task baru. Tiap poin: • insight → ide task]

🎯 FOKUS Sprint #${suggestedNum}
[1 kalimat: yang paling penting dikerjain di Sprint #${suggestedNum}]

${doneTasks.length} selesai · ${carryOver.length} lanjut · ${openEst.toFixed(1)}h sisa`

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
}
