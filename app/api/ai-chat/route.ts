import { NextRequest, NextResponse } from 'next/server'
import { callLLM, DEFAULT_MODELS, type LLMProvider } from '@/lib/llm'
import { getRequestContext, type RequestContext } from '@/lib/request-auth'
import { isOwnerUid } from '@/lib/auth'
import { db, userSettings } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'

// Isolasi multi-user: provider di file ini semua memakai kredensial owner
// (claude-cli = subscription owner, tokenrouter/openmodel = env key owner) —
// KECUALI provider pribadi yang teammate set sendiri di Settings (personalLlmProvider),
// yang selalu memakai API key milik teammate itu sendiri, terlepas dari flag di atas.
async function callerCtx(): Promise<{ ctx: RequestContext | null; owner: boolean }> {
  if (process.env.ISL_MULTIUSER !== '1') return { ctx: null, owner: true }
  const ctx = await getRequestContext()
  return { ctx, owner: isOwnerUid(ctx?.uid) }
}
const sharedProvidersEnabled = () => process.env.ISL_SHARED_PROVIDERS === '1'

/** Non-owner's personal LLM config (provider + decrypted key), if they've set one in Settings.
 *  Defense-in-depth: claude-cli/ollama are never treated as a "personal" provider here even
 *  if somehow present in stale data — the write path (app/api/settings/personal-llm) already
 *  rejects them, this is a second guard. */
async function getPersonalLLM(ctx: RequestContext | null): Promise<{ provider: string; apiKey: string; model: string | null } | null> {
  if (!ctx) return null
  const row = (await db.select().from(userSettings).where(eq(userSettings.userId, ctx.uid)).limit(1))[0]
  if (!row?.personalLlmProvider || ['claude-cli', 'ollama'].includes(row.personalLlmProvider)) return null
  const apiKey = row.personalLlmApiKey ? decrypt(row.personalLlmApiKey) : ''
  if (!apiKey) return null
  return { provider: row.personalLlmProvider, apiKey, model: row.personalLlmModel }
}

export const runtime = 'nodejs'
export const maxDuration = 300  // 5 min — dokumen panjang via Claude CLI

const PROVIDERS = {
  tokenrouter: {
    base: () => process.env.AI_CHAT_TR_BASE || 'https://api.tokenrouter.com/v1',
    key:  () => process.env.AI_CHAT_TR_KEY  || '',
  },
  openmodel: {
    base: () => process.env.AI_CHAT_OM_BASE || 'https://api.openmodel.ai/v1',
    key:  () => process.env.AI_CHAT_OM_KEY  || '',
  },
} as const

type ProviderId = keyof typeof PROVIDERS

export async function GET() {
  const { ctx, owner } = await callerCtx()
  const shared = owner || sharedProvidersEnabled()

  const models: Record<string, string[]> = {}
  // claude-cli = subscription owner di mesin ini — HANYA owner yang boleh lihat/pakai
  if (owner)  models['claude-cli'] = ['claude']
  // ollama = LLM lokal di mesin owner (gratis, offline) — chat models saja (exclude embed)
  if (owner) {
    try {
      const base = process.env.OLLAMA_URL || 'http://localhost:11434'
      const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) })
      if (r.ok) {
        const d = await r.json() as { models?: { name: string }[] }
        const chatModels = (d.models ?? []).map(m => m.name).filter(n => !n.includes('embed'))
        if (chatModels.length > 0) models.ollama = chatModels
      }
    } catch { /* Ollama mati → grup tidak muncul */ }
  }
  if (shared) { models.tokenrouter = []; models.openmodel = ['deepseek-v4-flash'] }

  // Personal provider: a non-owner teammate's own configured provider (set via
  // Settings → 🔑 Model AI Pribadi). Shown ONLY in their own picker, never to others.
  if (!owner) {
    const personal = await getPersonalLLM(ctx)
    if (personal) {
      const model = personal.model || DEFAULT_MODELS[personal.provider as LLMProvider] || personal.provider
      models[personal.provider] = [model]
    }
  }

  if (!shared) return NextResponse.json({ models })

  // List only the TokenRouter models this token can actually access
  try {
    const base = PROVIDERS.tokenrouter.base()
    const key  = PROVIDERS.tokenrouter.key()
    if (key) {
      const res = await fetch(`${base}/models`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) {
        const data = await res.json() as { data?: { id: string }[] }
        models.tokenrouter = (data.data ?? []).map(m => m.id).sort()
      }
    }
  } catch { /* leave empty — provider may be unreachable */ }

  return NextResponse.json({ models })
}

