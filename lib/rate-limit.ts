/**
 * In-memory sliding-window rate limiter. Fine at this scale — one Next.js
 * container instance, single-digit real users — a distributed store (Redis)
 * would be pure overhead. Resets on container restart; worst case that gives
 * everyone one fresh window, not a security hole, so it's an acceptable
 * tradeoff for the simplicity.
 *
 * First use: gating POST /api/op/comment (the "Tanya ke pelapor" feature and
 * anything else that posts OP comments) — previously any authenticated user
 * could fire unlimited comments with no cooldown.
 */
const hits = new Map<string, number[]>()

/** Returns true if `key` has already hit `maxHits` within the last `windowMs`.
 *  Counts this call as a hit only when NOT limited (so a blocked request
 *  doesn't itself consume a slot). */
export function isRateLimited(key: string, maxHits: number, windowMs: number): boolean {
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter(t => now - t < windowMs)
  if (recent.length >= maxHits) {
    hits.set(key, recent)
    return true
  }
  recent.push(now)
  hits.set(key, recent)
  return false
}
