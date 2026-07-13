import { NextRequest, NextResponse } from 'next/server'
import { callLLM, getLLMConfig } from '@/lib/llm'
import { callLocalLLM } from '@/lib/local-llm'
import { getRequestContext, type RequestContext } from '@/lib/request-auth'
import { isOwnerUid } from '@/lib/auth'
import { db, userSettings } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'

/** Non-owner's personal LLM config, if configured — same shape/logic as the
 *  chat routes' getPersonalLLM(). Duplicated here (small, route-local) rather
 *  than shared, matching the existing pattern in app/api/chat and ai-chat. */
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
    if (!row.personalLlmBaseUrl) return null
    return { provider: 'custom', apiKey, model: row.personalLlmModel, baseUrl: row.personalLlmBaseUrl }
  }
  return { provider: row.personalLlmProvider, apiKey, model: row.personalLlmModel, baseUrl: null }
}

export const runtime = 'nodejs'
export const maxDuration = 300

// ── Ekstrak poin (Chats → Daily Hub) — dedicated route ───────────────────────
// Sebelumnya fitur ini menumpang POST /api/chat (main chat). Dipisah agar bisa
// local-first: Ollama (qwen2.5:3b) dengan constrained decoding sebagai otak
// utama, Claude (getLLMConfig) hanya fallback. Kontrak response = plain text
// baris "TASK | <poin>" / "NOTE | <poin>" — persis format yang sudah di-parse
// ChatsView.extractPoints(), jadi parser frontend tidak berubah.

// Full JSON Schema WAJIB — format:'json' saja tidak cukup, model 3B meratakan skema.
const EXTRACT_FORMAT = {
  type: 'object',
  properties: {
    points: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          kind: { type: 'string', enum: ['task', 'note'] },
        },
        required: ['text', 'kind'],
      },
    },
  },
  required: ['points'],
} as const

function claudePrompt(transcript: string): string {
  return `Berikut transkrip diskusi/brainstorm. Ekstrak poin-poin penting.
Untuk tiap poin, tentukan apakah itu KANDIDAT TASK (rencana kerja nyata yang bisa dikerjakan) atau sekadar CATATAN/brainstorm.
Output HANYA baris-baris dengan format persis: "TASK | <poin>" atau "NOTE | <poin>". Tanpa kalimat lain, tanpa nomor.

Transkrip:
${transcript}`
}

function ollamaPrompt(transcript: string): string {
  return `Berikut transkrip diskusi/brainstorm. Ekstrak poin-poin penting.
Untuk tiap poin, tentukan "kind":
- "task" = KANDIDAT TASK: rencana kerja nyata yang bisa dikerjakan.
- "note" = sekadar catatan/brainstorm.
"text" = poin singkat dalam bahasa yang sama dengan transkrip. Jangan mengarang poin yang tidak ada di transkrip.

Transkrip:
${transcript}`
}

function textResponse(text: string): Response {
  return new Response(text, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { transcript?: string } | null
  const transcript = (body?.transcript ?? '').trim()
  if (!transcript) return NextResponse.json({ error: 'transcript required' }, { status: 400 })

  // Isolasi multi-user: Ollama & claude-cli memakai mesin/kredensial owner.
  const multiuser = process.env.ISL_MULTIUSER === '1'
  let owner = true
  let ctx: RequestContext | null = null
  if (multiuser) {
    ctx = await getRequestContext()
    owner = isOwnerUid(ctx?.uid)
  }

  // ── Local-first: Ollama constrained decoding (owner-only) ──────────────────
  if (owner) {
    const localRaw = await callLocalLLM(ollamaPrompt(transcript), EXTRACT_FORMAT)
    if (localRaw) {
      try {
        const j = JSON.parse(localRaw) as { points?: unknown }
        const points = Array.isArray(j.points)
          ? (j.points as { text?: unknown; kind?: unknown }[]).filter(p =>
              typeof p.text === 'string' && p.text.trim().length > 0 &&
              (p.kind === 'task' || p.kind === 'note'))
          : []
        if (points.length > 0) {
          console.log('[chat-extract] via ollama')
          const lines = points.map(p =>
            `${p.kind === 'task' ? 'TASK' : 'NOTE'} | ${(p.text as string).trim()}`)
          return textResponse(lines.join('\n'))
        }
      } catch { /* invalid JSON → fallback Claude */ }
    }
  }

  // ── Non-owner: use THEIR OWN personal provider, never the owner's global config ──
  if (multiuser && !owner) {
    const personal = await getPersonalLLM(ctx)
    if (!personal) {
      return NextResponse.json({ error: 'AI not configured. Set provider + API key sendiri di Settings.' }, { status: 400 })
    }
    try {
      console.log(`[chat-extract] via personal (${personal.provider})`)
      const text = await callLLM(claudePrompt(transcript), {
        provider: personal.provider as Parameters<typeof callLLM>[1]['provider'],
        apiKey: personal.apiKey, model: personal.model ?? undefined, baseUrl: personal.baseUrl ?? undefined,
      })
      return textResponse(text)
    } catch (e) {
      return NextResponse.json({ error: String(e).slice(0, 300) }, { status: 500 })
    }
  }

  // ── Fallback: existing callLLM(getLLMConfig()) path, unchanged (owner only from here) ──
  const cfg = getLLMConfig()
  if (!cfg) return NextResponse.json({ error: 'AI not configured. Go to Settings and add an API key.' }, { status: 400 })

  try {
    console.log('[chat-extract] via claude')
    const text = await callLLM(claudePrompt(transcript), cfg)
    return textResponse(text)
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 300) }, { status: 500 })
  }
}
