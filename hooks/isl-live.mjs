#!/usr/bin/env node
/**
 * ISL Live Hook — UserPromptSubmit event
 * Fires every time user sends a message in Claude Code.
 * Creates/updates a "live" session in ISL so it appears in Daily Hub immediately.
 * No AI calls, no OP calls — must be fast (<500ms).
 */

import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const ISL_URL = process.env.ISL_URL || 'http://localhost:4891'

async function main() {
  let payload = {}
  try {
    const raw = await new Promise(resolve => {
      let data = ''
      process.stdin.on('data', c => (data += c))
      process.stdin.on('end', () => resolve(data))
      setTimeout(() => resolve(data), 2000)
    })
    if (raw.trim()) payload = JSON.parse(raw)
  } catch { process.exit(0) }

  const sessionId = payload.session_id
  if (!sessionId) process.exit(0)

  // Find transcript
  let transcriptPath = payload.transcript_path
  if (!transcriptPath && sessionId) {
    const projectsDir = join(homedir(), '.claude', 'projects')
    try {
      for (const proj of readdirSync(projectsDir)) {
        const c = join(projectsDir, proj, `${sessionId}.jsonl`)
        if (existsSync(c)) { transcriptPath = c; break }
      }
    } catch {}
  }

  // Extract first user message as tentative title + count messages
  let title = 'Active session…'
  let msgCount = 0
  const now = new Date().toISOString()

  const userTopics = []
  if (transcriptPath && existsSync(transcriptPath)) {
    try {
      const lines = readFileSync(transcriptPath, 'utf-8').trim().split('\n')
      for (const line of lines) {
        try {
          const entry = JSON.parse(line)
          if (entry.type !== 'user' && entry.type !== 'assistant') continue
          const raw = entry.message?.content ?? ''
          const text = typeof raw === 'string' ? raw
            : Array.isArray(raw) ? raw.filter(b => b.type === 'text').map(b => b.text).join(' ') : ''
          if (text.length > 10) {
            msgCount++
            if (entry.type === 'user') {
              const clean = text.slice(0, 120).split('\n')[0].trim()
                .replace(/^(fix|update|add|implement|buat|tolong|coba|gw|ok|oke|ya|iya)\s+/i, '')
                .trim()
              if (clean.length > 8) userTopics.push(clean)
            }
            // First user message = session title
            if (msgCount === 1 && entry.type === 'user') {
              title = text.slice(0, 100).split('\n')[0].trim() || title
            }
          }
        } catch {}
      }
    } catch {}
  }

  // Dedupe and take last 5 unique user topics as preliminary bullets
  const seen = new Set()
  const bullets = userTopics.reverse().filter(t => {
    const key = t.slice(0, 40).toLowerCase()
    if (seen.has(key)) return false
    seen.add(key); return true
  }).slice(0, 5).reverse()

  // Anti-spam: skip if this is literally the first message (< 1 message exchanged yet)
  // We want the session to appear after the first real exchange
  if (msgCount < 2) process.exit(0)

  // Clean up title — remove code/command artifacts
  title = title.replace(/^(fix|update|add|implement|buat|tolong|coba|gw|kita|ok|oke)\s+/i, '').trim()
  if (title.length > 80) title = title.slice(0, 77) + '…'
  if (!title || title.length < 3) title = 'Active session…'

  // POST to ISL — upsert by sessionId, set pushStatus:'live'
  try {
    await fetch(`${ISL_URL}/api/isl/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(4000),
      body: JSON.stringify({
        sessionId,
        title,
        pushStatus: 'live',
        startedAt: now,
        bullets,
        estimatedMins: 30,
        needsValidation: false,
        hasExplicitCmd: false,
        autoPushed: false,
        source: 'live',
      }),
    })
  } catch {}

  process.exit(0)
}

main().catch(() => process.exit(0))
