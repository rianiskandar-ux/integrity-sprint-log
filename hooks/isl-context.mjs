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

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync } from 'fs'
import { join }    from 'path'
import { homedir } from 'os'

const ISL_URL           = process.env.ISL_URL    || 'http://localhost:3000'
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const OP_BASE_URL       = process.env.OP_BASE_URL || 'https://tokek.integrity-asia.com'
const OP_API_TOKEN      = process.env.OP_API_TOKEN
const ISL_DIR           = process.env.ISL_DIR || process.env.CACHE_DATA_DIR || process.cwd()
const MEMORY_DIR        = `${ISL_DIR}/memory`

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

    const openTasks   = (cache.myOpenTasks   ?? []).filter(t => t.islStatus !== 'abandoned' && t.islStatus !== 'rejected')
    const closedTasks = (cache.myClosedTasks ?? []).filter(t => (t.updatedAt ?? '').slice(0, 10) >= cutoff)
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
      const score    = keywords.filter(kw => taskText.includes(kw)).length
      const minScore = Math.min(2, Math.ceil(keywords.length * 0.2))
      if (score >= minScore && score > bestScore) { bestScore = score; best = task }
    }
    return best
  } catch { return null }
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

    // Only look at tasks closed BEFORE current sprint
    const oldClosed = (cache.myClosedTasks ?? []).filter(t => (t.updatedAt ?? '').slice(0, 10) < cutoff)
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

