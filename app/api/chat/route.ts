import { NextRequest } from 'next/server'
import { getLLMConfig } from '@/lib/llm'
import { loadCache, type CachedWorkPackage, type CachedSprint } from '@/lib/op-cache'
import { loadUserConfig } from '@/lib/user-config'
import { getRequestContext, type RequestContext } from '@/lib/request-auth'
import { isOwnerUid } from '@/lib/auth'
import { db, userSettings } from '@/lib/db'
import { sessions, kbEntries, taskMemory } from '@/lib/db/schema'
import { sql, and, eq } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'

export const runtime = 'nodejs'

/** Non-owner's personal LLM config (provider + decrypted key), if they've set one in Settings.
 *  Defense-in-depth: claude-cli is never treated as a "personal" provider here even if somehow
 *  present in stale data — the write path (app/api/settings/personal-llm) already rejects it,
 *  this is a second guard. ollama IS allowed here (their own baseUrl, never the owner's). */
async function getPersonalLLM(ctx: RequestContext | null): Promise<{ provider: string; apiKey: string; model: string | null; baseUrl: string | null } | null> {
  if (!ctx) return null
  const row = (await db.select().from(userSettings).where(eq(userSettings.userId, ctx.uid)).limit(1))[0]
  if (!row?.personalLlmProvider || row.personalLlmProvider === 'claude-cli') return null
  if (row.personalLlmProvider === 'ollama') {
    if (!row.personalLlmBaseUrl) return null
    return { provider: 'ollama', apiKey: '', model: row.personalLlmModel, baseUrl: row.personalLlmBaseUrl }
  }
  const apiKey = row.personalLlmApiKey ? decrypt(row.personalLlmApiKey) : ''
  if (!apiKey) return null
  if (row.personalLlmProvider === 'custom') {
    // OpenAI-compatible endpoint of their choosing — needs both base and key.
    if (!row.personalLlmBaseUrl) return null
    return { provider: 'custom', apiKey, model: row.personalLlmModel, baseUrl: row.personalLlmBaseUrl }
  }
  return { provider: row.personalLlmProvider, apiKey, model: row.personalLlmModel, baseUrl: null }
}

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

  // Build ISL context first — needed to resolve a non-owner's personal provider key.
  const ctx = await getRequestContext()
  // Was missing entirely: an unauthenticated caller (middleware only checks
  // x-kafi-key PRESENCE for this route) got ctx=null, which disabled every
  // uid-scoped filter below (getAllSessions, searchRelevantHistory,
  // hybridSearch all fall back to "no filter" on a null/undefined uid) —
  // leaking every user's pending sessions and search history into the
  // system prompt for anyone who could reach this route unauthenticated.
  if (process.env.ISL_MULTIUSER === '1' && !ctx) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }
  const nonOwner = process.env.ISL_MULTIUSER === '1' && !isOwnerUid(ctx?.uid)
  // Resolve for anyone (owner included) — the owner's own configured provider is now
  // an ADDITIONAL option alongside claude-cli/ollama, not gated to non-owners only.
  const personal = await getPersonalLLM(ctx)
  // Caller selecting THEIR OWN configured provider — always allowed, uses their own key.
  // Also true when a non-owner sent no explicit provider at all (defaulted to personal
  // below) — otherwise the block-check further down would wrongly reject their own
  // ollama/etc. just because it's normally an owner-only provider name.
  const isPersonalCall = !!personal && (body.provider === personal.provider || (!body.provider && nonOwner))

  // Resolve the effective provider/key/model. A per-chat override (body.provider)
  // wins over the global Settings config so the model picker inside each chat works.
  let provider: string, apiKey: string, model: string
  let baseUrlOverride: string | undefined
  if (isPersonalCall && personal) {
    provider = personal.provider
    apiKey   = personal.apiKey
    model    = body.model || personal.model || getDefaultModel(provider)
    baseUrlOverride = personal.baseUrl ?? undefined
  } else if (body.provider) {
    provider = body.provider
    if      (provider === 'claude-cli')  apiKey = ''
    else if (provider === 'tokenrouter') apiKey = process.env.AI_CHAT_TR_KEY || ''
    else if (provider === 'openmodel')   apiKey = process.env.AI_CHAT_OM_KEY || ''
    else                                 apiKey = getLLMConfig()?.apiKey || ''
    model = body.model || getDefaultModel(provider)
  } else if (nonOwner && personal) {
    // No explicit provider chosen (e.g. ChatsView's "Create New" flow never sends one) —
    // getLLMConfig() below is the OWNER's global engine config, which a non-owner can't
    // use anyway. Default to their own personal provider instead of always 403-ing here.
    provider = personal.provider
    apiKey   = personal.apiKey
    model    = personal.model || getDefaultModel(provider)
    baseUrlOverride = personal.baseUrl ?? undefined
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

  // Isolasi multi-user: claude-cli/ollama jalan pakai kredensial OWNER di mesin ini,
  // tokenrouter/openmodel pakai env key server (juga milik owner). Non-owner dilarang
  // memakai kuota/akun owner — enforce di server, bukan cuma disembunyikan di UI.
  // EXCEPT isPersonalCall: that's the teammate's own key, always allowed.
  if (nonOwner && !isPersonalCall) {
    const sharedOk = process.env.ISL_SHARED_PROVIDERS === '1'
    // Allowlist, not blocklist: the old blocklist (['claude-cli','ollama'] +
    // conditionally tokenrouter/openmodel) let a non-owner send
    // body.provider='anthropic' (or openai/google/groq/...) straight through
    // to the L78 `getLLMConfig()?.apiKey` branch — the OWNER's cloud API key
    // — since those provider names were never on the blocklist at all.
    const allowed = sharedOk && ['tokenrouter', 'openmodel'].includes(provider)
    if (!allowed) {
      return new Response(JSON.stringify({ error: `Provider "${provider}" memakai kredensial owner instance. Set provider + API key sendiri di Settings.` }), { status: 403 })
    }
  }
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

  // Super Memory: semantic recall (pgvector + Ollama lokal) — menangkap history
  // yang relevan secara MAKNA walau kata-katanya beda (FTS di atas hanya exact-ish).
  // No-op aman kalau Ollama mati — chat tetap jalan tanpa section ini.
  let semanticSection = ''
  try {
    const { hybridSearch } = await import('@/lib/embeddings')
    const hits = await hybridSearch(lastUserMsg, ctx?.uid ?? null, 5)
    if (hits.length > 0) {
      semanticSection = [
        `\n--- SUPER MEMORY (recall semantik dari seluruh history kerja user) ---`,
        ...hits.map(h => `• [${h.sourceType}] ${h.title}\n  ${h.chunk.split('\n').filter(Boolean).slice(0, 3).join('; ').slice(0, 300)}`),
        `Use these past-work references when they help answer — cite the session title when you do.`,
        `--- END SUPER MEMORY ---`,
      ].join('\n')
    }
  } catch { /* semantic recall best-effort */ }

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
    semanticSection,
    taskSection,
    `\nYou have full context of the user's sprint and tasks above. Answer questions directly using this data.`,
    `Be concise and practical. Use markdown for lists.`,
    taskContext?.opTaskId
      ? `\nIMPORTANT: You CANNOT call the OpenProject API yourself. When the user wants to push/log this work to OP, do NOT tell them to do it manually in OpenProject — instead tell them to click the "Push #${taskContext.opTaskId}" button at the top of this chat, which logs the worklog to OP ticket #${taskContext.opTaskId} in one click. You may help draft the progress note first.`
      : `\nIMPORTANT: You CANNOT call the OpenProject API yourself. To push work to OP, the user uses the Push Queue (to pick or create a ticket). Help draft the note; don't claim you can push automatically.`,
    // Aturan bahasa di POSISI TERAKHIR — paling dipatuhi model, terutama saat effort low.
    `\nATURAN BAHASA (WAJIB): Balas dalam bahasa yang SAMA dengan pesan terakhir user. User menulis Bahasa Indonesia → jawab FULL Bahasa Indonesia (istilah teknis boleh tetap English). User menulis English → jawab English. Jangan pernah ganti bahasa sendiri.`,
  ].filter(Boolean).join('\n')

  try {
    const stream = await callStream(provider, apiKey, model, systemPrompt, messages, baseUrlOverride)
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
  const q = query.trim().slice(0, 120) // cap query length — long messages make noisy FTS queries
  // skip greetings, acks, and queries too short to be meaningful
  if (q.length < 15) return ''
  const isGeneric = /^(ok|oke|ya|iya|yep|yup|halo|hi|thanks|makasih|lanjut|next|done|oke|siap|noted)\b/i.test(q)
  if (isGeneric) return ''
  try {
    const tsq = sql`plainto_tsquery('simple', ${q})`
    const limit = 4
    // Fix: use !== null instead of falsy check — uid=0 would skip filter incorrectly with `uid ?`
    const uidFilter = uid !== null

    const sessionRows = await db.select({
      title:   sessions.title,
      bullets: sessions.bullets,
      date:    sessions.date,
      rank:    sql<number>`ts_rank(to_tsvector('simple', ${sessions.title} || ' ' || COALESCE(${sessions.bullets}::text, '')), ${tsq})`,
    }).from(sessions)
      .where(and(
        uidFilter ? eq(sessions.userId, uid!) : sql`true`,
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
        uidFilter ? eq(kbEntries.userId, uid!) : sql`true`,
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
        uidFilter ? eq(taskMemory.userId, uid!) : sql`true`,
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
    ollama:     process.env.OLLAMA_CHAT_MODEL || 'qwen2.5:3b',
    '9router':  'claude-sonnet-4-6',
    tokenrouter:'MiniMax-M3',
    openmodel:  'deepseek-v4-flash',
    custom:     '',  // model is required in personal settings for custom
  }
  return map[provider] ?? 'gpt-4o-mini'
}

function resolveBase(provider: string, override?: string): string {
  // override = a teammate's OWN personal-provider baseUrl (currently only used
  // for 'ollama' — see app/api/settings/personal-llm/route.ts, which already
  // normalizes it to end in /v1 before it's ever stored).
  if (override) return override
  const map: Record<string, string> = {
    openai:     'https://api.openai.com/v1',
    groq:       'https://api.groq.com/openai/v1',
    openrouter: 'https://openrouter.ai/api/v1',
    mistral:    'https://api.mistral.ai/v1',
    together:   'https://api.together.xyz/v1',
    // Dari container, Ollama host = host.docker.internal (env OLLAMA_URL di compose)
    ollama:     `${process.env.OLLAMA_URL || 'http://localhost:11434'}/v1`,
    '9router':  'http://localhost:20128/v1',
    tokenrouter:process.env.AI_CHAT_TR_BASE || 'https://api.tokenrouter.com/v1',
    openmodel:  process.env.AI_CHAT_OM_BASE || 'https://api.openmodel.ai/v1',
  }
  return map[provider] ?? 'https://api.openai.com/v1'
}

async function callStream(
  provider: string, apiKey: string, model: string,
  system: string, messages: { role: string; content: string }[],
  baseUrlOverride?: string,
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
  const base = resolveBase(provider, baseUrlOverride)
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
