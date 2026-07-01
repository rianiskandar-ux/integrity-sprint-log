import { NextRequest } from 'next/server'
import { getLLMConfig } from '@/lib/llm'
import { loadCache, type CachedWorkPackage, type CachedSprint } from '@/lib/op-cache'
import { loadUserConfig } from '@/lib/user-config'
import { getRequestContext } from '@/lib/request-auth'
import { db } from '@/lib/db'
import { sessions, kbEntries, taskMemory } from '@/lib/db/schema'
import { sql, and, eq } from 'drizzle-orm'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    messages: { role: string; content: string }[]
    provider?: string   // optional per-chat override (claude-cli | tokenrouter | openmodel | …)
    model?: string      // optional per-chat model override
    taskContext?: {
      id?: string; title?: string; opTaskId?: number | null
      opStoryId?: number | null; sprintName?: string | null
      status?: string; bullets?: string[]; opContext?: string
    }
  }
  const { messages, taskContext } = body
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: 'No messages provided' }), { status: 400 })
  }

  // Resolve the effective provider/key/model. A per-chat override (body.provider)
  // wins over the global Settings config so the model picker inside each chat works.
  let provider: string, apiKey: string, model: string
  if (body.provider) {
    provider = body.provider
    if      (provider === 'claude-cli')  apiKey = ''
    else if (provider === 'tokenrouter') apiKey = process.env.AI_CHAT_TR_KEY || ''
    else if (provider === 'openmodel')   apiKey = process.env.AI_CHAT_OM_KEY || ''
    else                                 apiKey = getLLMConfig()?.apiKey || ''
    model = body.model || getDefaultModel(provider)
  } else {
    const cfg = getLLMConfig()
    if (!cfg) {
      return new Response(JSON.stringify({ error: 'AI not configured. Go to Settings and add an API key.' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      })
    }
    provider = cfg.provider
    apiKey   = cfg.apiKey
    model    = cfg.model || getDefaultModel(cfg.provider)
  }

  // Build ISL context for system prompt
  const ctx     = await getRequestContext()
  const userCfg = loadUserConfig()
  const cache   = loadCache(ctx?.uid)
  const sprint  = (cache.sprints ?? []).find((s: { isCurrent: boolean }) => s.isCurrent)
  const today   = new Date().toISOString().split('T')[0]
  const userId  = userCfg.displayName

  // My open tasks
  const allWP: CachedWorkPackage[] = [
    ...(cache.myOpenTasks ?? []),
    ...(cache.incomingTasks ?? []),
  ]
  const myTasks = allWP
    .filter(wp => !wp.isClosed)
    .slice(0, 30)
    .map(wp => `- [#${wp.id}] ${wp.subject} (${wp.status}${wp.sprintName ? `, ${wp.sprintName}` : ''})`)
    .join('\n')

  // Pending push queue
  const { getAllSessions } = await import('@/lib/session-store')
  const pendingSessions = (await getAllSessions(ctx?.uid))
    .filter(s => s.pushStatus === 'pending')
    .slice(0, 10)
    .map(s => `- ${s.title} (${s.date})`)
    .join('\n')

  const sprintData = sprint as CachedSprint | undefined

  // Full-text search: inject relevant history from the last user message
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content ?? ''
  const historySection = await searchRelevantHistory(lastUserMsg, ctx?.uid ?? null)

  const taskSection = taskContext?.title ? [
    `\n--- TASK CONTEXT ---`,
    `You are helping with a specific task:`,
    `Title: ${taskContext.title}`,
    taskContext.opTaskId ? `OP Task ID: #${taskContext.opTaskId}` : '',
    taskContext.sprintName ? `Sprint: ${taskContext.sprintName}` : '',
    taskContext.status ? `Status: ${taskContext.status}` : '',
    taskContext.bullets?.length ? `Progress notes:\n${taskContext.bullets.map(b => `• ${b}`).join('\n')}` : '',
    taskContext.opContext ? `\n${taskContext.opContext}` : '',
    `Focus your responses on this task unless the user asks about something else.`,
    `--- END TASK CONTEXT ---`,
  ].filter(Boolean).join('\n') : ''

  const systemPrompt = [
    `You are ISL Assistant, an AI helper built into Integrity Sprint Log (ISL) — a sprint tracking app for the Integrity Asia team.`,
    `Today: ${today}`,
    userCfg.displayName ? `User: ${userCfg.displayName}` : '',
    sprintData ? `Active sprint: ${sprintData.name} (${sprintData.startDate} → ${sprintData.endDate})` : 'No active sprint.',
    myTasks ? `\nOpen tasks in OP:\n${myTasks}` : 'No tasks cached — user may need to sync OP cache from Settings.',
    pendingSessions ? `\nSessions waiting to push to OP:\n${pendingSessions}` : '',
    historySection,
    taskSection,
    `\nYou have full context of the user's sprint and tasks above. Answer questions directly using this data.`,
    `Be concise and practical. Use markdown for lists. Respond in the same language the user writes in.`,
    taskContext?.opTaskId
      ? `\nIMPORTANT: You CANNOT call the OpenProject API yourself. When the user wants to push/log this work to OP, do NOT tell them to do it manually in OpenProject — instead tell them to click the "Push #${taskContext.opTaskId}" button at the top of this chat, which logs the worklog to OP ticket #${taskContext.opTaskId} in one click. You may help draft the progress note first.`
      : `\nIMPORTANT: You CANNOT call the OpenProject API yourself. To push work to OP, the user uses the Push Queue (to pick or create a ticket). Help draft the note; don't claim you can push automatically.`,
  ].filter(Boolean).join('\n')

  try {
    const stream = await callStream(provider, apiKey, model, systemPrompt, messages)
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
      },
    })
  } catch (e) {
    const raw = String(e)
    let msg = raw
    if (raw.includes('credit balance is too low'))
      msg = 'API credit habis. Top up di console.anthropic.com → Plans & Billing.'
    else if (raw.includes('invalid_api_key') || raw.includes('authentication_error'))
      msg = 'API key tidak valid. Cek Settings → LLM API Key.'
    else if (raw.includes('rate_limit'))
      msg = 'Rate limit tercapai. Coba lagi dalam beberapa detik.'
    return new Response(JSON.stringify({ error: msg }), { status: 500 })
  }
}

