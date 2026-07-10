import { NextResponse } from 'next/server'
import { callLLM, getLLMConfig } from '@/lib/llm'
import { getRequestContext } from '@/lib/request-auth'
import { db, taskMemory } from '@/lib/db'
import { eq, desc } from 'drizzle-orm'
import { getAllSessions } from '@/lib/session-store'
import { getTaskChatByOpTask } from '@/lib/chat-store'

export const runtime = 'nodejs'
export const maxDuration = 300

// POST /api/op/activity-summary — "Activity Log Sync":
//   mode 'preview' (default): generate an ENGLISH summary of a task-bound chat via LLM.
//   mode 'post': post the (user-approved) summary as an activity comment on the OP ticket.
//   mode 'task-note': draft an ENGLISH progress note from the ticket's work history
//     (OP subject/description + task_memory + sessions + latest chat). DRAFT ONLY —
//     never posts to OP; the UI puts it in the comment box for the user to review.
// OP content rule: the summary MUST be English.

interface ChatMsg { role: string; content: string }

interface Body {
  opTaskId?: number
  messages?: ChatMsg[]
  mode?: 'preview' | 'post' | 'task-note'
  summary?: string
  statusFrom?: string
  statusTo?: string
}

async function generateSummary(opTaskId: number, messages: ChatMsg[]): Promise<string> {
  // Same fallback as /api/sprint/stakeholder-summary — local Claude CLI when no LLM configured.
  const llmCfg = getLLMConfig() ?? { provider: 'claude-cli' as const, apiKey: '' }

  const transcript = messages
    .slice(-30) // last ~30 messages
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${String(m.content ?? '').slice(0, 1200)}`)
    .join('\n\n')

  const prompt = `You are writing a work activity update for an OpenProject ticket, read by the team. Summarize the work discussed in this chat session in ENGLISH: what was done, decisions made, current status, next steps if any. 4-8 concise bullet lines, markdown, factual, no fluff, no greetings.

CHAT SESSION (about OP ticket #${opTaskId}):
${transcript}

Reply ONLY with the summary bullet lines in English — no preamble, no closing remarks.`

  return (await callLLM(prompt, llmCfg))?.trim() ?? ''
}

// ── mode 'task-note' ────────────────────────────────────────────────────────────
// Gather grounded work history for one OP ticket. Every source is best-effort:
// any failure just drops that section instead of failing the draft.
async function gatherTaskContext(
  opTaskId: number,
  opBase: string,
  opToken: string,
  uid: number | null,
): Promise<string[]> {
  const sections: string[] = []

  // 1) Task subject + description from OP
  try {
    if (opBase && opToken) {
      const res = await fetch(`${opBase}/api/v3/work_packages/${opTaskId}`, {
        headers: { Authorization: 'Basic ' + Buffer.from(`apikey:${opToken}`).toString('base64') },
      })
      if (res.ok) {
        const wp = await res.json() as { subject?: string; description?: { raw?: string } }
        const subject = String(wp.subject ?? '').trim()
        const descr   = String(wp.description?.raw ?? '').trim().slice(0, 1500)
        if (subject || descr) {
          sections.push(`TICKET #${opTaskId}: ${subject}${descr ? `\nDescription: ${descr}` : ''}`)
        }
      }
    }
  } catch { /* skip */ }

  // 2) task_memory rows (per-task work history from hooks), latest 5
  try {
    const rows = await db.select().from(taskMemory)
      .where(eq(taskMemory.opTaskId, opTaskId))
      .orderBy(desc(taskMemory.loggedAt))
      .limit(5)
    if (rows.length) {
      const lines = rows.map(r =>
        `- [${r.date}] ${r.title}${(r.bullets ?? []).length ? '\n' + (r.bullets ?? []).map(b => `  • ${b}`).join('\n') : ''}`)
      sections.push(`WORK HISTORY (task memory):\n${lines.join('\n')}`)
    }
  } catch { /* skip */ }

  // 3) ISL sessions bound to this ticket, latest 5 (scoped to the caller)
  try {
    const all = await getAllSessions(uid)
    const mine = all.filter(s => s.opTaskId === opTaskId).slice(0, 5)
    if (mine.length) {
      const lines = mine.map(s =>
        `- [${s.date}] ${s.title}${(s.bullets ?? []).length ? '\n' + s.bullets.map(b => `  • ${b}`).join('\n') : ''}`)
      sections.push(`WORK SESSIONS:\n${lines.join('\n')}`)
    }
  } catch { /* skip */ }

  // 4) Latest task chat for this ticket, last 10 messages (caller's own chat)
  try {
    if (uid == null) throw new Error('no uid')
    const chat = await getTaskChatByOpTask(opTaskId, uid)
    if (chat && chat.messages.length) {
      const lines = chat.messages.slice(-10).map(m =>
        `${m.role === 'user' ? 'User' : 'Assistant'}: ${String(m.content ?? '').slice(0, 500)}`)
      sections.push(`LATEST CHAT ("${chat.title}"):\n${lines.join('\n')}`)
    }
  } catch { /* skip */ }

  return sections
}

