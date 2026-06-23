import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

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
  const models: Record<ProviderId, string[]> = {
    tokenrouter: [],
    openmodel:   ['deepseek-v4-flash'],
  }

  // Try to fetch model list from TokenRouter
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
  } catch { /* silently fall back to empty */ }

  if (!models.tokenrouter.length) {
    // Sensible default list when API unreachable
    models.tokenrouter = [
      'gpt-4o-mini',
      'gpt-4o',
      'claude-haiku-4-5-20251001',
      'claude-sonnet-4-6',
      'llama-3.3-70b-versatile',
      'gemini-2.0-flash',
      'deepseek-r1',
    ]
  }

  return NextResponse.json({ models })
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    provider: string
    model:    string
    messages: { role: string; content: string }[]
    system?:  string
  }

  const { provider, model, messages, system } = body
  if (!provider || !model || !Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'provider, model, messages required' }, { status: 400 })
  }

  const p = PROVIDERS[provider as ProviderId]
  if (!p) {
    return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 })
  }

  const key  = p.key()
  const base = p.base()
  if (!key) {
    return NextResponse.json({ error: `API key for ${provider} tidak diset. Tambahkan AI_CHAT_${provider.toUpperCase().replace('TOKENROUTER','TR').replace('OPENMODEL','OM')}_KEY di .env` }, { status: 400 })
  }

  const allMessages = system
    ? [{ role: 'system', content: system }, ...messages]
    : messages

  const upstream = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({ model, stream: true, max_tokens: 4096, messages: allMessages }),
  })

  if (!upstream.ok) {
    const errText = await upstream.text()
    return NextResponse.json({ error: `${model} HTTP ${upstream.status}: ${errText}` }, { status: upstream.status })
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