async function searchRelevantHistory(query: string, uid: number | null): Promise<string> {
  const q = query.trim()
  // skip short/generic queries that won't yield useful FTS hits
  if (q.length < 5) return ''
  try {
    const tsq = sql`plainto_tsquery('simple', ${q})`
    const limit = 4

    const sessionRows = await db.select({
      title:   sessions.title,
      bullets: sessions.bullets,
      date:    sessions.date,
      rank:    sql<number>`ts_rank(to_tsvector('simple', ${sessions.title} || ' ' || COALESCE(${sessions.bullets}::text, '')), ${tsq})`,
    }).from(sessions)
      .where(and(
        uid ? eq(sessions.userId, uid) : sql`true`,
        sql`to_tsvector('simple', ${sessions.title} || ' ' || COALESCE(${sessions.bullets}::text, '')) @@ ${tsq}`,
      ))
      .orderBy(sql`ts_rank(to_tsvector('simple', ${sessions.title} || ' ' || COALESCE(${sessions.bullets}::text, '')), ${tsq}) DESC`)
      .limit(limit)

    const kbRows = await db.select({
      title:   kbEntries.title,
      summary: kbEntries.summary,
      date:    kbEntries.date,
      rank:    sql<number>`ts_rank(to_tsvector('simple', ${kbEntries.title} || ' ' || ${kbEntries.summary}), ${tsq})`,
    }).from(kbEntries)
      .where(and(
        uid ? eq(kbEntries.userId, uid) : sql`true`,
        sql`to_tsvector('simple', ${kbEntries.title} || ' ' || ${kbEntries.summary}) @@ ${tsq}`,
      ))
      .orderBy(sql`ts_rank(to_tsvector('simple', ${kbEntries.title} || ' ' || ${kbEntries.summary}), ${tsq}) DESC`)
      .limit(limit)

    const tmRows = await db.select({
      title:    taskMemory.title,
      bullets:  taskMemory.bullets,
      date:     taskMemory.date,
      opTaskId: taskMemory.opTaskId,
      rank:     sql<number>`ts_rank(to_tsvector('simple', ${taskMemory.title} || ' ' || COALESCE(${taskMemory.bullets}::text, '')), ${tsq})`,
    }).from(taskMemory)
      .where(and(
        uid ? eq(taskMemory.userId, uid) : sql`true`,
        sql`to_tsvector('simple', ${taskMemory.title} || ' ' || COALESCE(${taskMemory.bullets}::text, '')) @@ ${tsq}`,
      ))
      .orderBy(sql`ts_rank(to_tsvector('simple', ${taskMemory.title} || ' ' || COALESCE(${taskMemory.bullets}::text, '')), ${tsq}) DESC`)
      .limit(limit)

    type Hit = { title: string; snippet: string; date: string; rank: number }
    const hits: Hit[] = [
      ...sessionRows.map(r => ({
        title: r.title, date: r.date, rank: r.rank,
        snippet: (r.bullets as string[] ?? []).slice(0, 2).join(' · '),
      })),
      ...kbRows.map(r => ({ title: r.title, date: r.date, rank: r.rank, snippet: r.summary.slice(0, 100) })),
      ...tmRows.map(r => ({
        title: `#${r.opTaskId} ${r.title}`, date: r.date, rank: r.rank,
        snippet: (r.bullets as string[] ?? []).slice(0, 2).join(' · '),
      })),
    ]
    hits.sort((a, b) => b.rank - a.rank)
    const top = hits.slice(0, 5)
    if (top.length === 0) return ''

    const lines = top.map(h => `- [${h.date}] ${h.title}${h.snippet ? ` — ${h.snippet}` : ''}`)
    return `\nRelevant past work (from ISL history):\n${lines.join('\n')}`
  } catch {
    return ''
  }
}

