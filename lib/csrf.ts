/**
 * CSRF check (Hardening #4) — extracted from middleware.ts so it's unit-
 * testable without constructing a full NextRequest/Edge runtime context.
 *
 * Cookie-authenticated requests are the CSRF-vulnerable class (the browser
 * auto-attaches cookies cross-site); machine-key (x-kafi-key) requests are
 * not — an attacker page can't read/replay that header, and any cross-origin
 * attempt to set it forces a CORS preflight this app never approves, so the
 * browser blocks it before it's sent. So this check only needs to run for
 * the cookie path, on state-changing methods.
 *
 * Approach: verify the request's Origin (fallback Referer) header's host
 * matches the request's own Host header. This needs no hardcoded origin
 * allowlist — it just proves "this request actually came from a page served
 * by this same host", which is true for any legitimate same-origin fetch()
 * call and false for a cross-site CSRF attempt (forged form/fetch from an
 * attacker's page carries THEIR origin, not this app's). Works unchanged
 * whether accessed via localhost, LAN IP, or a .test hostname.
 */
export const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function isSameOriginRequest(headers: Headers): boolean {
  const host = headers.get('host')
  if (!host) return false
  const candidate = headers.get('origin') || headers.get('referer')
  if (!candidate) return false
  try {
    return new URL(candidate).host === host
  } catch {
    return false
  }
}
