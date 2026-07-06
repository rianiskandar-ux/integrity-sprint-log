import { NextResponse } from 'next/server'
import { callLLM, getLLMConfig } from '@/lib/llm'
import { getRequestContext } from '@/lib/request-auth'

export const runtime = 'nodejs'
export const maxDuration = 300

// POST /api/op/activity-summary — "Activity Log Sync":
//   mode 'preview' (default): generate an ENGLISH summary of a task-bound chat via LLM.
//   mode 'post': post the (user-approved) summary as an activity comment on the OP ticket.
// OP content rule: the summary MUST be English.

interface ChatMsg { role: string; content: string }

interface Body {
  opTaskId?: number
  messages?: ChatMsg[]
  mode?: 'preview' | 'post'
  summary?: string
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
  const mode = body.mode === 'post' ? 'post' : 'preview'

  try {
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
