import { NextRequest, NextResponse } from 'next/server'
import { getAllSessions } from '@/lib/session-store'
import { loadCache } from '@/lib/op-cache'
import { loadUserConfig } from '@/lib/user-config'
import { getLLMConfig } from '@/lib/llm'

export const runtime = 'nodejs'

function fmtMins(m: number) {
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60), min = m % 60
  return min > 0 ? `${h}h ${min}m` : `${h}h`
}

// GET /api/sprint/report — returns structured report data
export async function GET() {
  try {
    const sessions = getAllSessions()
    const cache    = loadCache()
    const userCfg  = loadUserConfig()

    const currentSprint = (cache.sprints ?? []).find((s: { isCurrent: boolean }) => s.isCurrent) ?? null
    const myOpen   = (cache.myOpenTasks   ?? []) as unknown as { id: number; subject: string; versionId?: number | null; status?: string; project?: { name: string } | string }[]
    const myClosed = (cache.myClosedTasks ?? []) as unknown as { id: number; subject: string; versionId?: number | null; status?: string; project?: { name: string } | string }[]

    // Sprint stats
    const sprintDone  = currentSprint ? myClosed.filter(t => t.versionId === currentSprint.id) : []
    const sprintOpen  = currentSprint ? myOpen.filter(t => t.versionId === currentSprint.id)   : []
    const backlog     = myOpen.filter(t => !t.versionId)

    // Sessions in current sprint date range
    const sprintSessions = currentSprint
      ? sessions.filter(s =>
          s.date >= currentSprint.startDate &&
          s.date <= currentSprint.endDate &&
          (s.pushStatus === 'pushed' || s.pushStatus === 'pending')
        )
      : sessions.filter(s => s.pushStatus === 'pushed' || s.pushStatus === 'pending')

    const pushedSessions  = sprintSessions.filter(s => s.pushStatus === 'pushed')
    const pendingSessions = sessions.filter(s => s.pushStatus === 'pending')

    // Total time per task
    const timeByTask: Record<number, { subject: string; mins: number }> = {}
    for (const s of pushedSessions) {
      if (s.opTaskId) {
        if (!timeByTask[s.opTaskId]) {
          const task = [...myClosed, ...myOpen].find(t => t.id === s.opTaskId)
          timeByTask[s.opTaskId] = { subject: task?.subject ?? s.title, mins: 0 }
        }
        timeByTask[s.opTaskId].mins += s.actualMins ?? s.estimatedMins ?? 0
      }
    }
    const totalMins = pushedSessions.reduce((a, s) => a + (s.actualMins ?? s.estimatedMins ?? 0), 0)

    // Sessions by date (for daily breakdown)
    const byDate: Record<string, { count: number; mins: number }> = {}
    for (const s of pushedSessions) {
      if (!byDate[s.date]) byDate[s.date] = { count: 0, mins: 0 }
      byDate[s.date].count++
      byDate[s.date].mins += s.actualMins ?? s.estimatedMins ?? 0
    }

    // Incoming tasks
    const incomingTasks = (cache.incomingTasks ?? []).filter(
      (t: { islStatus?: string }) => t.islStatus !== 'done' && t.islStatus !== 'rejected'
    )

    return NextResponse.json({
      sprint:   currentSprint,
      user:     userCfg.displayName ?? 'Team Member',
      stats: {
        done:       sprintDone.length,
        open:       sprintOpen.length,
        pct:        sprintDone.length + sprintOpen.length > 0
                      ? Math.round(sprintDone.length / (sprintDone.length + sprintOpen.length) * 100) : 0,
        totalMins,
        sessionCount: pushedSessions.length,
        pendingCount: pendingSessions.length,
      },
      accomplished: sprintDone.map(t => ({ id: t.id, subject: t.subject, project: typeof t.project === 'object' ? (t.project?.name ?? '') : (t.project ?? '') })),
      inProgress:   sprintOpen.map(t => ({ id: t.id, subject: t.subject, project: typeof t.project === 'object' ? (t.project?.name ?? '') : (t.project ?? '') })),
      backlog:      backlog.slice(0, 10).map(t => ({ id: t.id, subject: t.subject })),
      timeByTask:   Object.entries(timeByTask)
                      .sort((a, b) => b[1].mins - a[1].mins)
                      .slice(0, 10)
                      .map(([id, v]) => ({ id: Number(id), subject: v.subject, mins: v.mins, fmt: fmtMins(v.mins) })),
      byDate:       Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, ...v, fmt: fmtMins(v.mins) })),
      incoming:     incomingTasks.length,
      hasAI:        !!getLLMConfig(),
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// POST /api/sprint/report — generate AI narrative from report data
export async function POST(req: NextRequest) {
  const cfg = getLLMConfig()
  if (!cfg) {
    return new Response(JSON.stringify({ error: 'AI not configured' }), { status: 400 })
  }

  const { reportData, format } = await req.json() as {
    reportData: {
      sprint: { name: string; startDate: string; endDate: string } | null
      user: string
      stats: { done: number; open: number; pct: number; totalMins: number; sessionCount: number; pendingCount: number }
      accomplished: { id: number; subject: string; project: string }[]
      inProgress: { id: number; subject: string; project: string }[]
      backlog: { id: number; subject: string }[]
      timeByTask: { id: number; subject: string; mins: number; fmt: string }[]
      incoming: number
    }
    format: 'standup' | 'sprint-review' | 'weekly'
  }

  const systemPrompt = `You are a helpful assistant that generates professional sprint/work reports for a software/consulting team. Write concisely and professionally. Use markdown formatting. Focus on achievements and clarity.`

  function fmtM(m: number) {
    const h = Math.floor(m / 60), min = m % 60
    return min > 0 ? `${h}h ${min}m` : h > 0 ? `${h}h` : `${m}m`
  }

  const context = `
Sprint: ${reportData.sprint?.name ?? 'Current Sprint'} (${reportData.sprint?.startDate ?? ''} → ${reportData.sprint?.endDate ?? ''})
Team member: ${reportData.user}
Progress: ${reportData.stats.done} tasks done out of ${reportData.stats.done + reportData.stats.open} (${reportData.stats.pct}%)
Total logged time: ${fmtM(reportData.stats.totalMins)} across ${reportData.stats.sessionCount} sessions

Accomplished tasks:
${reportData.accomplished.map(t => `- [#${t.id}] ${t.subject}${t.project ? ` (${t.project})` : ''}`).join('\n') || '- None completed yet'}

In progress:
${reportData.inProgress.slice(0, 5).map(t => `- [#${t.id}] ${t.subject}${t.project ? ` (${t.project})` : ''}`).join('\n') || '- None'}

Time breakdown (top tasks):
${reportData.timeByTask.slice(0, 5).map(t => `- ${t.subject}: ${t.fmt}`).join('\n') || '- No time logged'}

${reportData.stats.pendingCount > 0 ? `Note: ${reportData.stats.pendingCount} sessions pending push to OP` : ''}
${reportData.incoming > 0 ? `Incoming tasks from OP: ${reportData.incoming}` : ''}
`

  const prompts: Record<string, string> = {
    standup: `Generate a concise daily standup update (Yesterday / Today / Blockers format) based on this sprint data:\n\n${context}\n\nKeep it short — 3-5 bullet points max per section. Write in first person.`,
    'sprint-review': `Generate a sprint review summary based on this data:\n\n${context}\n\nInclude: Executive Summary (2-3 sentences), What We Accomplished (bullet list), What's Still In Progress, Key Metrics (time logged, completion %), and any observations. Professional tone.`,
    weekly: `Generate a weekly work summary based on this sprint data:\n\n${context}\n\nInclude: Weekly Highlights, Tasks Completed, Ongoing Work, Time Investment summary. Professional tone suitable for manager reporting.`,
  }

  const model    = cfg.model || DEFAULT_MODELS[cfg.provider]
  const messages = [{ role: 'user', content: prompts[format] ?? prompts['sprint-review'] }]

  try {
    const stream = await callStream(cfg.provider, cfg.apiKey, model, systemPrompt, messages)
    return new Response(stream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Transfer-Encoding': 'chunked', 'Cache-Control': 'no-cache' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
}

// ── Streaming helpers (same pattern as /api/chat/route.ts) ──────────────────

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-haiku-4-5-20251001', openai: 'gpt-4o-mini',
  google: 'gemini-2.0-flash-exp', groq: 'llama-3.3-70b-versatile',
  openrouter: 'meta-llama/llama-3.1-8b-instruct:free',
  mistral: 'mistral-small-latest', together: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', ollama: 'llama3.2',
}

function resolveBase(provider: string): string {
  const map: Record<string, string> = {
    openai: 'https://api.openai.com/v1', groq: 'https://api.groq.com/openai/v1',
    openrouter: 'https://openrouter.ai/api/v1', mistral: 'https://api.mistral.ai/v1',
    together: 'https://api.together.xyz/v1', ollama: 'http://localhost:11434/v1',
  }
  return map[provider] ?? 'https://api.openai.com/v1'
}

async function callStream(provider: string, apiKey: string, model: string, system: string, messages: { role: string; content: string }[]): Promise<ReadableStream<Uint8Array>> {
  const enc = new TextEncoder()
  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 4096, stream: true, system, messages }),
    })
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`)
    return streamAnthropicSSE(res.body!, enc)
  }
  if (provider === 'google') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: system + '\n\n' + messages[messages.length - 1].content }] }], generationConfig: { maxOutputTokens: 4096 } }),
    })
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`)
    const data = await res.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    return new ReadableStream({ start(c) { c.enqueue(enc.encode(text)); c.close() } })
  }
  const base = resolveBase(provider)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST', headers,
    body: JSON.stringify({ model, stream: true, max_tokens: 4096, messages: [{ role: 'system', content: system }, ...messages] }),
  })
  if (!res.ok) throw new Error(`${model} ${res.status}: ${await res.text()}`)
  return streamOpenAISSE(res.body!, enc)
}

