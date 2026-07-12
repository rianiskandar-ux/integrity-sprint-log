#!/usr/bin/env node
/**
 * Multi-user isolation regression guard.
 *
 * Hits EVERY /api route with NO session cookie and NO machine key, and asserts
 * it does NOT return 200 (which would mean it served data to an anonymous LAN
 * caller). This is the automated backstop for the 2026-07-12 audit: the app
 * grew from single-user, and the recurring bug was routes that called
 * getRequestContext() only for a token and forgot to null-check — fail-OPEN.
 * Middleware now coarse-gates all /api (except the self-gating prefixes below),
 * so a new leaking route trips this test loudly instead of shipping silently.
 *
 * Usage: node scripts/audit-api-auth.mjs [baseUrl]   (default http://localhost:4891)
 * Exit 0 = all gated; exit 1 = at least one route returned 200 unauthenticated.
 *
 * Only GET + POST(empty body) are exercised — never DELETE/PATCH — so running
 * this against the live instance can't mutate data. Middleware gates every verb
 * uniformly, so GET/POST are a faithful proxy for the whole route.
 */
import { readdirSync, statSync, readFileSync } from 'fs'
import { join, relative } from 'path'

const BASE = process.argv[2] || 'http://localhost:4891'
const API_DIR = join(process.cwd(), 'app', 'api')

// Prefixes intentionally reachable without a session cookie: the login/OAuth
// flow, and machine endpoints that validate their own x-kafi-key inside the
// route. Results for these are reported but never fail the run.
const SELF_GATING_PREFIXES = ['auth/', 'internal/', 'kafi/']

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (name === 'route.ts') out.push(p)
  }
  return out
}

// app/api/foo/[id]/route.ts -> foo/__id__ ; we substitute a dummy for [seg].
function routePath(file) {
  const rel = relative(API_DIR, file).replace(/\\/g, '/').replace(/\/route\.ts$/, '')
  return rel.replace(/\[[^\]]+\]/g, '1')
}

function methods(file) {
  const src = readFileSync(file, 'utf-8')
  return ['GET', 'POST'].filter(m => new RegExp(`export async function ${m}\\b`).test(src))
}

async function hit(method, url) {
  try {
    const res = await fetch(url, {
      method,
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {},
      body: method === 'POST' ? '{}' : undefined,
      // no cookie, no x-kafi-key — anonymous
    })
    return res.status
  } catch (e) {
    return `ERR ${e.message}`
  }
}

const files = walk(API_DIR).sort()
const fails = []
const selfGated = []
let pass = 0

for (const file of files) {
  const rel = routePath(file)
  const isSelfGating = SELF_GATING_PREFIXES.some(p => rel.startsWith(p))
  for (const m of methods(file)) {
    const status = await hit(m, `${BASE}/api/${rel}`)
    const line = `${m.padEnd(4)} /api/${rel} -> ${status}`
    if (isSelfGating) { selfGated.push(line); continue }
    if (status === 401 || status === 403) { pass++; continue }
    // Anything else (200/400/500/…) on a cookie-gated route is suspect. 400 can
    // be a body-validation reject that fires BEFORE the auth check — that's a
    // fail too, because it means an anon caller reached route logic.
    fails.push(line)
  }
}

console.log(`\n=== Cookie-gated routes: ${pass} correctly refused (401/403) ===`)
if (fails.length) {
  console.log(`\n❌ ${fails.length} route(s) reachable WITHOUT auth (potential leak):`)
  for (const l of fails) console.log('   ' + l)
} else {
  console.log('✅ every cookie-gated route refused anonymous access')
}
console.log(`\n=== Self-gating prefixes (auth/internal/kafi) — informational ===`)
for (const l of selfGated) console.log('   ' + l)

process.exit(fails.length ? 1 : 0)
