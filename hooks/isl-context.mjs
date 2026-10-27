#!/usr/bin/env node
/**
 * ISL Claude Code Hook — Stop event
 *
 * COMMAND SYSTEM (ketik di akhir sesi, 5 pesan terakhir):
 *   !done        → task selesai tuntas          → OP: Closed
 *   !hold        → ada blocker / pause          → OP: On Hold
 *   !wip         → masih lanjut besok           → OP: In Progress
 *   !backlog     → tunda sprint ini             → OP: New (sprint dihapus)
 *   !abandon     → tidak jadi dikerjakan        → OP: Rejected
 *   !intermezzo  → bukan kerja, skip total      → tidak masuk ISL
 *   !ticket:ID   → bind langsung ke task OP ID  → skip fuzzy matching
 *
 * Anti-spam   : sesi < 3 pesan atau < 2 menit → skip
 * Task search : open + closed dalam sprint aktif (bukan hanya 7 hari)
 * userId      : auto-detect dari OP /users/me, simpan ke op-mode.json
 * Token track : konsumsi token Anthropic dicatat per sesi
 * MD memory   : setiap sesi append ke memory/Epic-{id}/Story-{id}/Task-{id}.md
 * Relate detect: task closed lama → buat task baru dgn referensi
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync, openSync, readSync, closeSync } from 'fs'
import { join }    from 'path'
import { homedir } from 'os'
import { spawn }   from 'child_process'

const ISL_URL           = process.env.ISL_URL    || 'http://localhost:3000'
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const OP_BASE_URL       = process.env.OP_BASE_URL || 'https://tokek.integrity-asia.com'
const OP_API_TOKEN      = process.env.OP_API_TOKEN
const ISL_DIR           = process.env.ISL_DIR || process.env.CACHE_DATA_DIR || process.cwd()
const MEMORY_DIR        = `${ISL_DIR}/memory`
const PENDING_QUEUE_FILE = `${ISL_DIR}/pending-hook-posts.json`

// ── Durable POST ──────────────────────────────────────────────────────────────
// A bare `fetch(...).catch(()=>{})` never checks res.ok and drops the payload
// on any failure — found (2026-07-09) to have silently lost 2+ days of session
// data while the ISL app/DB were down/rebuilding. postDurable() checks res.ok,
// and on ANY failure (network or non-2xx) queues the payload to a local JSON
// file instead of dropping it. Every call also flushes whatever's already
// queued first, so the next successful hook run recovers prior failures —
// no data is lost outright, at worst it's late.
function loadPendingQueue() {
  try { return JSON.parse(readFileSync(PENDING_QUEUE_FILE, 'utf-8')) } catch { return [] }
}
function savePendingQueue(queue) {
  try { writeFileSync(PENDING_QUEUE_FILE, JSON.stringify(queue, null, 2)) } catch {}
}
async function postDurable(path, body, headers) {
  let queue = loadPendingQueue()
  if (queue.length > 0) {
    const stillPending = []
    for (const item of queue) {
      try {
        const r = await fetch(`${ISL_URL}${item.path}`, {
          method: 'POST', headers: item.headers, body: JSON.stringify(item.body),
          signal: AbortSignal.timeout(5000),
        })
        if (!r.ok) stillPending.push(item)
      } catch { stillPending.push(item) }
    }
    queue = stillPending
  }
  try {
    const r = await fetch(`${ISL_URL}${path}`, {
      method: 'POST', headers, body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    })
    if (!r.ok) queue.push({ path, headers, body, queuedAt: new Date().toISOString() })
  } catch {
    queue.push({ path, headers, body, queuedAt: new Date().toISOString() })
  }
  savePendingQueue(queue)
}

// ── Commands ──────────────────────────────────────────────────────────────────
// Commands set ISL-local status only — OP status is NOT auto-synced.
// User manually validates/changes status via Auto Log buttons in ISL.
const COMMANDS = {
  '!done':      { islStatus: 'done'        },
  '!hold':      { islStatus: 'on_hold'     },
  '!wip':       { islStatus: 'in_progress' },
  '!backlog':   { islStatus: 'backlog'     },
  '!abandon':   { islStatus: 'abandoned'   },
  '!intermezzo':{ islStatus: null          },
}

function detectCommand(messages) {
  const last5 = messages.slice(-5).map(m => m.text.toLowerCase())
  for (const [cmd, cfg] of Object.entries(COMMANDS)) {
    if (last5.some(t => t.includes(cmd))) return { cmd, ...cfg }
  }
  return null
}

// !ticket:1234 — bind langsung ke OP task ID, skip fuzzy matching
function detectTicketBinding(messages) {
  const last5 = messages.slice(-5).map(m => m.text)
  for (const msg of last5) {
    const match = msg.match(/!ticket[:\s]+(\d+)/i)
    if (match) return parseInt(match[1])
  }
  // Also check first 3 messages (session start binding)
  const first3 = messages.slice(0, 3).map(m => m.text)
  for (const msg of first3) {
    const match = msg.match(/!ticket[:\s]+(\d+)/i)
    if (match) return parseInt(match[1])
  }
  return null
}

// ── Config ────────────────────────────────────────────────────────────────────
const DEFAULT_MODE = {
  mode: 'test', project: 'scrum-project', epicId: 7255,
  stories: { isl: 7256, kyv: 7257, verif: 7258, phoenix: 7259, general: 7260 },
}

function getOPMode() {
  try   { return { ...DEFAULT_MODE, ...JSON.parse(readFileSync(`${ISL_DIR}/op-mode.json`, 'utf-8')) }
  } catch { return DEFAULT_MODE }
}

async function resolveUserId(opMode) {
  if (opMode.userId) return opMode.userId
  if (OP_API_TOKEN) {
    try {
      const res = await fetch(`${OP_BASE_URL}/api/v3/users/me`, {
        headers: { Authorization: 'Basic ' + Buffer.from(`apikey:${OP_API_TOKEN}`).toString('base64') },
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.id) {
          const current = getOPMode()
          writeFileSync(`${ISL_DIR}/op-mode.json`, JSON.stringify({ ...current, userId: data.id }, null, 2))
          return data.id
        }
      }
    } catch {}
  }
  return 8
}

// ── Story/Epic matching ───────────────────────────────────────────────────────
const STORY_KEYWORDS = {
  isl:     ['isl', 'integrity sprint', 'daily sprint', 'sprint log', 'hook', 'draftcard', 'wrapup', 'autolog', 'i18n', 'translat', 'parser.ts', 'op-cache', 'appshell', 'sprintbanner', 'incoming', 'tiket masuk'],
  kyv:     ['kyv', 'know your vendor', 'docker', 'nginx', 'apache', 'ssl', 'server', 'devops', 'deploy', 'laragon', 'infra', 'vps', 'ssh', 'vm', 'debian', 'container'],
  verif:   ['empverif', 'eduverif', 'employment verif', 'education verif', 'verification', 'wordpress', 'wp plugin', 'wp config', 'wp-config', 'plugin'],
  phoenix: ['phoenix', 'saas', 'portal', 'wbs', 'onboard', 'customer portal', 'pmi', 'beo', 'knowme'],
}

function pickStory(title, bullets, stories) {
  const text = (title + ' ' + bullets.join(' ')).toLowerCase()
  let best = null, bestCount = 0
  for (const [key, kws] of Object.entries(STORY_KEYWORDS)) {
    const count = kws.filter(kw => text.includes(kw)).length
    if (count > bestCount) { bestCount = count; best = key }
  }
  return best ? (stories[best] ?? stories.general ?? null) : (stories.general ?? null)
}

// ── Sprint helpers ────────────────────────────────────────────────────────────
function getCurrentSprint() {
  try {
    const cache = JSON.parse(readFileSync(`${ISL_DIR}/op-cache.json`, 'utf-8'))
    const today = new Date().toISOString().slice(0, 10)
    return (cache.sprints ?? []).find(s =>
      s.isCurrent === true || (s.startDate <= today && s.endDate >= today)
    ) ?? null
  } catch { return null }
}

function getSprintHoursUsed() {
  try {
    const sprint  = getCurrentSprint()
    const cutoff  = sprint?.startDate ?? new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)
    const logsDir = join(ISL_DIR, 'session-logs')
    if (!existsSync(logsDir)) return 0
    const files   = readdirSync(logsDir).filter(f => f.endsWith('.json'))
    let total = 0
    for (const f of files) {
      try {
        const s = JSON.parse(readFileSync(join(logsDir, f), 'utf-8'))
        if (s.pushStatus !== 'discarded' && (s.startedAt ?? '').slice(0, 10) >= cutoff) {
          total += s.actualMins || s.estimatedMins || 0
        }
      } catch {}
    }
    return total / 60
  } catch { return 0 }
}

// ── Task matching — open + closed within current sprint ──────────────────────
function findMatchingTask(title, bullets) {
  try {
    const cache  = JSON.parse(readFileSync(`${ISL_DIR}/op-cache.json`, 'utf-8'))
    const sprint = getCurrentSprint()
    const cutoff = sprint?.startDate ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)

    const isLeafType = t => !/user.?story|story|epic|feature/i.test(t.type ?? '')
    const openTasks   = (cache.myOpenTasks   ?? []).filter(t => t.islStatus !== 'abandoned' && t.islStatus !== 'rejected' && isLeafType(t))
    const closedTasks = (cache.myClosedTasks ?? []).filter(t => (t.updatedAt ?? '').slice(0, 10) >= cutoff && isLeafType(t))
    const pool        = [...openTasks, ...closedTasks]
    if (!pool.length) return null

    const text     = (title + ' ' + bullets.join(' ')).toLowerCase()
    const allWords = text.split(/\W+/).filter(w => w.length > 3)
    const stopwords = new Set(['this','that','with','from','have','will','been','into','more',
      'than','when','make','task','work','done','setup','update','untuk','yang','dengan','pada'])
    const keywords = [...new Set(allWords.filter(w => !stopwords.has(w)))]

    let best = null, bestScore = 0
    for (const task of pool) {
      const taskText = task.subject.toLowerCase()
      // Only count keywords >= 4 chars that appear as whole-ish words (not substrings of longer words)
      const score = keywords.filter(kw => {
        const idx = taskText.indexOf(kw)
        if (idx === -1) return false
        const before = taskText[idx - 1]
        const after  = taskText[idx + kw.length]
        // Allow match if bordered by non-alpha or start/end of string
        return (!before || /\W/.test(before)) && (!after || /\W/.test(after))
      }).length
      // Require at least 2 keyword hits AND at least 30% of keywords (was 20%)
      const minScore = Math.max(2, Math.ceil(keywords.length * 0.3))
      if (score >= minScore && score > bestScore) { bestScore = score; best = task }
    }
    return best
  } catch { return null }
}

// ── Correction Loop v1 — retrieval before matching ────────────────────────────
// Checks past corrections (Rian re-assigning a session away from Arka's
// original guess) via /api/arka/corrections (hybridSearch over the embeddings
// table, sourceType 'correction'). Zero effect until >=1 correction has been
// made + embedded — expected to be a silent no-op early on, not a bug.
// Threshold: same "reasonably similar" cutoff family as MAX_RELEVANT_DISTANCE
// (0.5) in lib/embeddings.ts, but a bit tighter for an override decision.
const CORRECTION_OVERRIDE_MAX_DISTANCE = 0.4

async function fetchCorrections(title, bullets) {
  try {
    const q = encodeURIComponent(`${title} ${bullets.join(' ')}`)
    const res = await fetch(`${ISL_URL}/api/arka/corrections?query=${q}&limit=3`, {
      headers: { 'x-kafi-key': process.env.KAFI_API_KEY },
      signal: AbortSignal.timeout(3500),
    })
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data.corrections) ? data.corrections : []
  } catch {
    return []  // never block the hook on a correction-lookup failure
  }
}

// Pulls "task #123" ids out of the correction chunk built in
// app/api/op/push-session/route.ts's logCorrection() — keep phrasing in sync.
function parseCorrectionTaskIds(chunk) {
  const wrong = (chunk ?? '').match(/Tebakan salah: task #(\d+)/)
  const right = (chunk ?? '').match(/Koreksi benar: task #(\d+)/)
  return {
    wrongId: wrong ? parseInt(wrong[1], 10) : null,
    rightId: right ? parseInt(right[1], 10) : null,
  }
}

// Find task by exact OP ID (for !ticket:ID binding)
function findTaskById(taskId) {
  try {
    const cache = JSON.parse(readFileSync(`${ISL_DIR}/op-cache.json`, 'utf-8'))
    const all   = [...(cache.myOpenTasks ?? []), ...(cache.myClosedTasks ?? []),
                   ...(cache.userStories ?? []), ...(cache.epics ?? [])]
    return all.find(t => t.id === taskId) ?? null
  } catch { return null }
}

// ── Closed task relate detection ──────────────────────────────────────────────
// Checks if a similar task exists but was closed BEFORE current sprint
function findRelatedOldTask(title, bullets) {
  try {
    const cache  = JSON.parse(readFileSync(`${ISL_DIR}/op-cache.json`, 'utf-8'))
    const sprint = getCurrentSprint()
    const cutoff = sprint?.startDate ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)

    const isLeafType = t => !/user.?story|story|epic|feature/i.test(t.type ?? '')
    // Only look at tasks closed BEFORE current sprint
    const oldClosed = (cache.myClosedTasks ?? []).filter(t => (t.updatedAt ?? '').slice(0, 10) < cutoff && isLeafType(t))
    if (!oldClosed.length) return null

    const text     = (title + ' ' + bullets.join(' ')).toLowerCase()
    const allWords = text.split(/\W+/).filter(w => w.length > 3)
    const stopwords = new Set(['this','that','with','from','have','will','been','into','more',
      'than','when','make','task','work','done','setup','update','untuk','yang','dengan','pada'])
    const keywords = [...new Set(allWords.filter(w => !stopwords.has(w)))]

    let best = null, bestScore = 0
    for (const task of oldClosed) {
      const taskText = task.subject.toLowerCase()
      const score    = keywords.filter(kw => taskText.includes(kw)).length
      if (score >= 2 && score > bestScore) { bestScore = score; best = task }
    }
    return best
  } catch { return null }
}

// ── MD Memory per task — hierarchical Epic/Story/Task ─────────────────────────
function slugify(str = '') {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
}

function resolveTaskHierarchy(taskId) {
  try {
    const cache    = JSON.parse(readFileSync(`${ISL_DIR}/op-cache.json`, 'utf-8'))
    const allTasks = [...(cache.myOpenTasks ?? []), ...(cache.myClosedTasks ?? [])]
    const task     = allTasks.find(t => t.id === taskId)
    const storyId  = task?.userStoryId ?? task?.parentId ?? null
    const storyObj = (cache.userStories ?? []).find(s => s.id === storyId)
    const epicId   = storyObj?.epicId ?? null
    const epicObj  = (cache.epics ?? []).find(e => e.id === epicId)
    return {
      epicId:    epicId   ?? 0,
      epicSlug:  epicObj  ? slugify(epicObj.subject)  : 'uncategorized',
      storyId:   storyId  ?? 0,
      storySlug: storyObj ? slugify(storyObj.subject) : 'general',
      taskSlug:  task     ? slugify(task.subject)     : `task-${taskId}`,
    }
  } catch {
    return { epicId: 0, epicSlug: 'uncategorized', storyId: 0, storySlug: 'general', taskSlug: `task-${taskId}` }
  }
}

async function appendTaskMemory(taskId, title, bullets, date, actualMins, sessionId) {
  // POST to ISL task_memory API (Postgres) — primary storage.
  //
  // Dulu ini `fetch(...).catch(() => {})` tanpa await, dan fungsinya bukan async
  // sehingga pemanggilnya pun tidak bisa menunggu. Hook ini proses pendek: begitu
  // ia keluar, fetch yang belum selesai ditinggal. Akibatnya tabel task_memory
  // KOSONG TOTAL sejak awal, padahal file MD di bawah tetap tertulis (sinkron) —
  // jadi tidak ada satu pun tanda bahwa separuh fungsi ini gagal. Diperbaiki
  // 2026-08-18 dengan postDurable: di-await, dan payload yang gagal diantre ke
  // pending-queue supaya hook berikutnya mengirim ulang.
  await postDurable('/api/isl/task-memory',
    { opTaskId: taskId, title, bullets, date, actualMins, sessionId },
    { 'content-type': 'application/json', 'x-kafi-key': process.env.KAFI_API_KEY })

  // Keep MD file as secondary (read by Claude Code memory system)
  try {
    const hier    = resolveTaskHierarchy(taskId)
    const dir     = join(MEMORY_DIR,
      `Epic-${hier.epicId}-${hier.epicSlug}`,
      `Story-${hier.storyId}-${hier.storySlug}`
    )
    mkdirSync(dir, { recursive: true })
    const file  = join(dir, `Task-${taskId}-${hier.taskSlug}.md`)
    const h     = Math.floor((actualMins ?? 0) / 60)
    const m     = (actualMins ?? 0) % 60
    const dur   = actualMins ? (h > 0 ? `${h}h ${m}m` : `${m}m`) : '—'
    const steps = bullets.filter(Boolean).map(b => `  - ${b}`).join('\n')
    const entry = [
      `\n## Session ${date} (${dur}) — \`${(sessionId ?? '').slice(0,8)}\``,
      '',
      `**Task:** ${title}`,
      '',
      '**Work done:**',
      steps,
      '',
      '---',
    ].join('\n')
    appendFileSync(file, entry, 'utf-8')
  } catch {}
}

// ── Duration from transcript ──────────────────────────────────────────────────
// times = timestamp tingkat-atas tiap baris transkrip (ms), dari readTranscript()
function getActualDurationMins(times) {
  if (times.length < 2) return null
  // min/max lewat loop: Math.max(...times) melempar RangeError bila sesi punya > ±120 ribu baris
  let lo = Infinity, hi = -Infinity
  for (const t of times) { if (t < lo) lo = t; if (t > hi) hi = t }
  // Cap at 480 min (8h) — wall-clock duration can be huge if session left idle
  return Math.min(480, Math.max(1, Math.round((hi - lo) / 60000)))
}

// ── Satu catatan ISL per HARI (Rian 2026-10-27) ──────────────────────────────
// Dulu satu sesi Claude = satu baris ISL selamanya: tanggalnya tanggal Stop pertama, lalu tiap
// Stop berikutnya hanya me-refresh baris itu. Tab God Mode hidup berminggu-minggu, jadi kerja
// 26 Okt tercatat di baris bertanggal 18 Juni (30b94e24) dan menitnya mentok di cap 480.
// Sekarang: hari pertama tetap memakai sessionId, hari berikutnya `<sessionId>@<YYYY-MM-DD WIB>`.
// Menit = menit AKTIF hari itu saja (jeda > 30 menit dibuang) — aturan yang sama dengan jam kerja.
const WIB_MS = 7 * 3600000
const wibDay = t => new Date(t + WIB_MS).toISOString().slice(0, 10)
function activeMins(times) {
  if (times.length < 2) return null
  const s = times.slice().sort((a, b) => a - b)
  let ms = 0
  for (let i = 1; i < s.length; i++) { const g = s[i] - s[i - 1]; if (g > 0 && g <= 30 * 60000) ms += g }
  return Math.max(1, Math.round(ms / 60000))
}

// ── Baca transkrip HEMAT RAM (Rian 2026-10-26) ─────────────────────────────────
// Dulu: readFileSync(seluruh berkas).split('\n') lalu JSON.parse SETIAP baris (dua kali: pesan + durasi). Sesi God Mode
// 6b42d7c7 = 372 MB -> hook memakan ±876 MB RAM & 5-15 dtk di SETIAP akhir prompt (laptop 15,7 GB, sisa sering 2-4 GB).
// Sekarang dibaca per potongan 4 MB; hanya baris berisi "type":"user"/"assistant" yang di-parse. Hasil identik:
//   messages  = pesan user/assistant berteks > 10 karakter (aturan lama)
//   topTimes  = timestamp TINGKAT-ATAS (entry.timestamp ?? entry.createdAt) -> durasi sesi (aturan getActualDurationMins lama)
//   lineTimes = timestamp PERTAMA di tiap baris (regex lama activeSegment, termasuk kebiasaannya) -> capture draf tiket
function* transcriptLines(path) {
  const fd = openSync(path, 'r'), buf = Buffer.alloc(4 << 20)
  let rest = Buffer.alloc(0), n
  try {
    while ((n = readSync(fd, buf, 0, buf.length, null)) > 0) {
      const chunk = rest.length ? Buffer.concat([rest, buf.subarray(0, n)]) : buf.subarray(0, n)
      let s = 0, i
      while ((i = chunk.indexOf(10, s)) >= 0) { yield chunk.toString('utf8', s, i); s = i + 1 }
      rest = Buffer.from(chunk.subarray(s))   // salin: buf dipakai ulang di putaran berikutnya
    }
    if (rest.length) yield rest.toString('utf8')
  } finally { closeSync(fd) }
}
const TS_RE = /"timestamp":"([^"]+)"/
function readTranscript(path) {
  const messages = [], topTimes = [], lineTimes = []
  let count = 0
  for (const line of transcriptLines(path)) {
    count++
    const m = line.match(TS_RE)
    lineTimes.push(m ? Date.parse(m[1]) : NaN)
    if (line.includes('"type":"user"') || line.includes('"type":"assistant"')) {
      try {
        const entry = JSON.parse(line)
        const ts = entry.timestamp ?? entry.createdAt
        if (ts) topTimes.push(new Date(ts).getTime())
        if (entry.type !== 'user' && entry.type !== 'assistant') continue
        const raw  = entry.message?.content ?? ''
        const text = typeof raw === 'string' ? raw
          : Array.isArray(raw) ? raw.filter(b => b.type === 'text').map(b => b.text).join('\n') : ''
        if (text.length > 10) messages.push({ role: entry.type, text })
      } catch {}
      continue
    }
    // baris lain (system, summary, snapshot …): timestamp tingkat-atas = kemunculan TERAKHIR (kunci tingkat-atas ditulis
    // setelah isi bersarang); tanpa JSON.parse
    const k = line.lastIndexOf('"timestamp":"'), c = k < 0 ? line.lastIndexOf('"createdAt":"') : -1
    const at = k >= 0 ? k + 13 : c >= 0 ? c + 13 : -1
    if (at >= 0) { const e = line.indexOf('"', at); if (e > at) topTimes.push(new Date(line.slice(at, e)).getTime()) }
  }
  return { messages, topTimes, lineTimes, count }
}

// ── OP API helpers ────────────────────────────────────────────────────────────
function opHeaders() {
  if (!OP_API_TOKEN) throw new Error('OP_API_TOKEN not set — check .env.local')
  return { Authorization: 'Basic ' + Buffer.from(`apikey:${OP_API_TOKEN}`).toString('base64'), 'Content-Type': 'application/json' }
}
async function opGet(path)       { return fetch(`${OP_BASE_URL}${path}`, { headers: opHeaders() }) }
async function opPost(path, body){ return fetch(`${OP_BASE_URL}${path}`, { method: 'POST',  headers: opHeaders(), body: JSON.stringify(body) }) }
async function opPatch(path,body){ return fetch(`${OP_BASE_URL}${path}`, { method: 'PATCH', headers: opHeaders(), body: JSON.stringify(body) }) }

// ── Activity markdown — clean log format for OP ──────────────────────────────
function buildActivityMarkdown(title, bullets, actualMins, sessionId, date, statusLabel, tokenUsage, relatedId) {
  const h   = Math.floor((actualMins ?? 0) / 60)
  const m   = (actualMins ?? 0) % 60
  const dur = actualMins ? (h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`) : 'unknown'

  const lines = [`**Work Log — ${date}** | ${dur} | ${statusLabel}`]
  lines.push('')
  for (const b of bullets.filter(Boolean)) {
    lines.push(`- ${b}`)
  }
  if (relatedId) {
    lines.push('')
    lines.push(`*Relates to #${relatedId}*`)
  }
  if (tokenUsage) {
    const total = ((tokenUsage.input_tokens ?? 0) + (tokenUsage.output_tokens ?? 0))
    if (total > 0) lines.push(`*Tokens: ${Math.round(total/1000)}k | Session: ${(sessionId ?? '').slice(0,8)}*`)
  }
  return lines.join('\n')
}

function buildTaskDescription(title, bullets, date, relatedId) {
  const scope      = bullets.slice(0, 3).map(b => `- ${b}`).join('\n')
  const relatedStr = relatedId ? `\n\n*Relates to: #${relatedId}*` : ''
  return [`**${title}**`, '', `Scope:`, scope, '', `*Created: ${date} · Detailed activity in Activity tab*${relatedStr}`].join('\n')
}

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_LABELS = { done:'✅ Done', in_progress:'🔄 In Progress', on_hold:'⏸ On Hold', backlog:'📋 Backlog', abandoned:'❌ Abandoned' }
const OP_STATUS_HREF = { done:'/api/v3/statuses/12', in_progress:'/api/v3/statuses/7', on_hold:'/api/v3/statuses/8', backlog:'/api/v3/statuses/1', abandoned:'/api/v3/statuses/14' }

// ── Processed session tracker ─────────────────────────────────────────────────
const PROCESSED_FILE = `${ISL_DIR}/processed-sessions.json`

function isAlreadyProcessed(sessionId) {
  try {
    const data = JSON.parse(readFileSync(PROCESSED_FILE, 'utf-8'))
    return (data.sessions ?? []).includes(sessionId)
  } catch { return false }
}

// Message count at the time the session was last processed — lets a repeat
// Stop decide whether the session grew enough to be worth re-recording
// (fix #1, 2026-07-22: long continuous sessions used to freeze at their first
// snapshot). Backward-compatible: old files without `counts` return 0.
function getProcessedMsgCount(sessionId) {
  try {
    const data = JSON.parse(readFileSync(PROCESSED_FILE, 'utf-8'))
    return (data.counts ?? {})[sessionId] ?? 0
  } catch { return 0 }
}

function markProcessed(sessionId, msgCount = 0) {
  try {
    let data = { sessions: [], counts: {} }
    try { data = JSON.parse(readFileSync(PROCESSED_FILE, 'utf-8')) } catch {}
    const sessions = (data.sessions ?? [])
    const counts   = (data.counts ?? {})
    if (!sessions.includes(sessionId)) sessions.push(sessionId)
    counts[sessionId] = msgCount
    // Keep last 500 sessions only; prune counts to the same window.
    const kept = sessions.slice(-500)
    const keptSet = new Set(kept)
    const prunedCounts = {}
    for (const [k, v] of Object.entries(counts)) if (keptSet.has(k)) prunedCounts[k] = v
    writeFileSync(PROCESSED_FILE, JSON.stringify({ sessions: kept, counts: prunedCounts }, null, 2))
  } catch {}
}

// Refresh an already-recorded session's ISL record with the latest summary,
// WITHOUT any OpenProject write. Used on a repeat Stop of a long continuous
// session: the OP push already happened on the first Stop, so re-pushing would
// create duplicate time entries — instead we PATCH (partial update, so
// opTaskId/pushStatus/etc. are preserved) to keep the Hub record current.
async function refreshSessionRecord(sessionId, fields) {
  try {
    const r = await fetch(`${ISL_URL}/api/isl/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-kafi-key': process.env.KAFI_API_KEY },
      body: JSON.stringify(fields),
      signal: AbortSignal.timeout(5000),
    })
    if (!r.ok) { process.stderr.write(`[ISL] refresh sesi gagal HTTP ${r.status}\n`); return false }
    return true
  } catch (e) { process.stderr.write(`[ISL] refresh sesi error: ${e.message}\n`); return false }
}

// ── Ollama lokal (Phase B) — otak utama summarization, gratis & offline ─────
// Hook jalan di HOST, jadi localhost:11434 langsung. Gagal/invalid → fallback Claude CLI.
async function callOllama(prompt) {
  const base  = process.env.OLLAMA_LOCAL_URL || 'http://localhost:11434'
  const model = process.env.OLLAMA_CHAT_MODEL || 'qwen2.5:3b'
  try {
    const res = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // format = JSON Schema penuh → constrained decoding, struktur DIJAMIN persis
      // (3B suka meratakan skema: activities naik ke level atas, topics kosong)
      // keep_alive 1m: enricher memproses beberapa sesi berurutan (model tetap hangat), lalu ±2 GB RAM
      // segera dilepas — laptop ini sering tinggal 2-4 GB (riwayat freeze)
      body: JSON.stringify({ model, prompt, stream: false, keep_alive: '1m', format: {
        type: 'object',
        properties: {
          isSubstantial: { type: 'boolean' },
          topics: { type: 'array', items: {
            type: 'object',
            properties: {
              title:      { type: 'string' },
              activities: { type: 'array', items: { type: 'string' } },
              taskStatus: { type: 'string', enum: ['done', 'on_hold', 'in_progress', 'backlog', 'abandoned'] },
            },
            required: ['title', 'activities', 'taskStatus'],
          } },
        },
        required: ['isSubstantial', 'topics'],
      }, options: { temperature: 0.2, num_ctx: 8192 } }),
      // 90 dtk terlalu mepet: diukur 75-91 dtk per ringkasan -> sering habis waktu = "output invalid".
      // Enricher (di luar Claude Code, tanpa batas 30 dtk) menaikkan lewat OLLAMA_TIMEOUT_MS.
      signal: AbortSignal.timeout(Number(process.env.OLLAMA_TIMEOUT_MS) || 90000),
    })
    if (!res.ok) return ''
    const d = await res.json()
    return (d.response ?? '').trim()
  } catch (e) {
    process.stderr.write(`[ISL] Ollama unavailable: ${e.message}\n`)
    return ''
  }
}

// ── Claude CLI call (subscription, no API key needed) ────────────────────────
function callClaudeCLI(prompt) {
  const isWin = process.platform === 'win32'
  return new Promise((resolve) => {
    let settled = false
    const done = (val) => { if (!settled) { settled = true; resolve(val) } }

    // spawn() does not support timeout option — use manual kill timer
    const child = spawn(isWin ? 'claude.cmd' : 'claude', ['--print', '--output-format', 'text'], {
      env: { ...process.env }, shell: isWin,
    })
    const killTimer = setTimeout(() => {
      process.stderr.write('[ISL] callClaudeCLI timed out after 60s — killing\n')
      child.kill('SIGTERM')
      done('')
    }, 60000)

    child.stdin.write(prompt, 'utf8')
    child.stdin.end()
    let out = ''
    child.stdout.on('data', d => { out += d.toString('utf8') })
    child.stderr.on('data', d => { process.stderr.write('[claude-cli] ' + d.toString('utf8')) })
    child.on('close', () => { clearTimeout(killTimer); done(out.trim()) })
    child.on('error', (e) => {
      process.stderr.write(`[ISL] callClaudeCLI spawn error: ${e.message}\n`)
      clearTimeout(killTimer); done('')
    })
  })
}

// ── Main ──────────────────────────────────────────────────────────────────────
// ── Capture → draf update tiket di ISL (Rian 2026-10-19) ──────────────────────
// Sesi kerja kantor yang berkaitan dengan tiket yang SUDAH ada → aktivitas + waktu aktif masuk ke draf
// update tiket itu di ISL (BUKAN OP; push tetap Rian). Pencocokan tiket di server ISL (cache hook basi).
// Waktu = waktu aktif per tanggal WIB (jeda > 30 mnt = istirahat), HANYA dari pesan baru sejak capture
// terakhir sesi ini — sesi God Mode bisa berhari-hari & menyentuh banyak tiket. Tanpa state: 24 jam terakhir.
const CAPTURE_GAP_MS = 30 * 60000
const CAPTURE_STATE  = `${ISL_DIR}/capture-state.json`
// alat pribadi & freelance = tanpa tiket (OP = KPI kerja kantor) — sama dengan lib/ticket-capture.ts
const PERSONAL_DIR = /[\\/](kota-kerja-src|daily-sprint-next|launcher-dashboard|emergent-contest|jagadigital|cocoland[^\\/]*|cuckoo[^\\/]*|\.claude[^\\/]*)([\\/]|$)/i

// lineTimes = timestamp pertama tiap baris transkrip (readTranscript), NaN bila tak ada
function activeSegment(lineTimes, sinceMs) {
  const times = []
  for (const t of lineTimes) if (t > sinceMs) times.push(t)
  if (times.length < 2) return null
  times.sort((a, b) => a - b)
  const byDate = {}
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1]
    if (gap <= 0 || gap > CAPTURE_GAP_MS) continue
    const date = new Date(times[i] + 7 * 3600000).toISOString().slice(0, 10)
    byDate[date] = (byDate[date] ?? 0) + gap
  }
  const logs = Object.entries(byDate).map(([date, ms]) => ({ date, mins: Math.round(ms / 60000) })).filter(l => l.mins >= 1)
  return logs.length ? { segStart: times[0], lastTs: times[times.length - 1], logs } : null
}

async function captureToDrafts({ sessionId, cwd, lineTimes, topics, ticketBinding }) {
  try {
    if (!sessionId || !process.env.KAFI_API_KEY || !topics?.length) return
    if (cwd && PERSONAL_DIR.test(cwd)) return
    let state = {}
    try { state = JSON.parse(readFileSync(CAPTURE_STATE, 'utf-8')) } catch {}
    const seg = activeSegment(lineTimes, state[sessionId] ?? Date.now() - 24 * 3600000)
    if (!seg) return
    const res = await fetch(`${ISL_URL}/api/isl/ticket-drafts/capture`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-kafi-key': process.env.KAFI_API_KEY },
      body: JSON.stringify({
        sessionId, segment: `${sessionId}@${seg.segStart}`, cwd: cwd ?? null, ticketBinding: ticketBinding ?? null,
        title: topics[0].title, bullets: topics.flatMap(t => t.bullets ?? []).slice(0, 12), logs: seg.logs,
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return   // state tak dimajukan → potongan ini ikut dikirim lagi di Stop berikutnya
    const j = await res.json().catch(() => ({}))
    state[sessionId] = seg.lastTs
    try { writeFileSync(CAPTURE_STATE, JSON.stringify(state)) } catch {}
    process.stderr.write(j.matched ? `[ISL] Draf update #${j.wpId} diperbarui (${j.how}) — review di tab Sprint.\n` : `[ISL] Capture: ${j.reason ?? 'tak cocok'}\n`)
  } catch { /* jangan pernah menghambat hook */ }
}

