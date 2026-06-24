/**
 * Per-request auth helper.
 * Reads the logged-in user's OP token from DB (decrypted) so each route can
 * make OP API calls on behalf of the real user — not Rian's global env token.
 */
import { cookies } from 'next/headers'
import { getSessionUser, USER_COOKIE } from './auth'
import { db } from './db'
import { userSettings } from './db/schema'
import { eq } from 'drizzle-orm'
import { decrypt } from './crypto'
import { getOpToken, getOpBaseUrl } from './user-config'

export interface RequestContext {
  uid: number
  opUserId: number
  opToken: string
  opBaseUrl: string
}

/**
 * Resolve the OP context for the current request.
 *
 * Multi-user mode  (ISL_MULTIUSER=1): reads isl-user cookie → DB userSettings.
 * Single-user mode (ISL_MULTIUSER≠1): falls back to env OP_API_TOKEN + uid=1.
 *
 * Returns null only in multi-user mode when the user is not authenticated or
 * has no saved OP token (should not happen if login flow completed correctly).
 */
export async function getRequestContext(): Promise<RequestContext | null> {
  const opBaseUrl = getOpBaseUrl() || process.env.OP_BASE_URL || 'https://tokek.integrity-asia.com'

  // Single-user / PIN mode: fall back to global env token.
  // opUserId from ISL_OP_USER_ID (each personal instance sets their own); 0 = unknown.
  if (process.env.ISL_MULTIUSER !== '1') {
    const token = getOpToken() || process.env.OP_API_TOKEN || ''
    return { uid: 1, opUserId: Number(process.env.ISL_OP_USER_ID ?? 0), opToken: token, opBaseUrl }
  }

  // Multi-user mode: resolve from session cookie
  const c = await cookies()
  const user = await getSessionUser(c.get(USER_COOKIE)?.value)
  if (!user) return null

  // Get encrypted OP token from userSettings
  const rows = await db.select().from(userSettings).where(eq(userSettings.userId, user.uid)).limit(1)
  const row = rows[0]

  const rawToken = row?.opApiToken || ''
  const opToken  = rawToken ? decrypt(rawToken) : ''
  if (!opToken) return null  // must re-login if token missing in DB

  const opUserId = row?.opUserId ?? user.opUserId ?? 0

  return { uid: user.uid, opUserId, opToken, opBaseUrl }
}
