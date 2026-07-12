import { NextResponse } from 'next/server'
import { callLLM, getLLMConfig } from '@/lib/llm'
import { callLocalLLM } from '@/lib/local-llm'
import { getRequestContext } from '@/lib/request-auth'

export const runtime = 'nodejs'

// Constrained decoding schema — full JSON Schema WAJIB (format:'json' saja tidak
// cukup untuk model 3B). Markdown summary dirakit server-side dari JSON ini,
// jadi format output ke frontend DIJAMIN persis sama dengan versi Claude.
const WRAPUP_FORMAT = {
  type: 'object',
  properties: {
    points:    { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4 },
    highlight: { type: 'string' },
  },
  required: ['points', 'highlight'],
} as const

export async function POST(req: Request) {
  // Login required — falls back to the owner's LLM config if local Ollama is down.
  if (!(await getRequestContext())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { sessions, date } = await req.json()
  if (!sessions?.length) return NextResponse.json({ error: 'No sessions' }, { status: 400 })

  const sessionText = sessions.map((s: { title: string; bullets: string[]; time?: string }) =>
    `### ${s.title}${s.time ? ` (${s.time})` : ''}\n${s.bullets.map((b: string) => `- ${b}`).join('\n')}`
  ).join('\n\n')

  // ── Local-first: Ollama (qwen2.5:3b) — gratis & offline ──────────────────────
  const localPrompt = `Kamu adalah asisten daily standup. Ringkas sesi kerja berikut (tanggal ${date}) dalam Bahasa Indonesia.
- "points": poin singkat per topik utama, maksimal 4 poin.
- "highlight": 1 kalimat tentang pencapaian paling signifikan.
Buat ringkasan yang padat, profesional, dan cocok untuk daily standup meeting.

Sesi kerja:
${sessionText}`

  const localRaw = await callLocalLLM(localPrompt, WRAPUP_FORMAT)
  if (localRaw) {
    try {
      const j = JSON.parse(localRaw) as { points?: unknown; highlight?: unknown }
      const points = Array.isArray(j.points)
        ? j.points.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).slice(0, 4)
        : []
      const highlight = typeof j.highlight === 'string' ? j.highlight.trim() : ''
      if (points.length > 0 && highlight) {
        console.log('[wrapup] via ollama')
        const summary = [
          '**Yang dikerjakan hari ini:**',
          ...points.map(p => `- ${p}`),
          '',
          '**Highlight:**',
          highlight,
        ].join('\n')
        return NextResponse.json({ ok: true, summary })
      }
    } catch { /* invalid JSON → fallback Claude */ }
  }

  // ── Fallback: existing Claude path, unchanged ─────────────────────────────────
  const llmCfg = getLLMConfig()
  if (!llmCfg) return NextResponse.json({ error: 'AI provider not configured' }, { status: 500 })

  const prompt = `Kamu adalah asisten daily standup. Buat ringkasan singkat dalam bahasa Indonesia dari sesi kerja berikut untuk tanggal ${date}.

Format output:
**Yang dikerjakan hari ini:**
- [poin singkat per topik utama, maks 4 poin]

**Highlight:**
[1 kalimat tentang pencapaian paling signifikan]

Sesi kerja:
${sessionText}

Buat ringkasan yang padat, profesional, dan cocok untuk daily standup meeting.`

  console.log('[wrapup] via claude')
  const text = await callLLM(prompt, llmCfg)
  return NextResponse.json({ ok: true, summary: text })
}
