import { NextRequest, NextResponse } from 'next/server'
import { callLLM } from '@/lib/llm'

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
  const models: Record<string, string[]> = {
    // claude-cli runs the local Claude Code subscription — always available, no key/quota
    'claude-cli': ['claude'],
    tokenrouter:  [],
    openmodel:    ['deepseek-v4-flash'],
  }

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

  const { provider, model, messages, system } = body
  if (!provider || !Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'provider, messages required' }, { status: 400 })
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
