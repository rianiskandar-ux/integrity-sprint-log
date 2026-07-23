import { callLLM, getLLMConfig, type LLMConfig } from '@/lib/llm'
import { callLocalLLM } from '@/lib/local-llm'
import { estimateFromHistory, type DiraEstimate } from '@/lib/dira'

// Shared core of Dira's time-estimation judgment — factored out so Luna's
// session-structuring pipeline can genuinely call INTO Dira's capability
// (per the roadmap: "Luna collaborates with Dira for time estimates") rather
// than duplicating the same prompt/logic under a different name.
//
// Correction loop (v1, 2026-07-23): the estimate is now GROUNDED in how long
// similar past work actually took (median of comparable sessions' actual_mins,
// via lib/dira.ts). This is the retrieval-not-training loop — the model gets
// real outcomes as an anchor instead of guessing from the title alone, and it
// self-improves as more sessions accrue actuals. No separate capture step:
// the learning data IS the sessions (already embedded + actual_mins stored).

export const ESTIMATE_FORMAT = {
  type: 'object',
  properties: {
    estimatedMins: { type: 'integer' },
    reasoning: { type: 'string' },
  },
  required: ['estimatedMins', 'reasoning'],
} as const

export function buildEstimatePrompt(title: string, description: string, bullets: string[], calibrationNote = ''): string {
  return `Kamu adalah Dira, asisten estimasi waktu kerja untuk tim developer/QA. Baca tiket berikut dan perkirakan berapa MENIT waktu realistis yang dibutuhkan untuk mengerjakannya sampai selesai (termasuk testing dasar), berdasarkan kompleksitas yang tersirat dari judul/deskripsinya.

Judul: ${title}
Deskripsi: ${description || '(tidak ada deskripsi)'}
${bullets.length ? `Catatan tambahan:\n${bullets.map(b => `- ${b}`).join('\n')}` : ''}${calibrationNote}

Kalau deskripsinya minim, tetap kasih estimasi masuk akal berdasarkan judulnya saja (jangan menolak) — sebutkan itu di reasoning. Estimasi dalam MENIT (integer, kelipatan 15 disarankan: 15/30/45/60/90/120/180/240...). Reasoning 1 kalimat singkat, Bahasa Indonesia.`
}

/** Build the historical-calibration note from real actual durations of similar
 *  past sessions. Empty string when there isn't enough close history (the
 *  prompt is then unchanged — pure title/description guess as before). */
function calibrationNoteFrom(hist: DiraEstimate): string {
  if (hist.suggestedMins == null || !hist.basis) return ''
  return `\n\nData historis (acuan UTAMA): ${hist.sampleCount} tugas serupa di masa lalu betul-betul memakan waktu median ~${hist.basis.median} menit (rentang ${hist.basis.min}–${hist.basis.max}m). Sesuaikan estimasimu ke realita ini — jangan cuma menebak dari judul.`
}

export function parseEstimate(raw: string): { estimatedMins: number; reasoning: string } | null {
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

/** Dira's judgment: title(+description/bullets) -> {estimatedMins, reasoning}.
 *  Local-first (Ollama), falls back to the given LLMConfig (caller resolves
 *  owner-vs-personal isolation before calling this — see /api/dira/estimate
 *  and /api/luna/structure for the two call sites). Returns null on total
 *  failure — caller decides the fallback (e.g. a generic default estimate). */
export async function estimateTask(
  title: string, description: string, bullets: string[],
  fallbackCfg: LLMConfig | null,
): Promise<{ estimatedMins: number; reasoning: string; usedLocal: boolean; historyBasis: DiraEstimate['basis']; historySamples: number } | null> {
  // Ground the estimate in real past outcomes (correction loop). Best-effort —
  // if history is thin or lookup fails, calibration note is empty and Dira
  // estimates from title/description as before.
  let hist: DiraEstimate = { suggestedMins: null, sampleCount: 0, basis: null }
  try { hist = await estimateFromHistory(title, [description, ...bullets].filter(Boolean)) } catch { /* no calibration */ }
  const prompt = buildEstimatePrompt(title, description, bullets, calibrationNoteFrom(hist))

  const localRaw = await callLocalLLM(prompt, ESTIMATE_FORMAT)
  if (localRaw) {
    const parsed = parseEstimate(localRaw)
    if (parsed) return { ...parsed, usedLocal: true, historyBasis: hist.basis, historySamples: hist.sampleCount }
  }

  if (!fallbackCfg) return null
  try {
    const text = await callLLM(`${prompt}\n\nBalas HANYA dengan JSON: {"estimatedMins": <angka>, "reasoning": "<1 kalimat>"}`, fallbackCfg)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    const parsed = jsonMatch ? parseEstimate(jsonMatch[0]) : null
    return parsed ? { ...parsed, usedLocal: false, historyBasis: hist.basis, historySamples: hist.sampleCount } : null
  } catch {
    return null
  }
}

export { getLLMConfig }