function getDefaultModel(provider: string): string {
  const map: Record<string, string> = {
    'claude-cli': 'claude',
    anthropic:  'claude-haiku-4-5-20251001',
    openai:     'gpt-4o-mini',
    google:     'gemini-2.0-flash-exp',
    groq:       'llama-3.3-70b-versatile',
    openrouter: 'meta-llama/llama-3.1-8b-instruct:free',
    mistral:    'mistral-small-latest',
    together:   'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
    ollama:     'llama3.2',
    '9router':  'claude-sonnet-4-6',
    tokenrouter:'MiniMax-M3',
    openmodel:  'deepseek-v4-flash',
  }
  return map[provider] ?? 'gpt-4o-mini'
}

function resolveBase(provider: string): string {
  const map: Record<string, string> = {
    openai:     'https://api.openai.com/v1',
    groq:       'https://api.groq.com/openai/v1',
    openrouter: 'https://openrouter.ai/api/v1',
    mistral:    'https://api.mistral.ai/v1',
    together:   'https://api.together.xyz/v1',
    ollama:     'http://localhost:11434/v1',
    '9router':  'http://localhost:20128/v1',
    tokenrouter:process.env.AI_CHAT_TR_BASE || 'https://api.tokenrouter.com/v1',
    openmodel:  process.env.AI_CHAT_OM_BASE || 'https://api.openmodel.ai/v1',
  }
  return map[provider] ?? 'https://api.openai.com/v1'
}

