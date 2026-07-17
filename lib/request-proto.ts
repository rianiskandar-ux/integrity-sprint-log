/**
 * Hardening #5: cookies should only carry `secure: true` when the ORIGINAL
 * client connection was actually HTTPS. Next.js sits behind nginx (TLS
 * termination) and only ever sees plain HTTP internally, so `req.url`'s own
 * protocol is useless here — nginx must forward `X-Forwarded-Proto` for this
 * to work. Falls back to the request's own protocol for direct (no-proxy)
 * access, which keeps plain-HTTP access (existing team access pattern)
 * working unchanged.
 */
export function isSecureRequest(req: Request): boolean {
  const proto = req.headers.get('x-forwarded-proto')
  if (proto) return proto.split(',')[0].trim().toLowerCase() === 'https'
  try { return new URL(req.url).protocol === 'https:' } catch { return false }
}
