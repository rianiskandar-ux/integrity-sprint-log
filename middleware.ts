import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken, AUTH_COOKIE } from '@/lib/session-token'
import { USER_COOKIE } from '@/lib/auth'

// /api paths reachable WITHOUT a session — the login/OAuth flow itself, and a
// keyless health probe. Everything else under /api is gated below so a newly
// added route is fail-closed by default (defense-in-depth on top of each
// route's own getRequestContext check — the audit found ~10 routes that had
// forgotten that check and were fail-OPEN).
// Prefixes exempt from the coarse cookie gate below. Each is EITHER public by
// nature (the login/OAuth flow) OR a machine endpoint that validates its own
// x-kafi-key inside the route (internal/*, kafi/*). Middleware not double-
// gating these keeps the query-param-key convention (internal/*) and per-user
// capture keys working; the routes themselves still enforce the key value.
const PUBLIC_API_PREFIXES = ['/api/auth/', '/api/internal/', '/api/kafi/']

// ── CSRF protection (Hardening #4) ──────────────────────────────────────────
// Cookie-authenticated requests are the CSRF-vulnerable class (the browser
// auto-attaches cookies cross-site); machine-key (x-kafi-key) requests are
// not — an attacker page can't read/replay that header, and any cross-origin
// attempt to set it forces a CORS preflight this app never approves, so the
// browser blocks it before it's sent. So this check only needs to run for
// the cookie path, on state-changing methods.
//
// Approach: verify the request's Origin (fallback Referer) header's host
// matches the request's own Host header. This needs no hardcoded origin
// allowlist — it just proves "this request actually came from a page served
// by this same host", which is true for any legitimate same-origin fetch()
// call and false for a cross-site CSRF attempt (forged form/fetch from an
// attacker's page carries THEIR origin, not this app's). Works unchanged
// whether accessed via localhost, LAN IP, or a .test hostname.
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function isSameOriginRequest(request: NextRequest): boolean {
  const host = request.headers.get('host')
  if (!host) return false
  const candidate = request.headers.get('origin') || request.headers.get('referer')
  if (!candidate) return false
  try {
    return new URL(candidate).host === host
  } catch {
    return false
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Static assets, the login page, and favicon are always open.
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/login') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next()
  }

  // ── /api coarse gate (multi-user only) ──────────────────────────────────────
  // Coarse = "is this caller authenticated at all", not "which user / owner":
  // that fine-grained scoping still lives in each route. A request passes if it
  // has a valid session cookie OR presents a machine key (VALUE is validated in
  // the route via resolveCaptureUid — middleware only checks presence so it
  // stays edge-safe and per-user capture keys keep working). Public prefixes
  // (login flow, health) are exempt.
  if (pathname.startsWith('/api/')) {
    if (process.env.ISL_MULTIUSER !== '1') return NextResponse.next()
    if (PUBLIC_API_PREFIXES.some(p => pathname.startsWith(p))) return NextResponse.next()
    if (request.headers.get('x-kafi-key')) return NextResponse.next()

    // CSRF: mutating cookie-authenticated requests must be same-origin.
    if (MUTATING_METHODS.has(request.method) && !isSameOriginRequest(request)) {
      return NextResponse.json({ error: 'CSRF check failed — request origin mismatch' }, { status: 403 })
    }

    const u = await verifyToken(request.cookies.get(USER_COOKIE)?.value)
    if (!u) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return NextResponse.next()
  }

  // Multi-user mode: wajib login OP-token (cookie isl-user). Aktif kalau ISL_MULTIUSER=1.
  if (process.env.ISL_MULTIUSER === '1') {
    const u = await verifyToken(request.cookies.get(USER_COOKIE)?.value)
    if (!u) return NextResponse.redirect(new URL('/login', request.url))
    return NextResponse.next()
  }

  // PIN gate is OPT-IN: only active when ISL_ACCESS_PIN is set (lockout-safe)
  const pin = process.env.ISL_ACCESS_PIN
  if (!pin) return NextResponse.next()

  const token = request.cookies.get(AUTH_COOKIE)?.value
  const valid = await verifyToken(token)
  if (!valid) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
