#!/usr/bin/env node
/**
 * Git-based auto-capture (Phase 1 — owner machine, local repos).
 *
 * Turns each day's git commits into an ISL work session, so work is logged
 * even when the Claude Code Stop hook never fires (long/continuous sessions —
 * the exact gap that lost 3 days of work on 2026-07-12). Deterministic: reads
 * committed history, no fragile transcript parsing.
 *
 * Idempotent: one session per (repo, date), upserted by a stable sessionId, so
 * running it every few hours just refreshes today's session with new commits —
 * no duplicates, no state file needed for correctness. A --since window (default
 * 2 days) re-scans recent days so commits made after the last run (incl. across
 * midnight) are still picked up.
 *
 * Owner-only signal source. Teammates are Phase 2 (ISL reads GitHub API centrally
 * by author — no per-machine agent), which is why this posts with the machine
 * key (owner uid) rather than trying to attribute per-author here.
 *
 * Usage:
 *   node scripts/isl-git-capture.mjs            # capture -> ISL
 *   node scripts/isl-git-capture.mjs --dry-run  # print what it would post
 */
import { execSync } from 'child_process'
import { existsSync, appendFileSync } from 'fs'

const ISL_URL  = process.env.ISL_URL      || 'http://localhost:4891'
const KAFI_KEY = process.env.KAFI_API_KEY
const SINCE_DAYS = Number(process.env.GIT_CAPTURE_SINCE_DAYS || 2)
const DRY = process.argv.includes('--dry-run')

// Run log — so a scheduled run is never invisible. Task Scheduler swallows
// stdout; without this, a silent failure (bad key, ISL down, battery-refused
// task) left zero trace. One line per run, checked by nobody-until-needed but
// there when a "why is the Hub blank?" question comes up. Best-effort.
const LOG_FILE = 'C:/Users/user199/ai-apps/daily-sprint-next/git-capture.log'
function logRun(line) {
  try { appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${line}\n`) } catch { /* logging must never break capture */ }
}

// Repos to scan (owner's local working copies). Add more as needed.
const REPOS = [
  { name: 'ISL',         path: 'C:/Users/user199/ai-apps/daily-sprint-next' },
  { name: 'Launcher',    path: 'C:/Users/user199/ai-apps/launcher-dashboard' },
  { name: 'PhoenixWeb',  path: 'C:/Users/user199/ai-apps/phoenix-web' },
]

// Only the owner's own commits — match on committer email so a shared repo with
// other authors doesn't pull their commits into the owner's ISL.
const AUTHOR = process.env.GIT_CAPTURE_AUTHOR || 'rian.iskandar@integrity-indonesia.com'

function git(repo, args) {
  return execSync(`git -C "${repo}" ${args}`, { encoding: 'utf8', timeout: 15000 })
}

async function post(session) {
  if (DRY) { console.log('WOULD POST:', JSON.stringify(session, null, 2)); return true }
  try {
    const r = await fetch(`${ISL_URL}/api/isl/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-kafi-key': KAFI_KEY },
      body: JSON.stringify(session),
    })
    if (!r.ok) { console.error(`POST failed ${r.status} for ${session.title}`); return false }
    return true
  } catch (e) { console.error('POST error:', e.message); return false }
}

const sinceIso = new Date(Date.now() - SINCE_DAYS * 864e5).toISOString().slice(0, 10)
let posted = 0

for (const repo of REPOS) {
  if (!existsSync(repo.path)) { console.warn(`skip ${repo.name}: path missing`); continue }
  let raw
  try {
    // %ad=author date (short), %H=sha, %s=subject. Author-filtered, since window.
    raw = git(repo.path, `log --since="${sinceIso}" --author="${AUTHOR}" --date=short --pretty=format:"%ad%x09%h%x09%s"`)
  } catch (e) { console.warn(`skip ${repo.name}: ${e.message}`); continue }
  if (!raw.trim()) continue

  // Group commits by date
  const byDate = {}
  for (const line of raw.split('\n')) {
    const [date, sha, ...rest] = line.split('\t')
    if (!date) continue
    ;(byDate[date] ??= []).push({ sha, subject: rest.join('\t') })
  }

  for (const [date, commits] of Object.entries(byDate)) {
    const bullets = commits.map(c => `${c.subject} (${c.sha})`)
    const session = {
      sessionId:     `gitcap-${repo.name.toLowerCase()}-${date}`,  // stable -> upsert
      date,
      startedAt:     `${date}T09:00:00.000Z`,
      title:         `${repo.name}: ${commits.length} commit${commits.length > 1 ? 's' : ''} (${date})`,
      bullets,
      estimatedMins: Math.min(480, commits.length * 30),  // rough; user adjusts at triage
      actualMins:    Math.min(480, commits.length * 30),
      pushStatus:    'hub',          // lands in Daily Hub for triage
      taskStatus:    'done',
      source:        'git-capture',
    }
    if (await post(session)) { posted++; console.log(`captured ${repo.name} ${date}: ${commits.length} commits`) }
  }
}

console.log(`\n${DRY ? '[dry-run] ' : ''}done — ${posted} day-session(s) ${DRY ? 'previewed' : 'captured'}`)
if (!DRY) {
  if (!KAFI_KEY) logRun('WARN no KAFI_API_KEY in env — POSTs would fail auth')
  logRun(`done — ${posted} day-session(s) captured`)
}