function streamOpenAISSE(body: ReadableStream<Uint8Array>, enc: TextEncoder): ReadableStream<Uint8Array> {
  const reader = body.getReader(); const dec = new TextDecoder(); let buf = ''
  return new ReadableStream({ async pull(ctrl) {
    while (true) {
      const { done, value } = await reader.read()
      if (done) { ctrl.close(); return }
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n'); buf = lines.pop() ?? ''
      for (const line of lines) {
        const t = line.trim(); if (!t.startsWith('data:')) continue
        const d = t.slice(5).trim(); if (d === '[DONE]') { ctrl.close(); return }
        try { const delta = JSON.parse(d)?.choices?.[0]?.delta?.content; if (delta) ctrl.enqueue(enc.encode(delta)) } catch { /* skip */ }
      }
    }
  }})
}

function streamAnthropicSSE(body: ReadableStream<Uint8Array>, enc: TextEncoder): ReadableStream<Uint8Array> {
  const reader = body.getReader(); const dec = new TextDecoder(); let buf = ''
  return new ReadableStream({ async pull(ctrl) {
    while (true) {
      const { done, value } = await reader.read()
      if (done) { ctrl.close(); return }
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n'); buf = lines.pop() ?? ''
      for (const line of lines) {
        const t = line.trim(); if (!t.startsWith('data:')) continue
        try {
          const p = JSON.parse(t.slice(5).trim())
          if (p.type === 'content_block_delta' && p.delta?.type === 'text_delta') ctrl.enqueue(enc.encode(p.delta.text))
          if (p.type === 'message_stop') { ctrl.close(); return }
        } catch { /* skip */ }
      }
    }
  }})
}
