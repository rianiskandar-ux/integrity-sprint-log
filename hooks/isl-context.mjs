#!/usr/bin/env node
/**
 * ISL Claude Code Hook
 * Fires on Stop event — analyzes conversation context,
 * extracts task info, sends draft to ISL for review.
 */

import { createRequire } from 'module'
const require = createRequire(import.meta.url)

const ISL_URL = process.env.ISL_URL || 'http://localhost:3000'
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

async function main() {
  let hookData = ''
  try {
    hookData = await new Promise((resolve) => {
      let data = ''
      process.stdin.on('data', chunk => data += chunk)
      process.stdin.on('end', () => resolve(data))
      setTimeout(() => resolve(data), 2000)
    })
  } catch { process.exit(0) }

  let payload
  try { payload = JSON.parse(hookData) } catch { process.exit(0) }

  // Only fire on Stop event with substantial content
  const transcript = payload?.transcript ?? payload?.messages ?? []
  if (!transcript.length) process.exit(0)

  // Get last assistant message content
  const lastAssistant = [...transcript].reverse().find(m => m.role === 'assistant')
  if (!lastAssistant) process.exit(0)

  const content = typeof lastAssistant.content === 'string'
    ? lastAssistant.content
    : Array.isArray(lastAssistant.content)
      ? lastAssistant.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
      : ''

  if (content.length < 100) process.exit(0) // skip trivial responses

  // Get last few user messages for context
  const recentUser = transcript
    .filter(m => m.role === 'user')
    .slice(-3)
    .map(m => typeof m.content === 'string' ? m.content : '')
    .join('\n')
    .slice(0, 800)

  // Use Claude Haiku to extract task info
  if (!ANTHROPIC_API_KEY) {
    // Fallback: simple heuristic extraction
    await sendDraft({
      title: extractTitle(content),
      bullets: extractBullets(content),
      estimatedMins: 30,
      source: content.slice(0, 200),
    })
    process.exit(0)
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        messages: [{
          role: 'user',
          content: `Analisis percakapan kerja ini dan ekstrak informasi task dalam format JSON.

Konteks user:
${recentUser}

Respons terakhir Claude (ringkasan pekerjaan):
${content.slice(0, 1000)}

Kembalikan JSON saja (tidak ada teks lain):
{
  "title": "Judul task singkat dan jelas (maks 60 karakter)",
  "bullets": ["poin kerja 1", "poin kerja 2", "poin kerja 3"],
  "estimatedMins": <perkiraan menit berdasarkan kompleksitas, min 15 maks 240>,
  "isSubstantial": <true jika pekerjaan nyata, false jika hanya tanya-jawab singkat>
}`,
        }],
      }),
    })

    if (!res.ok) throw new Error('API error')
    const data = await res.json()
    const text = data.content?.[0]?.text ?? ''
    const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '{}')

    if (!json.isSubstantial) process.exit(0)

    await sendDraft({
      title: json.title || extractTitle(content),
      bullets: json.bullets || extractBullets(content),
      estimatedMins: json.estimatedMins || 30,
      source: recentUser.slice(0, 200),
    })
  } catch {
    // Fallback on any error
    await sendDraft({
      title: extractTitle(content),
      bullets: extractBullets(content),
      estimatedMins: 30,
      source: recentUser.slice(0, 200),
    })
  }

  process.exit(0)
}

async function sendDraft(draft) {
  try {
    await fetch(`${ISL_URL}/api/op/context`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draft),
    })
  } catch { /* ISL might not be running */ }
}

function extractTitle(text) {
  // Try to get first meaningful line
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 10 && l.length < 80)
  const heading = lines.find(l => l.startsWith('#'))
  if (heading) return heading.replace(/^#+\s*/, '').slice(0, 60)
  return lines[0]?.slice(0, 60) || 'Work Session'
}

function extractBullets(text) {
  const bullets = text.match(/^[-*•]\s+.+/gm) ?? []
  return bullets.slice(0, 4).map(b => b.replace(/^[-*•]\s+/, '').slice(0, 100))
}

main().catch(() => process.exit(0))
