/**
 * Signed session token for the lightweight PIN gate.
 * Uses Web Crypto (globalThis.crypto.subtle) so it runs in BOTH the edge
 * middleware and node API routes. Format: <payload_b64url>.<sig_b64url>
 *
 * The gate is OPT-IN: enabled only when ISL_ACCESS_PIN is set. When unset,
 * middleware lets everything through (lockout-safe).
 */

const enc = new TextEncoder()

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(str: string): Uint8Array {
  const s = str.replace(/-/g, '+').replace(/_/g, '/')
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : ''
  const bin = atob(s + pad)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

// NEXTAUTH_SECRET was a misleading name here (this repo doesn't use NextAuth)
// and the hardcoded 'isl-fallback-sign-key' literal was the exact same
// weak-default antipattern as the old KAFI_API_KEY/ISL_ENCRYPTION_KEY
// placeholders — a known string, visible in source, silently signing every
// session/PIN-gate token if the real key were ever unset. Fail loud instead.
function secret(): string {
  const key = process.env.ISL_ENCRYPTION_KEY
  if (!key) throw new Error('ISL_ENCRYPTION_KEY is required (session/PIN-gate token signing)')
  return key
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret()) as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signToken(payload: string): Promise<string> {
  const key = await hmacKey()
  const data = enc.encode(payload)
  const sig = await crypto.subtle.sign('HMAC', key, data as BufferSource)
  return `${b64url(data)}.${b64url(sig)}`
}

/** Returns the payload string if valid (and not expired), else null. */
export async function verifyToken(token: string | undefined): Promise<string | null> {
  if (!token || !token.includes('.')) return null
  const [payloadB64, sigB64] = token.split('.')
  try {
    const payloadBytes = fromB64url(payloadB64)
    const payload = new TextDecoder().decode(payloadBytes)
    const key = await hmacKey()
    const ok = await crypto.subtle.verify('HMAC', key, fromB64url(sigB64) as BufferSource, payloadBytes as BufferSource)
    if (!ok) return null
    // expiry check
    try {
      const { exp } = JSON.parse(payload) as { exp?: number }
      if (exp && Date.now() > exp) return null
    } catch { /* payload not JSON — treat as valid signature only */ }
    return payload
  } catch {
    return null
  }
}

export const AUTH_COOKIE = 'isl-auth'
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000 // 8 hours