function appendTaskMemory(taskId, title, bullets, date, actualMins, sessionId) {
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
function getActualDurationMins(rawLines) {
  const times = []
  for (const line of rawLines) {
    try {
      const entry = JSON.parse(line)
      const ts    = entry.timestamp ?? entry.createdAt
      if (ts) times.push(new Date(ts).getTime())
    } catch {}
  }
  if (times.length < 2) return null
  return Math.max(1, Math.round((Math.max(...times) - Math.min(...times)) / 60000))
}

// ── OP API helpers ────────────────────────────────────────────────────────────
function opHeaders() {
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

function markProcessed(sessionId) {
  try {
    let data = { sessions: [] }
    try { data = JSON.parse(readFileSync(PROCESSED_FILE, 'utf-8')) } catch {}
    const sessions = (data.sessions ?? [])
    if (!sessions.includes(sessionId)) {
      sessions.push(sessionId)
      // Keep last 500 sessions only
      writeFileSync(PROCESSED_FILE, JSON.stringify({ sessions: sessions.slice(-500) }, null, 2))
    }
  } catch {}
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  let payload = {}
  try {
    const raw = await new Promise(resolve => {
      let data = ''
      process.stdin.on('data', c => (data += c))
      process.stdin.on('end', () => resolve(data))
      setTimeout(() => resolve(data), 3000)
    })
    if (raw.trim()) payload = JSON.parse(raw)
  } catch {}

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
  if (!transcriptPath || !existsSync(transcriptPath)) process.exit(0)

  // Skip if already processed — prevents double-logging same session
  if (sessionId && isAlreadyProcessed(sessionId)) {
    process.stderr.write(`[ISL] Session ${sessionId?.slice(0,8)} already processed — skip.\n`)
    process.exit(0)
  }

  const rawLines = readFileSync(transcriptPath, 'utf-8').trim().split('\n')
  const messages = []
  for (const line of rawLines) {
    try {
      const entry = JSON.parse(line)
      if (entry.type !== 'user' && entry.type !== 'assistant') continue
      const raw  = entry.message?.content ?? ''
      const text = typeof raw === 'string' ? raw
        : Array.isArray(raw) ? raw.filter(b => b.type === 'text').map(b => b.text).join('\n') : ''
      if (text.length > 10) messages.push({ role: entry.type, text })
    } catch {}
  }

  // Anti-spam
  if (messages.length < 3) process.exit(0)
  const actualMins = getActualDurationMins(rawLines)
  if (actualMins !== null && actualMins < 2) process.exit(0)

  // Commands
  const command       = detectCommand(messages)
  const ticketBinding = detectTicketBinding(messages)

  if (command?.cmd === '!intermezzo') {
    process.stderr.write('[ISL] !intermezzo — sesi ini tidak dicatat.\n')
    process.exit(0)
  }

  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
  if (!lastAssistant || lastAssistant.text.length < 50) process.exit(0)

  // AI summary + status determination
  const recent      = messages.slice(-14)
  const contextText = recent.map(m => `[${m.role.toUpperCase()}]: ${m.text.slice(0, 900)}`).join('\n\n')

  let taskInfo    = null
  let tokenUsage  = null

  if (ANTHROPIC_API_KEY) {
    try {
      const commandHint = command
        ? `\nUser explicitly typed "${command.cmd}" → taskStatus MUST be "${command.islStatus}".`
        : '\nNo explicit command → default taskStatus to "in_progress" unless very clear completion signal.'
      const ticketHint = ticketBinding
        ? `\nUser bound this session to OP task #${ticketBinding} via !ticket command.`
        : ''

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 900,
          messages: [{
            role: 'user',
            content: `Analyze this Claude Code work session.${commandHint}${ticketHint}

SESSION:
${contextText}

Rules for isSubstantial=true:
- Actual code changes, bug fixes, deployments, infrastructure, configuration work
- At least 2+ distinct technical steps performed

Rules for isSubstantial=false (skip):
- Only conversation, Q&A, pure planning without implementation
- Failed attempts with no resolution

taskStatus rules (CONSERVATIVE):
- "done": ONLY if !done command OR very clear: "deployed", "fixed and verified", "merged", "selesai"
- "on_hold": ONLY if !hold OR clear blocker: "waiting for", "blocked by", "nanti setelah"
- "in_progress": DEFAULT — use when unsure

title: "[Project] Verb + Object" — specific, max 70 chars
activities: 4-10 specific completed steps, past tense, technical detail

Return ONLY valid JSON:
{"title":"...","activities":["step 1","..."],"isSubstantial":true,"taskStatus":"in_progress"}`,
          }],
        }),
      })

      if (res.ok) {
        const data = await res.json()
        tokenUsage = data.usage ?? null
        const json = JSON.parse((data.content?.[0]?.text ?? '').match(/\{[\s\S]*\}/)?.[0] ?? '{}')
        if (json.isSubstantial && json.title) {
          taskInfo = { title: json.title.slice(0, 80), bullets: (json.activities ?? []).slice(0, 8).filter(Boolean), aiStatus: json.taskStatus || 'in_progress' }
        }
      }
    } catch {}
  }

  if (!taskInfo) {
    const allAssistant = messages.filter(m => m.role === 'assistant').map(m => m.text).join(' ')
    const hasCode = /```|\.tsx?|\.mjs|function |const |import |export |PATCH|POST|fetch\(/.test(allAssistant)
    if (!hasCode || messages.filter(m => m.role === 'assistant').length < 3) process.exit(0)
    taskInfo = { title: extractTitle(lastAssistant.text), bullets: extractBullets(lastAssistant.text) || extractParagraphBullets(lastAssistant.text), aiStatus: 'in_progress' }
  }

  const finalStatus    = command ? command.islStatus : taskInfo.aiStatus
  const hasExplicitCmd = !!command || !!ticketBinding
  const needsValidation = !hasExplicitCmd

  const opMode = getOPMode()
  const userId = await resolveUserId(opMode)

  await autoPush({ sessionId, actualMins, userId, finalStatus, hasExplicitCmd, needsValidation, ticketBinding, tokenUsage, ...taskInfo })
  if (sessionId) markProcessed(sessionId)
  process.exit(0)
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
  const date         = new Date().toISOString().split('T')[0]
  const opMode       = getOPMode()
  const sprint       = getCurrentSprint()
  const versionId    = sprint?.id ?? null
  const durationMins = actualMins ?? 30
  const statusLabel  = STATUS_LABELS[finalStatus] ?? '🔄 In Progress'

  let taskId     = null
  let isNewTask  = false
  let relatedOldId = null

  if (OP_API_TOKEN && OP_BASE_URL) {
    // Determine which task to use — priority: !ticket:ID > matching > new
    let existingTask = null

    if (ticketBinding) {
      // Direct binding — fetch fresh from OP
      try {
        const res = await opGet(`/api/v3/work_packages/${ticketBinding}`)
        if (res.ok) existingTask = await res.json()
      } catch {}
      if (!existingTask) existingTask = findTaskById(ticketBinding)
    } else {
      existingTask = findMatchingTask(title, bullets)
    }

    // Check if there's a related OLD task (for reference in new task description)
    if (!existingTask) {
      const related = findRelatedOldTask(title, bullets)
      if (related) relatedOldId = related.id
    }

    const activityMd = buildActivityMarkdown(title, bullets, actualMins, sessionId, date, statusLabel, tokenUsage, relatedOldId)

    if (existingTask) {
      // Found matching task — log activity comment to OP (read-only update, no status change)
      taskId = existingTask.id
      try {
        await opPost(`/api/v3/work_packages/${taskId}/activities`, { comment: { format: 'markdown', raw: activityMd } })
      } catch {}
      // Time entry on existing task
      const durLabel = actualMins
        ? (actualMins >= 60 ? `${Math.floor(actualMins/60)}j ${actualMins%60}m` : `${actualMins}m`)
        : `${durationMins}m (est)`
      await opPost('/api/v3/time_entries', {
        hours: `PT${durationMins}M`, spentOn: date,
        comment: { format: 'markdown', raw: `**${title}**\n\n⏱ ${durLabel} | ${statusLabel} | 🤖 ISL` },
        _links: { workPackage: { href: `/api/v3/work_packages/${taskId}` }, activity: { href: '/api/v3/time_entries/activities/1' } },
      }).catch(() => {})
    } else {
      // No matching task — save to ISL only, user decides whether to create/link in OP
      process.stderr.write(`[ISL] No matching OP task found — saved to ISL pending. Use !ticket:ID to link or push manually via ISL.\n`)
      isNewTask = false  // not creating in OP — user must approve
    }

    // Append to task memory file
    if (taskId) appendTaskMemory(taskId, title, bullets, date, actualMins, sessionId)
  }

  // Save to ISL
  const storyId = opMode.stories ? pickStory(title, bullets, opMode.stories) : null
  const tokenSummary = tokenUsage
    ? { inputTokens: tokenUsage.input_tokens ?? 0, outputTokens: tokenUsage.output_tokens ?? 0 }
    : null

  try {
    await fetch(`${ISL_URL}/api/isl/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId, title, bullets,
        estimatedMins: durationMins, actualMins,
        isNewTask, taskStatus: finalStatus,
        // 'pushed' = logged to existing OP task. 'pending' = no OP task linked yet, user must approve.
        pushStatus: taskId ? 'pushed' : 'pending',
        needsValidation: taskId ? needsValidation : true,
        hasExplicitCmd, aiStatus,
        opTaskId: taskId, opStoryId: storyId, autoPushed: !!taskId,
        tokenUsage: tokenSummary,
        relatedOldTaskId: relatedOldId,
        ticketBinding,
      }),
    })
  } catch {}

  // Email notification jika needsValidation
  if (needsValidation && taskId) {
    fetch(`${ISL_URL}/api/notify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'validation_needed',
        data: { title, taskId, sessionId, aiStatus, actualMins },
      }),
    }).catch(() => {})
  }
}

// ── Text fallbacks ────────────────────────────────────────────────────────────
function extractTitle(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 10 && l.length < 80)
  const h = lines.find(l => /^#{1,3}\s/.test(l))
  if (h) return h.replace(/^#+\s*/, '').slice(0, 70)
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

main().catch(() => process.exit(0))
