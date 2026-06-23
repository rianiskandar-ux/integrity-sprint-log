import { NextRequest } from 'next/server'
import { getLLMConfig } from '@/lib/llm'
import { loadCache, type CachedWorkPackage, type CachedSprint } from '@/lib/op-cache'
import { loadUserConfig } from '@/lib/user-config'
import { getRequestContext } from '@/lib/request-auth'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const cfg = getLLMConfig()
  if (!cfg) {
    return new Response(JSON.stringify({ error: 'AI not configured. Go to Settings and add an API key.' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const body = await req.json() as {
    messages: { role: string; content: string }[]
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
    taskSection,
    `\nYou have full context of the user's sprint and tasks above. Answer questions directly using this data.`,
    `Be concise and practical. Use markdown for lists. Respond in the same language the user writes in.`,
  ].filter(Boolean).join('\n')

  const model = cfg.model || getDefaultModel(cfg.provider)

  try {
    const stream = await callStream(cfg.provider, cfg.apiKey, model, systemPrompt, messages)
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

function getDefaultModel(provider: string): string {
  const map: Record<string, string> = {
    anthropic:  'claude-haiku-4-5-20251001',
    openai:     'gpt-4o-mini',
    google:     'gemini-2.0-flash-exp',
    groq:       'llama-3.3-70b-versatile',
    openrouter: 'meta-llama/llama-3.1-8b-instruct:free',
    mistral:    'mistral-small-latest',
    together:   'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
    ollama:     'llama3.2',
    '9router':  'claude-sonnet-4-6',
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