// Keluar RAPI (Rian 2026-10-26). Dulu tiap jalur memanggil process.exit(0) mendadak. Di Windows itu sesekali
// meledak SETELAH kerja hook selesai: "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c,
// line 76" -> exit code bukan 0 -> Claude Code menandai "Stop hook error" (terutama sesi raksasa, mis. 8.000+ pesan).
// Penyebabnya libuv yang masih menyelesaikan I/O latar (pipe stdin / socket) saat proses dirobohkan paksa.
// Sekarang: stdin ditutup begitu payload terbaca, lalu proses selesai ALAMI saat event loop kosong (diukur ±0,3-0,5 dtk);
// cadangan paksa 4 dtk (unref, tak menahan proses) hanya kalau ada yang tertinggal.
function selesai() {
  process.exitCode = 0
  try { process.stdin.destroy() } catch {}
  setTimeout(() => process.exit(0), 4000).unref()
}

async function main() {
  let payload = {}
  try {
    const raw = await new Promise(resolve => {
      let data = ''
      process.stdin.on('data', c => (data += c))
      process.stdin.on('end', () => resolve(data))
      setTimeout(() => resolve(data), 3000)
    })
    // BUG DIPERBAIKI 2026-08-19: dulu `if (raw.trim()) payload = JSON.parse(raw)` —
    // trim HANYA dipakai untuk cek truthiness, sementara JSON.parse menerima `raw` yang
    // masih mengandung BOM (U+FEFF). PowerShell 5.1 menyisipkan BOM saat pipe ke native
    // command, jadi payload dari enricher SELALU gagal di-parse, jatuh ke `catch {}`,
    // payload jadi {} dan hook keluar diam-diam di guard transcriptPath tanpa satu pun
    // pesan. Sekarang yang di-parse adalah string yang sudah dibersihkan.
    const trimmed = raw.replace(/^﻿/, '').trim()
    if (trimmed) payload = JSON.parse(trimmed)
  } catch (e) {
    process.stderr.write(`[ISL] payload stdin tidak bisa di-parse: ${e.message}\n`)
  }
  // payload sudah di tangan -> berhenti membaca pipe stdin sekarang, jauh sebelum proses berakhir (lihat selesai())
  try { process.stdin.removeAllListeners('data'); process.stdin.destroy() } catch {}

  const sessionId = payload.session_id
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
  if (!transcriptPath || !existsSync(transcriptPath)) return selesai()

  // Repeat Stop of an already-recorded session. Previously this hard-exited,
  // which FROZE long continuous sessions at their first snapshot — every later
  // turn's work (deploys, config, discussion) was silently never recorded
  // (confirmed bug, audit 2026-07-22). Now we don't skip: further down, a
  // repeat REFRESHES the existing ISL record (idempotent PATCH, preserves OP
  // linkage) WITHOUT re-pushing to OP — so no duplicate time entries — gated on
  // meaningful growth so trivial trailing turns don't re-summarize.
  const { messages, topTimes, lineTimes } = readTranscript(transcriptPath)

  // catatan hari ini: sessionId (hari pertama sesi) atau sessionId@tanggal (hari berikutnya)
  const today = wibDay(Date.now())
  let firstTs = Infinity
  for (const t of topTimes) if (t < firstTs) firstTs = t
  const recordId = sessionId && Number.isFinite(firstTs) && wibDay(firstTs) !== today ? `${sessionId}@${today}` : sessionId
  const dayStart = Date.parse(today + 'T00:00:00+07:00')
  const todayTimes = topTimes.filter(t => t >= dayStart)
  const isRepeat = !!(recordId && isAlreadyProcessed(recordId))

  // Anti-spam
  if (messages.length < 3) return selesai()
  const actualMins = activeMins(todayTimes)
  if (actualMins === null || actualMins < 2) return selesai()   // hari ini belum ada kerja berarti di sesi ini

  // Commands
  const command       = detectCommand(messages)
  const ticketBinding = detectTicketBinding(messages)

  if (command?.cmd === '!intermezzo') {
    process.stderr.write('[ISL] !intermezzo — sesi ini tidak dicatat.\n')
    return selesai()
  }

  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
  // Gate on AGGREGATE session substance, not the trailing message length.
  // The old `lastAssistant.text.length < 50` dropped a whole real session if it
  // happened to end on a short closer like "All done, deployed!" (<50 chars) —
  // especially likely given a preference for terse replies. Judge the session
  // by total assistant output instead (confirmed bug, audit 2026-07-22); the AI
  // summarizer's isSubstantial + the code heuristic (below) make the finer call.
  if (!lastAssistant) return selesai()
  const assistantChars = messages.reduce((n, m) => m.role === 'assistant' ? n + m.text.length : n, 0)
  if (assistantChars < 120) return selesai()

  // Repeat-Stop growth gate: only re-summarize/refresh if the session grew
  // meaningfully since it was last processed — otherwise every trailing turn
  // of a long session would trigger a fresh (local-LLM) summary for no new
  // content. First-time sessions (isRepeat=false) always proceed.
  // ISL_FORCE_REFRESH=1 melewati gate ini. Dipakai enricher latar (isl-enrich.ps1):
  // hook dijalankan ULANG di luar Claude Code dengan ISL_HOOK_AI=1 supaya ringkasan
  // Ollama boleh makan 40-68 detik tanpa dibunuh timeout 30s. Sesi tidak bertambah
  // panjang, jadi tanpa bypass ini enricher selalu berhenti di gate.
  const REFRESH_MIN_GROWTH = 4
  const forceRefresh = process.env.ISL_FORCE_REFRESH === '1'
  if (!forceRefresh && isRepeat && messages.length < getProcessedMsgCount(recordId) + REFRESH_MIN_GROWTH) {
    process.stderr.write(`[ISL] Session ${sessionId?.slice(0,8)} already recorded, no meaningful growth — skip.\n`)
    return selesai()
  }

  // AI summary + status determination
  const recent      = messages.slice(-14)
  const contextText = recent.map(m => `[${m.role.toUpperCase()}]: ${m.text.slice(0, 900)}`).join('\n\n')

  let taskInfo    = null
  let aiOutcome   = null    // null = ringkasan AI dipakai/tidak dicoba; 'gagal' | 'skip' (hanya relevan untuk enricher)
  const tokenUsage  = null  // CLI subscription — no token tracking

  try {
    const commandHint = command
      ? `\nUser explicitly typed "${command.cmd}" → taskStatus MUST be "${command.islStatus}".`
      : '\nNo explicit command → default taskStatus to "in_progress" unless very clear completion signal.'
    const ticketHint = ticketBinding
      ? `\nUser bound this session to OP task #${ticketBinding} via !ticket command.`
      : ''

    const prompt = `Analyze this Claude Code work session.${commandHint}${ticketHint}

SESSION:
${contextText}

Rules for isSubstantial=true:
- Actual code changes, bug fixes, deployments, infrastructure, configuration work
- At least 2+ distinct technical steps performed

Rules for isSubstantial=false (skip):
- Only conversation, Q&A, pure planning without implementation
- Failed attempts with no resolution

MULTI-TOPIC DETECTION: If this session clearly covered 2-3 DISTINCT, unrelated topics (e.g. fixed a WordPress bug AND deployed a new feature AND updated server config), split into separate topic objects. Each topic must be genuinely different — don't split sub-tasks of the same task. If in doubt: keep as 1 topic.

taskStatus rules (CONSERVATIVE):
- "done": ONLY if !done command OR very clear: "deployed", "fixed and verified", "merged", "selesai"
- "on_hold": ONLY if !hold OR clear blocker: "waiting for", "blocked by", "nanti setelah"
- "in_progress": DEFAULT — use when unsure

title: "[Project] Verb + Object" — specific, max 70 chars, English only
activities: 4-10 specific completed steps, past tense, technical detail, English only

Return ONLY valid JSON, no markdown, no extra text:
{"isSubstantial":true,"topics":[{"title":"...","activities":["step 1","..."],"taskStatus":"in_progress"}]}`

    // Phase B: otak lokal dulu (gratis), Claude CLI hanya fallback.
    // Bias ke CAPTURE: kalau lokal bilang tidak-substansial, verifikasi ke Claude —
    // false-negative dari 3B = sesi hilang senyap, lebih mahal dari 1 panggilan Claude.
    const parse = (raw) => { try { return JSON.parse((raw ?? '').match(/\{[\s\S]*\}/)?.[0] ?? '{}') } catch { return {} } }
    const validShape = (j) => typeof j.isSubstantial === 'boolean' && (!j.isSubstantial || (Array.isArray(j.topics) && j.topics.length > 0))

    // Rian 2026-08-18: ringkasan AI DILEWATI secara default di mesin ini.
    // Diukur langsung: qwen2.5:3b butuh 67,9s (dingin), 64,4s lalu 39,4s (hangat) —
    // jadi bukan cold-start, dan OLLAMA_KEEP_ALIVE tidak menolong. Hook Stop dibunuh
    // Claude Code pada 30 detik (timeout di ~/.claude/settings.json), dan POST sesi
    // terjadi SETELAH ringkasan → sesi TIDAK PERNAH tercatat sama sekali sejak
    // pertengahan tahun, tanpa jejak apa pun. Fallback heuristik di bawah
    // (extractTitle/extractBullets) selesai dalam milidetik.
    // Tujuan sekarang: laporan Nara AKURAT. Tercatat dengan judul heuristik jauh
    // lebih berguna daripada tidak tercatat dengan judul bagus.
    // Set ISL_HOOK_AI=1 kalau nanti mesinnya sudah cukup cepat.
    if (process.env.ISL_HOOK_AI !== '1') {
      process.stderr.write('[ISL] ringkasan AI dilewati (ISL_HOOK_AI != 1) — pakai heuristik agar hook selesai dalam budget\n')
      throw new Error('skip-ai')
    }
    // Rian 2026-10-27: fallback ke Claude CLI DIMATIKAN secara default (ISL_CLI_FALLBACK=1 untuk menyalakan).
    // Diukur 26-27 Okt: 15 dari 22 ringkasan jatuh ke Claude CLI — Ollama 3B butuh 75-90 dtk dan habis waktu
    // di batas 90 dtk, lalu "tidak substansial" pun diverifikasi ulang ke Claude. Akibatnya kuota Claude Rian
    // terpakai dan isi sesi kantor keluar laptop, padahal Ollama dipilih justru supaya lokal.
    // Sekarang: lokal gagal -> tidak ada ringkasan (enricher mencoba lagi nanti); lokal bilang skip -> diterima.
    const cliOk = process.env.ISL_CLI_FALLBACK === '1'
    const localRaw = await callOllama(prompt)
    let json = parse(localRaw)
    let brain = 'ollama'
    if (!validShape(json)) {
      process.stderr.write(`[ISL] lokal raw (${localRaw.length} chars): ${localRaw.slice(0, 200)}\n`)
      if (!cliOk) { aiOutcome = 'gagal'; throw new Error('local-failed') }
      json = parse(await callClaudeCLI(prompt))
      brain = 'claude-cli (lokal: output invalid)'
    } else if (json.isSubstantial === false) {
      if (cliOk) { json = parse(await callClaudeCLI(prompt)); brain = 'claude-cli (lokal bilang skip — verifikasi)' }
      else aiOutcome = 'skip'
    }
    process.stderr.write(`[ISL] summary via ${brain}\n`)
    // Durable event log (Scorecard) — awaited with a short timeout since the
    // hook process ends right after main() returns (selesai(), further down);
    // a true fire-and-forget fetch could get killed before it sends.
    try {
      await fetch(`${ISL_URL}/api/events/log`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-kafi-key': process.env.KAFI_API_KEY },
        body: JSON.stringify({ agent: 'arka', event: brain.startsWith('ollama') ? 'summary_local' : 'summary_fallback' }),
        signal: AbortSignal.timeout(3000),
      })
    } catch { /* logging is best-effort — never block the hook */ }

    if (json.isSubstantial && Array.isArray(json.topics) && json.topics.length > 0) {
      // Multi-topic: return array; single-topic: wrap in array for uniform handling
      taskInfo = json.topics
        .filter(t => t.title)
        .map(t => ({ title: t.title.slice(0, 80), bullets: (t.activities ?? []).slice(0, 8).filter(Boolean), aiStatus: t.taskStatus || 'in_progress' }))
      if (taskInfo.length === 0) taskInfo = null
    }
  } catch {}

  // enricher (ISL_FORCE_REFRESH=1) datang HANYA untuk ringkasan AI: tanpa ringkasan, jangan timpa catatan
  // yang ada dengan judul heuristik. 'gagal' -> dicoba lagi putaran berikutnya; 'skip' -> keputusan sah.
  if (forceRefresh && aiOutcome) {
    if (aiOutcome === 'gagal') {
      try {
        await fetch(`${ISL_URL}/api/events/log`, { method: 'POST', signal: AbortSignal.timeout(3000),
          headers: { 'content-type': 'application/json', 'x-kafi-key': process.env.KAFI_API_KEY },
          body: JSON.stringify({ agent: 'arka', event: 'summary_failed' }) })
      } catch {}
    }
    process.stderr.write(aiOutcome === 'gagal'
      ? '[ISL] enrich ditunda: ringkasan lokal gagal (tanpa fallback Claude) — dicoba lagi nanti\n'
      : '[ISL] enrich dilewati: lokal menilai tidak substansial\n')
    return selesai()
  }

  if (!taskInfo) {
    const allAssistant = messages.filter(m => m.role === 'assistant').map(m => m.text).join(' ')
    const hasCode = /```|\.tsx?|\.mjs|function |const |import |export |PATCH|POST|fetch\(/.test(allAssistant)
    if (!hasCode || messages.filter(m => m.role === 'assistant').length < 3) return selesai()
    // Judul dari SELURUH teks assistant (heading tersedia di sana), bullet tetap dari
    // pesan terakhir supaya isinya mencerminkan hasil akhir, bukan langkah di tengah.
    //
    // BUG DIPERBAIKI 2026-08-19: dulu `extractBullets(...) || extractParagraphBullets(...)`.
    // extractBullets SELALU me-return array, dan array kosong itu TRUTHY di JS — jadi
    // `[] || fallback` menghasilkan `[]` dan fallback paragraf TIDAK PERNAH jalan. Akibatnya
    // sesi tercatat dengan bullets kosong permanen kalau pesan terakhir tidak punya baris
    // "- " di awal baris (mis. isinya tabel atau prosa). Dua sesi asli 18 Agu terbukti
    // bullets `[]`. Sekarang cek panjangnya, bukan truthiness.
    let bullets = extractBullets(lastAssistant.text)
    if (bullets.length === 0) bullets = extractParagraphBullets(lastAssistant.text)
    if (bullets.length === 0) bullets = extractParagraphBullets(allAssistant)
    taskInfo = [{
      title:   extractTitle(allAssistant),
      bullets,
      aiStatus: 'in_progress',
    }]
  }

  // Normalize to array
  const topics = Array.isArray(taskInfo) ? taskInfo : [taskInfo]

  const hasExplicitCmd = !!command || !!ticketBinding
  const needsValidation = !hasExplicitCmd
  const opMode = getOPMode()

  // ── Repeat Stop: refresh-only, NO OP push ─────────────────────────────────
  // The session was already pushed to OP on its first Stop. Re-running autoPush
  // here would post duplicate OP time entries (inflated hours). Instead refresh
  // the PRIMARY session record (original sessionId) with the latest summary via
  // a partial PATCH that preserves opTaskId/pushStatus — so the Hub reflects the
  // full session while OP stays correct. Secondary topics aren't re-split on a
  // repeat (avoids orphan -t{n} records); the primary refresh is the strict win
  // over the old freeze-at-first-snapshot behavior.
  if (isRepeat) {
    const primary = topics[0]
    const ok = await refreshSessionRecord(recordId, {
      title:      primary.title,
      bullets:    primary.bullets,
      actualMins,
      taskStatus: command ? command.islStatus : primary.aiStatus,
    })
    process.stderr.write(`[ISL] Session ${recordId?.slice(0,8)}${recordId !== sessionId ? ' @' + today : ''} di-refresh (repeat, ${messages.length} msg)${ok ? '' : ' — refresh gagal, retry Stop berikutnya'}\n`)
    await captureToDrafts({ sessionId, cwd: payload.cwd, lineTimes, topics, ticketBinding })
    if (recordId) markProcessed(recordId, messages.length)
    return selesai()
  }

  const userId = await resolveUserId(opMode)

  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i]
    const finalStatus = command ? command.islStatus : topic.aiStatus
    // Topic 1 uses original sessionId (replaces live session), topics 2+ get unique suffix
    const topicSessionId = i === 0 ? recordId : `${recordId}-t${i + 1}`
    await autoPush({ sessionId: topicSessionId, actualMins: i === 0 ? actualMins : null, userId, finalStatus, hasExplicitCmd, needsValidation, ticketBinding: i === 0 ? ticketBinding : null, tokenUsage: i === 0 ? tokenUsage : null, title: topic.title, bullets: topic.bullets, aiStatus: topic.aiStatus })
  }
  await captureToDrafts({ sessionId, cwd: payload.cwd, lineTimes, topics, ticketBinding })
  if (recordId) markProcessed(recordId, messages.length)
  return selesai()
}

// ── KPI-aware task time estimation ───────────────────────────────────────────
// Min 40h / max 60h per sprint. Per-task: easy=60m, medium=120m, complex=240m
function estimateTaskMins(title, bullets) {
  const text = (title + ' ' + bullets.join(' ')).toLowerCase()
  const complexSignals = ['docker', 'nginx', 'apache', 'ssl', 'deploy', 'infra', 'vps', 'ssh', 'server setup',
    'migration', 'database', 'wordpress setup', 'wp setup', 'multi-site', 'multisite', 'oauth', 'auth system',
    'ci/cd', 'pipeline', 'security', 'forensic', 'scan', 'backup automation']
  const mediumSignals  = ['refactor', 'component', 'feature', 'integration', 'api', 'endpoint', 'hook',
    'modal', 'form', 'page', 'view', 'dashboard', 'chart', 'config update', 'multi-step', 'multiple files']
  const complexCount = complexSignals.filter(s => text.includes(s)).length
  const mediumCount  = mediumSignals.filter(s => text.includes(s)).length
  if (complexCount >= 1 || bullets.length >= 6) return 240
  if (mediumCount >= 2 || bullets.length >= 4)  return 120
  return 60
}

// ── Auto Push ─────────────────────────────────────────────────────────────────
async function autoPush({ sessionId, title, bullets, actualMins, aiStatus, userId, finalStatus, hasExplicitCmd, needsValidation, ticketBinding, tokenUsage }) {
  // Guard: title is required — without it OP subject would be empty
  if (!title || !title.trim()) {
    process.stderr.write('[ISL] autoPush skipped — title is empty\n')
    return
  }
  const date         = new Date().toISOString().split('T')[0]
  const opMode       = getOPMode()
  const sprint       = getCurrentSprint()
  const versionId    = sprint?.id ?? null
  const durationMins = actualMins ?? 30
  const statusLabel  = STATUS_LABELS[finalStatus] ?? '🔄 In Progress'

  let taskId     = null
  let isNewTask  = false
  let relatedOldId = null
  // Whether the OP worklog (time entry) actually landed. If it fails, the
  // session must NOT be reported as a clean silent 'pushed' — flag it
  // needsValidation so it stays visible (confirmed bug, audit 2026-07-22:
  // OP down -> time entry swallowed -> ISL showed 'pushed' with no OP record).
  let opWriteOk  = true

  // Rian 2026-08-18: AI TIDAK BOLEH menulis ke OpenProject atas inisiatifnya sendiri.
  // Sebelumnya blok ini jalan tanpa syarat: AI mencocokkan task, lalu menulis activity
  // comment + time entry ke OP — bahkan membuat task baru — tanpa persetujuan Rian.
  // `hasExplicitCmd` hanya memengaruhi LABEL pushStatus, bukan apakah OP ditulis.
  // Sekarang OP hanya ditulis kalau Rian memerintahkan eksplisit (command / !ticket:ID),
  // atau kalau ISL_AUTO_PUSH_OP=1 di-set dengan sengaja.
  // Kalau tidak diizinkan: taskId tetap null → pushStatus 'hub' → masuk Daily Hub untuk
  // di-triage Rian, dan needsValidation true. Nol tulisan ke OP.
  // Efek samping yang menguntungkan: semua round-trip OP hilang dari jalur default,
  // jadi hook jauh lebih cepat dan muat di budget 30 detik.
  //
  // Rian 2026-10-16 (keputusan final): hook TIDAK PERNAH menulis ke OP, termasuk dengan
  // command / !ticket:ID. OP = laporan final; satu-satunya pintu = push ISL (Push Queue)
  // saat sesi sudah "ready". !ticket:ID kini hanya mengikat sesi ke tiket DI ISL
  // (opTaskId terisi -> tujuan sudah terpilih di Push Queue). Blok OP di bawah sengaja mati.
  const opWriteAllowed = false
  process.stderr.write(hasExplicitCmd
    ? `[ISL] OP tidak disentuh (keputusan 16 Okt). Sesi masuk Push Queue${ticketBinding ? ` terikat ke #${ticketBinding}` : ''}.\n`
    : '[ISL] OP tidak disentuh. Sesi masuk Daily Hub untuk triage.\n')
  if (OP_API_TOKEN && OP_BASE_URL && opWriteAllowed) {
    // Determine which task to use — priority: !ticket:ID > matching > new
    let existingTask = null

    if (ticketBinding) {
      // Direct binding — fetch fresh from OP to determine type
      let boundWP = null
      try {
        const res = await opGet(`/api/v3/work_packages/${ticketBinding}`)
        if (res.ok) boundWP = await res.json()
      } catch {}
      if (!boundWP) boundWP = findTaskById(ticketBinding)

      const wpType = boundWP?._links?.type?.title ?? boundWP?.type ?? ''
      const isStory = /user.?story|story|feature/i.test(wpType)

      if (isStory && boundWP) {
        // !ticket:StoryID → create new child task under this story
        process.stderr.write(`[ISL] !ticket:${ticketBinding} is a User Story — creating child task.\n`)

        // Prefer actual session duration over keyword-based estimate
        // A long discussion/iteration session is far more accurate than complexity signals
        const estimatedMins = actualMins ?? estimateTaskMins(title, bullets)
        const estimatedISO  = `PT${estimatedMins}M`
        const sprintVersion = versionId
          ? { _links: { version: { href: `/api/v3/versions/${versionId}` } } }
          : {}

        const newWP = {
          subject:     title,
          description: { format: 'markdown', raw: buildTaskDescription(title, bullets, date, null) },
          estimatedTime: estimatedISO,
          ...sprintVersion,
          _links: {
            type:    { href: '/api/v3/types/1' },  // Task type
            status:  { href: OP_STATUS_HREF[finalStatus] ?? OP_STATUS_HREF.in_progress },
            parent:  { href: `/api/v3/work_packages/${ticketBinding}` },
            project: boundWP._links?.project ?? { href: `/api/v3/projects/${boundWP.projectId ?? 1}` },
            assignee: { href: `/api/v3/users/${userId}` },
          },
        }

        try {
          const createRes = await opPost('/api/v3/work_packages', newWP)
          if (createRes.ok) {
            const created = await createRes.json()
            if (created.id) {
              taskId    = created.id
              isNewTask = true
              process.stderr.write(`[ISL] Created child task #${taskId} under Story #${ticketBinding}.\n`)
            } else {
              process.stderr.write(`[ISL] OP returned no ID for new task — response: ${JSON.stringify(created).slice(0,200)}\n`)
            }
          } else {
            const errText = await createRes.text().catch(() => '?')
            process.stderr.write(`[ISL] Failed to create child task (${createRes.status}): ${errText.slice(0,200)}\n`)
          }
        } catch (e) {
          process.stderr.write(`[ISL] Failed to create child task: ${e.message}\n`)
        }
      } else {
        // !ticket:TaskID → log to existing task
        existingTask = boundWP
      }
    } else {
      // Kick off the correction lookup alongside the (synchronous, instant)
      // keyword match — no real parallelism gain since findMatchingTask never
      // yields, but keeps the fetch call issued before the match decision per
      // the correction-loop design (avoid repeating a mismatch already fixed).
      const correctionsPromise = fetchCorrections(title, bullets)
      existingTask = findMatchingTask(title, bullets)

      const corrections = await correctionsPromise
      if (existingTask && corrections.length) {
        const relevant = corrections.find(c => c.distance < CORRECTION_OVERRIDE_MAX_DISTANCE)
        if (relevant) {
          const { wrongId } = parseCorrectionTaskIds(relevant.chunk)
          if (wrongId === existingTask.id) {
            process.stderr.write(`[ISL] Arka correction loop: avoided repeat mismatch to task #${wrongId}\n`)
            existingTask = null
          }
        }
      }
    }

    // Check if there's a related OLD task (for reference in new task description)
    if (!existingTask && !taskId) {
      const related = findRelatedOldTask(title, bullets)
      if (related) relatedOldId = related.id
    }

    const activityMd = buildActivityMarkdown(title, bullets, actualMins, sessionId, date, statusLabel, tokenUsage, relatedOldId)

    if (taskId && isNewTask) {
      // New child task created — add activity log + time entry
      try {
        await opPost(`/api/v3/work_packages/${taskId}/activities`, { comment: { format: 'markdown', raw: activityMd } })
      } catch {}
      const durLabel = actualMins
        ? (actualMins >= 60 ? `${Math.floor(actualMins/60)}j ${actualMins%60}m` : `${actualMins}m`)
        : `${durationMins}m (est)`
      {
        const teRes = await opPost('/api/v3/time_entries', {
          hours: `PT${durationMins}M`, spentOn: date,
          comment: { format: 'markdown', raw: `**${title}**\n\n⏱ ${durLabel} | ${statusLabel} | 🤖 ISL` },
          _links: { workPackage: { href: `/api/v3/work_packages/${taskId}` }, activity: { href: '/api/v3/time_entries/activities/1' } },
        }).catch(() => null)
        if (!teRes || !teRes.ok) { opWriteOk = false; process.stderr.write(`[ISL] time_entry GAGAL di OP #${taskId}${teRes ? ` (HTTP ${teRes.status})` : ' (network)'} — sesi ditandai perlu validasi\n`) }
      }
    } else if (existingTask) {
      // Existing task — log activity comment + time entry
      taskId = existingTask.id
      try {
        await opPost(`/api/v3/work_packages/${taskId}/activities`, { comment: { format: 'markdown', raw: activityMd } })
      } catch {}
      const durLabel = actualMins
        ? (actualMins >= 60 ? `${Math.floor(actualMins/60)}j ${actualMins%60}m` : `${actualMins}m`)
        : `${durationMins}m (est)`
      {
        const teRes = await opPost('/api/v3/time_entries', {
          hours: `PT${durationMins}M`, spentOn: date,
          comment: { format: 'markdown', raw: `**${title}**\n\n⏱ ${durLabel} | ${statusLabel} | 🤖 ISL` },
          _links: { workPackage: { href: `/api/v3/work_packages/${taskId}` }, activity: { href: '/api/v3/time_entries/activities/1' } },
        }).catch(() => null)
        if (!teRes || !teRes.ok) { opWriteOk = false; process.stderr.write(`[ISL] time_entry GAGAL di OP #${taskId}${teRes ? ` (HTTP ${teRes.status})` : ' (network)'} — sesi ditandai perlu validasi\n`) }
      }
      // If actual duration significantly exceeds current estimate → bump estimatedTime
      if (actualMins) {
        try {
          const wpRes = await opGet(`/api/v3/work_packages/${taskId}`)
          if (wpRes.ok) {
            const wp = await wpRes.json()
            const currentEstISO = wp.estimatedTime ?? 'PT0M'
            const currentEstMins = (() => {
              const m = currentEstISO.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/)
              return m ? (Number(m[1]??0)*24*60 + Number(m[2]??0)*60 + Number(m[3]??0)) : 0
            })()
            if (actualMins > currentEstMins * 1.2) {
              // Actual > 120% of estimate → update to actual
              await opPatch(`/api/v3/work_packages/${taskId}`, {
                lockVersion: wp.lockVersion,
                estimatedTime: `PT${actualMins}M`,
              }).catch(() => {})
              process.stderr.write(`[ISL] Updated estimatedTime on #${taskId}: ${currentEstMins}m → ${actualMins}m\n`)
            }
          }
        } catch {}
      }
    } else {
      // No match — save to Daily Hub for triage
      process.stderr.write(`[ISL] No matching OP task found — saved to Daily Hub.\n`)
      isNewTask = false
    }

    // Append to task memory file
    if (taskId) await appendTaskMemory(taskId, title, bullets, date, actualMins, sessionId)

    // Sync parent User Story estimatedTime = sum of all child task estimates
    // This keeps the US as an accurate container of actual work done
    if (taskId) {
      try {
        const taskRes = await opGet(`/api/v3/work_packages/${taskId}`)
        if (taskRes.ok) {
          const task = await taskRes.json()
          const parentHref = task._links?.parent?.href
          if (parentHref) {
            const parentId = parentHref.split('/').pop()
            const parentRes = await opGet(`/api/v3/work_packages/${parentId}`)
            if (parentRes.ok) {
              const parent = await parentRes.json()
              const parentType = parent._links?.type?.title ?? ''
              // Only sync if parent is a User Story (not Epic — Epic spans multiple sprints)
              if (/user.?story|story/i.test(parentType)) {
                const childrenRes = await opGet(`/api/v3/work_packages?filters=${encodeURIComponent(JSON.stringify([{parent:{operator:'=',values:[parentId]}}]))}&pageSize=100`)
                if (childrenRes.ok) {
                  const children = (await childrenRes.json())._embedded?.elements ?? []
                  const parseISO = iso => {
                    if (!iso) return 0
                    const m = iso.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/)
                    return m ? (Number(m[1]??0)*24*60 + Number(m[2]??0)*60 + Number(m[3]??0)) : 0
                  }
                  const totalMins = children
                    .filter(c => !/rejected|abandoned/i.test(c._links?.status?.title ?? ''))
                    .reduce((sum, c) => sum + parseISO(c.estimatedTime), 0)
                  if (totalMins > 0) {
                    await opPatch(`/api/v3/work_packages/${parentId}`, {
                      lockVersion: parent.lockVersion,
                      estimatedTime: `PT${totalMins}M`,
                    }).catch(() => {})
                    process.stderr.write(`[ISL] Synced US #${parentId} estimatedTime → ${Math.round(totalMins/60*10)/10}h (sum of ${children.length} tasks)\n`)
                  }
                }
              }
            }
          }
        }
      } catch {}
    }
  }

  // Save to ISL — prefer OP task's actual parent as storyId over keyword guessing
  let storyId = null
  if (taskId) {
    // Look up the matched/created task in cache to find its parent (User Story)
    try {
      const cache = JSON.parse(readFileSync(`${ISL_DIR}/op-cache.json`, 'utf-8'))
      const allWPs = [...(cache.myOpenTasks ?? []), ...(cache.myClosedTasks ?? []),
                     ...(cache.userStories ?? []), ...(cache.epics ?? [])]
      const cachedTask = allWPs.find(t => t.id === taskId)
      const parentId = cachedTask?.userStoryId ?? cachedTask?.parentId ?? null
      if (parentId) storyId = parentId
    } catch {}
  }
  if (!storyId && opMode.stories) storyId = pickStory(title, bullets, opMode.stories)
  const tokenSummary = tokenUsage
    ? { inputTokens: tokenUsage.input_tokens ?? 0, outputTokens: tokenUsage.output_tokens ?? 0 }
    : null

  // x-kafi-key: machine auth — sejak ISL_MULTIUSER=1, POST tanpa session browser kena 401
  await postDurable('/api/isl/sessions', {
    sessionId, title, bullets,
    source: 'kafi',  // captured by Claude Code hook (external to ISL)
    estimatedMins: durationMins, actualMins,
    isNewTask, taskStatus: finalStatus,
    // 'pushed' = logged to existing OP task. 'pending' = user approved via Push Queue. 'hub' = no OP match, needs triage in Daily Hub.
    pushStatus: taskId ? 'pushed' : (hasExplicitCmd ? 'pending' : 'hub'),
    // Force validation if the OP worklog write failed — don't let a failed
    // time entry masquerade as a clean push.
    needsValidation: taskId ? (needsValidation || !opWriteOk) : true,
    hasExplicitCmd, aiStatus,
    // !ticket:ID -> tujuan push sudah terpilih di ISL (bukan ditulis ke OP)
    opTaskId: taskId ?? ticketBinding ?? null, opStoryId: storyId, autoPushed: !!taskId,
    tokenUsage: tokenSummary,
    relatedOldTaskId: relatedOldId,
    ticketBinding,
  }, { 'content-type': 'application/json', 'x-kafi-key': process.env.KAFI_API_KEY })

  // Append to Daily Log. x-kafi-key: per-user captureKey (teammate's own hook) atau
  // default global (owner) — menentukan atribusi.
  //
  // Dulu ini "fire and forget": fetch tanpa await + catch kosong. Panggilan
  // /api/isl/sessions di atas di-await lewat postDurable, makanya sessions terisi
  // sementara daily_logs BERHENTI SEJAK 3 JULI 2026 tanpa ada yang tahu — request-nya
  // ditinggal saat proses hook keluar. Sekarang pakai postDurable yang sama:
  // di-await, dan kegagalan diantre untuk dikirim ulang oleh hook berikutnya.
  const logDate = new Date().toISOString().slice(0, 10)
  await postDurable('/api/daily-log/append',
    { title, bullets, date: logDate, sessionId },
    { 'content-type': 'application/json', 'x-kafi-key': process.env.KAFI_API_KEY })

  // Email notification jika needsValidation
  if (needsValidation && taskId) {
    fetch(`${ISL_URL}/api/notify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-kafi-key': process.env.KAFI_API_KEY },
      body: JSON.stringify({
        type: 'validation_needed',
        data: { title, taskId, sessionId, aiStatus, actualMins },
      }),
    }).catch(() => {})
  }
}

// ── Text fallbacks ────────────────────────────────────────────────────────────
// Rian 2026-08-18: dipanggil dengan SELURUH teks assistant sesi, bukan hanya pesan
// terakhir. Dulu judulnya diambil dari `lastAssistant.text` saja, jadi kalau pesan
// penutup kebetulan prosa pendek, judulnya jadi potongan prosa itu — contoh nyata:
// "Sekarang gw punya semua yang gw butuh. D..." padahal sesi itu soal perbaikan hook.
// Pelajaran yang SAMA sudah dicatat di file ini untuk guard assistantChars ("judge the
// session by total assistant output"), hanya belum diterapkan ke ekstraksi judul.
//
// Prioritas: heading terakhir (kesimpulan sesi lebih deskriptif daripada pembuka) >
// heading pertama > baris pertama yang layak.
function extractTitle(text) {
  const lines    = text.split('\n').map(l => l.trim()).filter(l => l.length > 10 && l.length < 80)
  const headings = lines.filter(l => /^#{1,3}\s/.test(l))
  const pick     = headings[headings.length - 1] ?? headings[0]
  if (pick) return pick.replace(/^#+\s*/, '').replace(/[*`]/g, '').slice(0, 70)
  return lines[0]?.slice(0, 70) || 'Work Session'
}
function extractBullets(text) {
  return (text.match(/^[-*•]\s+.+/gm) ?? []).slice(0, 6).map(b => b.replace(/^[-*•]\s+/, '').slice(0, 120))
}
function extractParagraphBullets(text) {
  return text.split('\n').map(l => l.trim())
    .filter(l => l.length > 20 && l.length < 120 && !l.startsWith('#') && !l.startsWith('`'))
    .slice(0, 4)
}

main()
  .then(async () => {
    // Regenerate CLAUDE.md setelah session selesai (non-blocking).
    // 2026-10-26: blok ini TAK PERNAH jalan selama main() berakhir dengan process.exit(0). Sekarang main() selesai normal,
    // jadi supaya perilaku tidak berubah diam-diam (npm baru tiap akhir prompt = CPU/RAM), hanya jalan bila ISL_HOOK_CONTEXT=1.
    if (process.env.ISL_HOOK_CONTEXT !== '1') return
    const { spawn } = await import('child_process')
    const { fileURLToPath } = await import('url')
    const rootDir = fileURLToPath(new URL('../', import.meta.url))
    spawn('npm', ['run', 'context'], { cwd: rootDir, stdio: 'ignore', detached: true }).unref()
  })
  .catch(() => selesai())
