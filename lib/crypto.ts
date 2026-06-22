import crypto from 'crypto'

/**
 * At-rest encryption for secrets (OP token, API keys).
 * Format: v1:<iv_b64>:<tag_b64>:<cipher_b64>  (AES-256-GCM)
 *
 * Key source: process.env.ISL_ENCRYPTION_KEY (any string; derived to 32 bytes via scrypt).
 * Fail-soft: if no key is set, encrypt/decrypt return the input unchanged so the app
 * never locks itself out. decrypt() also passes through plaintext lacking the v1: prefix
 * (backward compat with configs saved before encryption existed).
 */

const PREFIX = 'v1:'
const SALT = 'isl-at-rest-v1' // static salt is acceptable: the env key is the real secret

let cachedKey: Buffer | null = null
function getKey(): Buffer | null {
  const raw = process.env.ISL_ENCRYPTION_KEY
  if (!raw) return null
  if (cachedKey) return cachedKey
  cachedKey = crypto.scryptSync(raw, SALT, 32)
  return cachedKey
}

export function isEncryptionEnabled(): boolean {
  return getKey() !== null
}

export function encrypt(plain: string): string {
  if (!plain) return plain
  const key = getKey()
  if (!key) return plain // fail-soft: no key configured
  if (plain.startsWith(PREFIX)) return plain // already encrypted
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

export function decrypt(value: string): string {
  if (!value || !value.startsWith(PREFIX)) return value // plaintext / empty pass-through
  const key = getKey()
  if (!key) return value // can't decrypt without key; return as-is
  try {
    const [, ivB64, tagB64, dataB64] = value.split(':')
    const iv = Buffer.from(ivB64, 'base64')
    const tag = Buffer.from(tagB64, 'base64')
    const data = Buffer.from(dataB64, 'base64')
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  } catch {
    return value
  }
}

// Session token (PIN-gate) sign/verify lives in lib/session-token.ts — it uses
// Web Crypto so it works in BOTH the edge middleware and node API routes.