async function callStream(
  provider: string, apiKey: string, model: string,
  system: string, messages: { role: string; content: string }[],
): Promise<ReadableStream<Uint8Array>> {
  const encoder = new TextEncoder()

  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model, max_tokens: 4096, stream: true, system,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      }),
    })
    if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${await res.text()}`)
    return streamAnthropicSSE(res.body!, encoder)
  }

  if (provider === 'claude-cli') {
    return callStreamClaudeCLI(system, messages, encoder)
  }

  if (provider === 'google') {
    // Gemini doesn't have great streaming support — fall back to single call
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
    const allMessages = [{ role: 'user', parts: [{ text: system }] }, ...messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))]
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: allMessages, generationConfig: { maxOutputTokens: 4096 } }),
    })
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`)
    const data = await res.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    return new ReadableStream({ start(c) { c.enqueue(encoder.encode(text)); c.close() } })
  }

  // OpenAI-compatible streaming
  const base = resolveBase(provider)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

  const body = {
    model, stream: true, max_tokens: 4096,
    messages: [{ role: 'system', content: system }, ...messages],
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST', headers, body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${model} HTTP ${res.status}: ${await res.text()}`)
  return streamOpenAISSE(res.body!, encoder)
}

async function callStreamClaudeCLI(
  system: string,
  messages: { role: string; content: string }[],
  encoder: TextEncoder,
): Promise<ReadableStream<Uint8Array>> {
  const { spawn } = await import('child_process')
  const isWin = process.platform === 'win32'

  // Build full conversation as a single prompt for claude -p
  const lines: string[] = [`${system}\n\n---`]
  for (const m of messages.slice(0, -1)) {
    lines.push(`\n${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
  }
  const last = messages[messages.length - 1]
  if (last) lines.push(`\nUser: ${last.content}`)
  const prompt = lines.join('')

  return new Promise<ReadableStream<Uint8Array>>((resolve, reject) => {
    const child = spawn(isWin ? 'claude.cmd' : 'claude', ['--print', '--output-format', 'text'], {
      timeout: 120000,
      env: { ...process.env },
      shell: isWin,
    })

    child.stdin.write(prompt, 'utf8')
    child.stdin.end()

    let output = ''
    let errOut = ''
    child.stdout.on('data', (d: Buffer) => { output += d.toString('utf8') })
    child.stderr.on('data', (d: Buffer) => { errOut += d.toString('utf8') })

    child.on('close', (code: number | null) => {
      if (code !== 0) {
        reject(new Error(errOut || `Claude CLI exited with code ${code}`))
        return
      }
      const text = output.trim()
      resolve(new ReadableStream({
        start(ctrl) { ctrl.enqueue(encoder.encode(text)); ctrl.close() }
      }))
    })
    child.on('error', (e: Error) => {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('Claude Code CLI tidak ditemukan. Install: npm install -g @anthropic-ai/claude-code'))
      } else {
        reject(e)
      }
    })
  })
}

function streamOpenAISSE(body: ReadableStream<Uint8Array>, enc: TextEncoder): ReadableStream<Uint8Array> {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ''

  return new ReadableStream({
    async pull(ctrl) {
      while (true) {
        const { done, value } = await reader.read()
        if (done) { ctrl.close(); return }
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const data = trimmed.slice(5).trim()
          if (data === '[DONE]') { ctrl.close(); return }
          try {
            const delta = JSON.parse(data)?.choices?.[0]?.delta?.content
            if (delta) ctrl.enqueue(enc.encode(delta))
          } catch { /* skip malformed */ }
        }
      }
    },
  })
}

function streamAnthropicSSE(body: ReadableStream<Uint8Array>, enc: TextEncoder): ReadableStream<Uint8Array> {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ''

  return new ReadableStream({
    async pull(ctrl) {
      while (true) {
        const { done, value } = await reader.read()
        if (done) { ctrl.close(); return }
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const data = trimmed.slice(5).trim()
          try {
            const parsed = JSON.parse(data)
            if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
              ctrl.enqueue(enc.encode(parsed.delta.text))
            }
            if (parsed.type === 'message_stop') { ctrl.close(); return }
          } catch { /* skip */ }
        }
      }
    },
  })
}
