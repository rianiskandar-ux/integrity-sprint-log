/**
 * Shared task-title helper: turn a task's actual bullets into a SHORT
 * descriptive title (not a generic bucket like "Fix & Repair"). Used by:
 *  - push-session's auto task-breakdown (server, on push), and
 *  - /api/suggest/title (the click-to-suggest button in the Push Queue form).
 * Keeping it in one place so both produce the same style of title (Nico
 * feedback, 2026-07-23).
 */
import { callLocalLLM } from './local-llm'

/** Strip the [Xm] time prefix and trailing commit-hash so a bullet reads as
 *  plain work text. */
export function cleanBullet(b: string): string {
  return b.replace(/^\[\d+m\]\s*/, '').replace(/\s*\([0-9a-f]{7,}\)\s*$/i, '').trim()
}

/** Summarize bullets into one short descriptive title via the local LLM.
 *  On any failure (Ollama down → callLocalLLM returns null) falls back to the
 *  first real bullet, then `fallback` — so callers always get something usable. */
export async function suggestTaskTitle(bullets: string[], fallback = ''): Promise<string> {
  const clean = (bullets ?? []).map(cleanBullet).filter(Boolean)
  if (!clean.length) return fallback
  const derived = clean[0].slice(0, 70)   // deterministic fallback: first real bullet
  try {
    const prompt = `Ringkas daftar aktivitas kerja berikut menjadi SATU judul task singkat yang menjelaskan APA yang dikerjakan (maksimal 8 kata, tanpa tanda kutip, tanpa nomor, ikuti bahasa isinya). Jangan pakai kata generik seperti "Fix" atau "Implementation" saja — sebutkan objek konkretnya.

Aktivitas:
${clean.map(b => `- ${b}`).join('\n')}

Judul:`
    const raw = await callLocalLLM(prompt)
    if (raw) {
      const line = raw.trim().split('\n')[0].replace(/^["'`\s\-*\d.]+/, '').replace(/["'`\s]+$/, '').slice(0, 90)
      if (line.length >= 4) return line
    }
  } catch { /* fall through to derived */ }
  return derived || fallback
}