async function generateTaskNote(
  opTaskId: number,
  sections: string[],
  statusTo?: string,
): Promise<string> {
  const llmCfg = getLLMConfig() ?? { provider: 'claude-cli' as const, apiKey: '', model: 'claude' }

  const statusLine = statusTo
    ? `\nThe status is being changed to '${statusTo}' — reflect that in the note (use completed/closed wording when appropriate).`
    : ''

  const emptyInstruction = statusTo
    ? `There is no recorded work history for this ticket. Output a single honest line, e.g. "Status updated to ${statusTo}." — do NOT invent any details.`
    : 'There is no recorded work history for this ticket. Output a single honest line like "Status updated." — do NOT invent any details.'

  const prompt = sections.length
    ? `Write a concise ENGLISH progress note for an OpenProject ticket activity log, read by the team. Based ONLY on the work history below — factual, no fluff, no greetings, no invented details. 2-5 bullet lines: what was done/verified and the outcome.${statusLine}

WORK HISTORY (OP ticket #${opTaskId}):
${sections.join('\n\n')}

Reply ONLY with the note in English — no preamble, no closing remarks.`
    : `Write a progress note for an OpenProject ticket activity log in ENGLISH. ${emptyInstruction}

Reply ONLY with the note — no preamble, no closing remarks.`

  return (await callLLM(prompt, llmCfg))?.trim() ?? ''
}

export async function POST(req: Request) {
  const ctx = await getRequestContext()
  if (process.env.ISL_MULTIUSER === '1' && !ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Body
  try { body = await req.json() as Body } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const opTaskId = Number(body.opTaskId)
  if (!opTaskId || !Number.isFinite(opTaskId)) {
    return NextResponse.json({ error: 'opTaskId required' }, { status: 400 })
  }
  const mode = body.mode === 'post' ? 'post' : body.mode === 'task-note' ? 'task-note' : 'preview'

  try {
    // mode 'task-note' — draft a progress note from grounded work history.
    // DRAFT ONLY: never posts to OP.
    if (mode === 'task-note') {
      const OP_TOKEN = ctx?.opToken || process.env.OP_API_TOKEN || ''
      const OP_BASE  = ctx?.opBaseUrl || process.env.OP_BASE_URL || ''
      const sections = await gatherTaskContext(opTaskId, OP_BASE, OP_TOKEN, ctx?.uid ?? null)
      const summary  = await generateTaskNote(opTaskId, sections, (body.statusTo ?? '').trim() || undefined)
      if (!summary) return NextResponse.json({ error: 'AI returned no note' }, { status: 502 })
      return NextResponse.json({ ok: true, summary })
    }

    // Resolve the summary: user-approved text for 'post', otherwise generate via LLM.
    let summary = (body.summary ?? '').trim()
    if (!summary) {
      const messages = (body.messages ?? []).filter(m => m && typeof m.content === 'string' && m.content.trim())
      if (!messages.length) {
        return NextResponse.json({ error: 'messages required to generate a summary' }, { status: 400 })
      }
      summary = await generateSummary(opTaskId, messages)
      if (!summary) return NextResponse.json({ error: 'AI returned no summary' }, { status: 502 })
    }

    if (mode === 'preview') {
      return NextResponse.json({ ok: true, summary })
    }

    // mode 'post' — comment on the OP work package activity log.
    // Same mechanism as /api/op/comment and /api/op/push-session:
    // POST {base}/api/v3/work_packages/{id}/activities with Basic apikey:token.
    const OP_TOKEN = ctx?.opToken || process.env.OP_API_TOKEN || ''
    const OP_BASE  = ctx?.opBaseUrl || process.env.OP_BASE_URL || ''
    if (!OP_BASE || !OP_TOKEN) {
      return NextResponse.json({ error: 'OP not configured' }, { status: 500 })
    }

    const res = await fetch(`${OP_BASE}/api/v3/work_packages/${opTaskId}/activities`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`apikey:${OP_TOKEN}`).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        comment: { format: 'markdown', raw: `**ISL Chat Summary**\n\n${summary}` },
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return NextResponse.json({ error: `OP comment failed (${res.status}): ${detail.slice(0, 300)}` }, { status: res.status })
    }

    return NextResponse.json({ ok: true, posted: true, opTaskId })
  } catch (e) {
    console.error('[activity-summary] error:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
