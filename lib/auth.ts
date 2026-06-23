import { signToken, verifyToken } from './session-token'

export const USER_COOKIE = 'isl-user'
export const USER_TTL_MS = 8 * 60 * 60 * 1000 // 8 jam

export interface SessionUser {
  uid: number          // users.id
  name: string
  opUserId: number | null
  exp: number
}

export async function makeUserToken(u: Omit<SessionUser, 'exp'>): Promise<string> {
  const payload = JSON.stringify({ ...u, exp: Date.now() + USER_TTL_MS })
  return signToken(payload)
}

export async function getSessionUser(token: string | undefined): Promise<SessionUser | null> {
  const payload = await verifyToken(token)
  if (!payload) return null
  try {
    const u = JSON.parse(payload) as SessionUser
    if (!u.uid) return null
    return u
  } catch {
    return null
  }
}

/** Apakah mode multi-user aktif. Default OFF — single-user/PIN tetap jalan. */
export function multiUserEnabled(): boolean {
  return process.env.ISL_MULTIUSER === '1'
}

/**
 * The user whose data lives in the legacy shared markdown dir (daily-sprints/).
 * Historically all .md files are the server owner's. Only this user reads/writes
 * those files; every other user reads/writes the per-user PostgreSQL sessions table.
 * Default uid 1 (first registered user), overridable via ISL_OWNER_UID.
 */
export const OWNER_UID = Number(process.env.ISL_OWNER_UID ?? 1)

export function isOwnerUid(uid: number | null | undefined): boolean {
  return uid != null && uid === OWNER_UID
}
