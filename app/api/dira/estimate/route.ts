import { NextResponse } from 'next/server'
import { callLLM, getLLMConfig } from '@/lib/llm'
import { callLocalLLM } from '@/lib/local-llm'
import { getRequestContext, type RequestContext } from '@/lib/request-auth'
import { isOwnerUid } from '@/lib/auth'
import { db, userSettings } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'

export const runtime = 'nodejs'

// ── Dira, pilot #1 of the agent-taxonomy roadmap (2026-07-15 discussion) ─────
// Dira's existing job (timer tracking, auto-push on stop) is pure automation —
// zero judgment. This is Dira's first REAL agentic capability: read a ticket's
// title/description and suggest a time estimate, instead of the hardcoded
// 60-minute default used everywhere a task gets logged with no estimate
// (see components/IncomingTasksPanel.tsx's onAddToQueue). Deliberately narrow
// scope per the roadmap: one ticket in, one number + one-line reasoning out.
// Never auto-applies — the human reads the suggestion and decides, same
// human-in-the-loop pattern as Arka's task-matching.

const ESTIMATE_FORMAT = {
  type: 'object',
  properties: {
    estimatedMins: { type: 'integer' },
    reasoning: { type: 'string' },
  },
  required: ['estimatedMins', 'reasoning'],
} as const

function buildPrompt(title: string, description: string, bullets: string[]): string {
  return `Kamu adalah Dira, asisten estimasi waktu kerja untuk tim developer/QA. Baca tiket berikut dan perkirakan berapa MENIT waktu realistis yang dibutuhkan untuk mengerjakannya sampai selesai (termasuk testing dasar), berdasarkan kompleksitas yang tersirat dari judul/deskripsinya.

Judul: ${title}
Deskripsi: ${description || '(tidak ada deskripsi)'}
${bullets.length ? `Catatan tambahan:\n${bullets.map(b => `- ${b}`).join('\n')}` : ''}

Kalau deskripsinya minim, tetap kasih estimasi masuk akal berdasarkan judulnya saja (jangan menolak) — sebutkan itu di reasoning. Estimasi dalam MENIT (integer, kelipatan 15 disarankan: 15/30/45/60/90/120/180/240...). Reasoning 1 kalimat singkat, Bahasa Indonesia.`
}

function parseEstimate(raw: string): { estimatedMins: number; reasoning: string } | null {
  try {
    const j = JSON.parse(raw) as { estimatedMins?: unknown; reasoning?: unknown }
    const mins = Number(j.estimatedMins)
    const reasoning = typeof j.reasoning === 'string' ? j.reasoning.trim() : ''
    if (!Number.isFinite(mins) || mins <= 0) return null
    return { estimatedMins: Math.round(mins), reasoning: reasoning || 'Estimasi berdasarkan judul/deskripsi tiket.' }
  } catch {
    return null
  }
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

export async function POST(req: Request) {
  const ctx = await getRequestContext()
  if (process.env.ISL_MULTIUSER === '1' && !ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({})) as { title?: string; description?: string; bullets?: string[] }
  const title = (body.title ?? '').trim()
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 })
  const description = (body.description ?? '').trim()
  const bullets = Array.isArray(body.bullets) ? body.bullets.filter(Boolean) : []

  const prompt = buildPrompt(title, description, bullets)

  // 1) Local-first (Ollama, free) — same pattern as chat/extract, aryo/narrative.
  const localRaw = await callLocalLLM(prompt, ESTIMATE_FORMAT)
  if (localRaw) {
    const parsed = parseEstimate(localRaw)
    if (parsed) return NextResponse.json({ ...parsed, source: 'ollama' })
  }

  // 2) Fallback: caller's own personal provider (non-owner) or owner's global
  //    engine config (owner) — same isolation pattern as chat/extract's fix.
  const owner = process.env.ISL_MULTIUSER === '1' ? isOwnerUid(ctx?.uid) : true
  const personal = owner ? null : await getPersonalLLM(ctx)

  try {
    let text: string
    if (!owner && personal) {
      text = await callLLM(prompt, {
        provider: personal.provider as Parameters<typeof callLLM>[1]['provider'],
        apiKey: personal.apiKey, model: personal.model ?? undefined, baseUrl: personal.baseUrl ?? undefined,
      })
    } else if (!owner) {
      return NextResponse.json({ error: 'AI not configured — set provider + API key sendiri di Settings.' }, { status: 400 })
    } else {
      const cfg = getLLMConfig()
      if (!cfg) return NextResponse.json({ error: 'AI not configured. Go to Settings and add an API key.' }, { status: 400 })
      text = await callLLM(`${prompt}\n\nBalas HANYA dengan JSON: {"estimatedMins": <angka>, "reasoning": "<1 kalimat>"}`, cfg)
    }
    // Claude-cli/cloud text responses aren't schema-constrained like Ollama's —
    // pull the JSON object out defensively rather than assuming a clean parse.
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    const parsed = jsonMatch ? parseEstimate(jsonMatch[0]) : null
    if (!parsed) return NextResponse.json({ error: 'AI tidak memberikan estimasi yang valid, coba lagi.' }, { status: 502 })
    return NextResponse.json({ ...parsed, source: owner ? 'owner-engine' : personal!.provider })
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 300) }, { status: 500 })
  }
}
