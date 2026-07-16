import { NextRequest, NextResponse } from 'next/server'
import { callLLM, getLLMConfig } from '@/lib/llm'
import { callLocalLLM } from '@/lib/local-llm'
import { estimateTask } from '@/lib/dira-estimate'
import { getRequestContext, type RequestContext } from '@/lib/request-auth'
import { isOwnerUid } from '@/lib/auth'
import { db, userSettings } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'

export const runtime = 'nodejs'
export const maxDuration = 300

// ── Luna, pilot #3 of the agent-taxonomy roadmap (2026-07-15 discussion) ────
// Luna's existing job (counting Daily Hub queue rows) is pure automation.
// This is Luna's first real agentic capability: read a chat transcript, split
// it into distinct topics ONLY when genuinely disjoint (conservative bias —
// false-splitting creates more triage work than it saves, per the roadmap),
// then collaborate with Dira (lib/dira-estimate.ts, same judgment used by
// /api/dira/estimate) for a time estimate per topic. Never pushes to OP —
// the human reviews/edits in ChatsView before any Hub session is created,
// same human-in-the-loop pattern as the existing extractPoints() flow.

const STRUCTURE_FORMAT = {
  type: 'object',
  properties: {
    topics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          bullets: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'bullets'],
      },
    },
  },
  required: ['topics'],
} as const

function buildPrompt(transcript: string): string {
  return `Kamu adalah Luna, asisten yang merangkum sesi chat/brainstorm tim developer/QA jadi topik-topik kerja.

Baca transkrip berikut dan kelompokkan jadi TOPIK. Tiap topik punya judul singkat (seperti judul User Story) dan daftar bullet (task-task konkret di topik itu).

ATURAN PENTING — bias KONSERVATIF:
- Kalau ragu apakah ini 1 topik besar atau beberapa topik kecil, GABUNGKAN jadi lebih sedikit topik yang lebih besar. Memecah berlebihan bikin kerjaan triase lebih banyak, bukan lebih sedikit.
- Hanya pecah jadi topik terpisah kalau memang jelas-jelas beda konteks/tujuan kerja (misal: "bug login" vs "fitur baru dashboard" adalah 2 topik beda; tapi "bug login" dan "testing ulang login" adalah 1 topik sama).
- Jangan mengarang bullet yang tidak ada dasarnya di transkrip.
- Bullet ditulis singkat, actionable, dalam bahasa yang sama dengan transkrip.

Transkrip:
${transcript}`
}

/** Same shape/logic as the other routes' getPersonalLLM (duplicated per-route
 *  in this codebase rather than shared — matching existing convention). */
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

function parseTopics(raw: string): { title: string; bullets: string[] }[] | null {
  try {
    const j = JSON.parse(raw) as { topics?: unknown }
    if (!Array.isArray(j.topics)) return null
    const topics = (j.topics as { title?: unknown; bullets?: unknown }[])
      .map(t => ({
        title: typeof t.title === 'string' ? t.title.trim() : '',
        bullets: Array.isArray(t.bullets) ? t.bullets.filter((b): b is string => typeof b === 'string' && b.trim().length > 0).map(b => b.trim()) : [],
      }))
      .filter(t => t.title && t.bullets.length > 0)
    return topics.length > 0 ? topics : null
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  const ctx = await getRequestContext()
  if (process.env.ISL_MULTIUSER === '1' && !ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({})) as { transcript?: string }
  const transcript = (body.transcript ?? '').trim()
  if (!transcript) return NextResponse.json({ error: 'transcript required' }, { status: 400 })

  const owner = process.env.ISL_MULTIUSER === '1' ? isOwnerUid(ctx?.uid) : true
  const personal = owner ? null : await getPersonalLLM(ctx)

  if (!owner && !personal) {
    return NextResponse.json({ error: 'AI not configured — set provider + API key sendiri di Settings.' }, { status: 400 })
  }

  const fallbackCfg = owner
    ? getLLMConfig()
    : { provider: personal!.provider as Parameters<typeof callLLM>[1]['provider'], apiKey: personal!.apiKey, model: personal!.model ?? undefined, baseUrl: personal!.baseUrl ?? undefined }

  if (owner && !fallbackCfg) {
    return NextResponse.json({ error: 'AI not configured. Go to Settings and add an API key.' }, { status: 400 })
  }

  const prompt = buildPrompt(transcript)

  let topics: { title: string; bullets: string[] }[] | null = null

  // 1) Local-first (Ollama, free) — same pattern as chat/extract, dira/estimate.
  const localRaw = await callLocalLLM(prompt, STRUCTURE_FORMAT)
  if (localRaw) topics = parseTopics(localRaw)

  // 2) Fallback: caller's own personal provider (non-owner) or owner's global engine.
  if (!topics) {
    try {
      const text = await callLLM(`${prompt}\n\nBalas HANYA dengan JSON: {"topics":[{"title":"...","bullets":["...","..."]}]}`, fallbackCfg!)
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      topics = jsonMatch ? parseTopics(jsonMatch[0]) : null
    } catch (e) {
      return NextResponse.json({ error: String(e).slice(0, 300) }, { status: 500 })
    }
  }

  if (!topics) return NextResponse.json({ error: 'AI tidak berhasil mengelompokkan transkrip ini, coba lagi.' }, { status: 502 })

  // 3) Collaborate with Dira: one estimate per topic (same judgment as
  //    /api/dira/estimate — title=topic title, bullets=that topic's tasks).
  const withEstimates = await Promise.all(topics.map(async (t) => {
    const est = await estimateTask(t.title, '', t.bullets, fallbackCfg ?? null).catch(() => null)
    return {
      title: t.title,
      bullets: t.bullets,
      estimatedMins: est?.estimatedMins ?? 30,
      reasoning: est?.reasoning ?? null,
    }
  }))

  return NextResponse.json({ topics: withEstimates })
}