/** Translate raw upstream provider errors into a clear, actionable message. */
function friendlyError(model: string, status: number, raw: string): string {
  const low = raw.toLowerCase()
  if (/credit|quota|recharge|insufficient|balance/.test(low)) {
    return `Kuota/credit provider untuk model "${model}" habis ($0). Ganti provider ke "Claude CLI" (gratis, pakai subscription) di dropdown atas, atau top up key-nya.`
  }
  if (low.includes('no access to model')) {
    return `Token provider tidak punya akses ke model "${model}". Pilih model lain dari dropdown.`
  }
  if (status === 404) return `Endpoint provider tidak ditemukan (404). Base URL provider kemungkinan salah — pakai "Claude CLI" sementara.`
  return `${model} error ${status}: ${raw.slice(0, 200)}`
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    provider: string
    model:    string
    messages: { role: string; content: string }[]
    system?:  string
  }

  // Enforce isolasi di server (bukan cuma UI): non-owner tidak boleh membakar
  // kuota/kredensial owner. claude-cli selalu owner-only; shared providers opt-in.
  // EXCEPT: a non-owner using their OWN configured personal provider is always
  // allowed — that call uses their own key, not the owner's credentials.
  const { ctx, owner } = await callerCtx()
  const personal = owner ? null : await getPersonalLLM(ctx)
  const isPersonalCall = !!personal && personal.provider === body.provider
  if (!owner && !isPersonalCall) {
    const blocked = ['claude-cli', 'ollama'].includes(body.provider)
      || (!sharedProvidersEnabled() && ['tokenrouter', 'openmodel'].includes(body.provider))
    if (blocked) {
      return NextResponse.json({ error: `Provider "${body.provider}" memakai kredensial owner instance. Set provider + API key sendiri di Settings.` }, { status: 403 })
    }
  }

  const { provider, model, messages, system } = body
  if (!provider || !Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'provider, messages required' }, { status: 400 })
  }

  // ── Personal provider: teammate's own key (openai/google/groq/etc), always allowed ──
  if (isPersonalCall && personal) {
    try {
      const prompt = [
        system ? `${system}\n\n---` : '',
        ...messages.map(m => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`),
      ].filter(Boolean).join('\n\n')
      const effModel = model || personal.model || DEFAULT_MODELS[personal.provider as LLMProvider]
      const text = await callLLM(prompt, { provider: personal.provider as LLMProvider, apiKey: personal.apiKey, model: effModel })
      const enc = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        start(c) { c.enqueue(enc.encode(text)); c.close() },
      })
      return new Response(stream, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
      })
    } catch (e) {
      return NextResponse.json({ error: `${personal.provider} error: ${String(e).slice(0, 300)}` }, { status: 500 })
    }
  }

  // ── Claude CLI: local subscription, no API key / no cloud quota ──────────────
  if (provider === 'claude-cli') {
    try {
      const prompt = [
        system ? `${system}\n\n---` : '',
        ...messages.map(m => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`),
      ].filter(Boolean).join('\n\n')
      const text = await callLLM(prompt, { provider: 'claude-cli', apiKey: '' })
      const enc = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        start(c) { c.enqueue(enc.encode(text)); c.close() },
      })
      return new Response(stream, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
      })
    } catch (e) {
      return NextResponse.json({ error: `Claude CLI error: ${String(e).slice(0, 300)}` }, { status: 500 })
    }
  }

  // ── Cloud providers (TokenRouter / OpenModel) ────────────────────────────────
  if (!model) return NextResponse.json({ error: 'model required' }, { status: 400 })
  const p = PROVIDERS[provider as ProviderId]
  if (!p) return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 })

  const key  = p.key()
  const base = p.base()
  if (!key) return NextResponse.json({ error: `Key untuk ${provider} belum diset di .env` }, { status: 400 })

  const allMessages = system ? [{ role: 'system', content: system }, ...messages] : messages

  let upstream: Response
  try {
    upstream = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ model, stream: true, max_tokens: 4096, messages: allMessages }),
    })
  } catch (e) {
    return NextResponse.json({ error: `Tidak bisa konek ke ${provider}: ${String(e).slice(0, 150)}. Coba provider "Claude CLI".` }, { status: 502 })
  }

  if (!upstream.ok) {
    const errText = await upstream.text()
    return NextResponse.json({ error: friendlyError(model, upstream.status, errText) }, { status: upstream.status })
  }

  const encoder = new TextEncoder()
  const reader  = upstream.body!.getReader()
  const dec     = new TextDecoder()
  let buf = ''

  const stream = new ReadableStream<Uint8Array>({
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
            if (delta) ctrl.enqueue(encoder.encode(delta))
          } catch { /* skip malformed */ }
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':      'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control':     'no-cache',
    },
  })
}
