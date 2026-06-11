// Cleanup scrum-project:
// 1. Delete all time entries
// 2. Remove sprint version from all work packages
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '../.next/standalone/.env')
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf-8').split('\n')
    .filter(l => l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)

const BASE  = env.OP_BASE_URL
const TOKEN = env.OP_API_TOKEN
const AUTH  = 'Basic ' + Buffer.from(`apikey:${TOKEN}`).toString('base64')
const HEADERS = { Authorization: AUTH, 'Content-Type': 'application/json', Accept: 'application/json' }

async function get(path) {
  const r = await fetch(`${BASE}/api/v3${path}`, { headers: HEADERS })
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`)
  return r.json()
}
async function del(path) {
  const r = await fetch(`${BASE}/api/v3${path}`, { method: 'DELETE', headers: HEADERS })
  return r.status
}
async function patch(path, body) {
  const r = await fetch(`${BASE}/api/v3${path}`, { method: 'PATCH', headers: HEADERS, body: JSON.stringify(body) })
  return r.status
}

// Get scrum-project ID
const proj = await get('/projects/scrum-project')
const projectId = proj.id
console.log(`\nscrum-project ID: ${projectId}`)

// ── 1. Delete Rian's time entries only ──────────────────────────────────────
console.log('\n── Fetching Rian\'s user ID...')
const me = await get('/users/me')
console.log(`User: ${me.name} (id: ${me.id})`)

console.log('\n── Fetching time entries...')
const f1 = encodeURIComponent(JSON.stringify([
  { project: { operator: '=', values: [String(projectId)] } },
  { user:    { operator: '=', values: [String(me.id)] } },
]))
const teRes = await get(`/time_entries?filters=${f1}&pageSize=500`)
const timeEntries = teRes._embedded?.elements ?? []
console.log(`Found ${timeEntries.length} time entries`)

let deleted = 0, skipped = 0
for (const te of timeEntries) {
  const status = await del(`/time_entries/${te.id}`)
  if (status === 204 || status === 200) {
    console.log(`  ✓ deleted time entry ${te.id} (${te.hours ?? te.spentOn})`)
    deleted++
  } else {
    console.log(`  ✗ failed ${te.id} → HTTP ${status}`)
    skipped++
  }
  await new Promise(r => setTimeout(r, 100)) // rate limit
}
console.log(`\nTime entries: ${deleted} deleted, ${skipped} failed`)

// ── 2. Remove sprint version from all WPs ───────────────────────────────────
console.log('\n── Fetching work packages with version...')
const f2 = encodeURIComponent(JSON.stringify([{ project: { operator: '=', values: [String(projectId)] } }]))
const wpRes = await get(`/work_packages?filters=${f2}&pageSize=200`)
const wps = wpRes._embedded?.elements ?? []

const withVersion = wps.filter(wp => wp._links?.version?.href)
console.log(`Found ${withVersion.length} WPs with sprint version`)

let patched = 0, patchFailed = 0
for (const wp of withVersion) {
  const versionTitle = wp._links.version.title
  // Need lockVersion for PATCH
  const status = await patch(`/work_packages/${wp.id}`, {
    lockVersion: wp.lockVersion,
    _links: { version: { href: null } }
  })
  if (status === 200) {
    console.log(`  ✓ #${wp.id} version removed (was: ${versionTitle})`)
    patched++
  } else {
    console.log(`  ✗ #${wp.id} failed → HTTP ${status}`)
    patchFailed++
  }
  await new Promise(r => setTimeout(r, 150))
}
console.log(`\nVersions: ${patched} cleared, ${patchFailed} failed`)
console.log('\n✅ Done')
