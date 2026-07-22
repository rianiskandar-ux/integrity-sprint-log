import fs from 'fs'
import path from 'path'

const AUTH_DIR = process.env.AUTH_DATA_DIR ?? process.cwd()
const OWNER_UID = Number(process.env.ISL_OWNER_UID ?? 1)
// Legacy single-connection files (pre-multiuser). Kept only as a migration grace
// for the OWNER, so their existing Google link doesn't drop after this change.
const LEGACY_TOKEN   = path.join(AUTH_DIR, 'google-token.json')
const LEGACY_PROFILE = path.join(AUTH_DIR, 'google-profile.json')

interface GoogleToken {
  access_token: string
  refresh_token: string
  expiry: number
}

export interface GoogleProfile {
  id: string
  name: string
  email: string
  picture?: string
}

// Google connection is PER-USER. No uid → null: never read/write a shared file,
// so one user's Google connection can never leak to another on a shared instance.
function tokenFile(uid?: number | null): string | null {
  return uid ? path.join(AUTH_DIR, `google-token-${uid}.json`) : null
}
function profileFile(uid?: number | null): string | null {
  return uid ? path.join(AUTH_DIR, `google-profile-${uid}.json`) : null
}
function readJson<T>(file: string | null): T | null {
  if (!file) return null
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) as T : null } catch { return null }
}

export function loadProfile(uid?: number | null): GoogleProfile | null {
  return readJson<GoogleProfile>(profileFile(uid))
    ?? (uid === OWNER_UID ? readJson<GoogleProfile>(LEGACY_PROFILE) : null)
}

export function saveProfile(uid: number | null | undefined, p: GoogleProfile) {
  const f = profileFile(uid); if (!f) return
  fs.writeFileSync(f, JSON.stringify(p, null, 2), 'utf-8')
}

export function deleteProfile(uid?: number | null) {
  const f = profileFile(uid)
  try { if (f && fs.existsSync(f)) fs.unlinkSync(f) } catch { /* noop */ }
  if (uid === OWNER_UID) { try { if (fs.existsSync(LEGACY_PROFILE)) fs.unlinkSync(LEGACY_PROFILE) } catch { /* noop */ } }
}

export function loadToken(uid?: number | null): GoogleToken | null {
  return readJson<GoogleToken>(tokenFile(uid))
    ?? (uid === OWNER_UID ? readJson<GoogleToken>(LEGACY_TOKEN) : null)
}

export function saveToken(uid: number | null | undefined, token: GoogleToken) {
  const f = tokenFile(uid); if (!f) return
  fs.writeFileSync(f, JSON.stringify(token, null, 2), 'utf-8')
}

export function deleteToken(uid?: number | null) {
  const f = tokenFile(uid)
  try { if (f && fs.existsSync(f)) fs.unlinkSync(f) } catch { /* noop */ }
  if (uid === OWNER_UID) { try { if (fs.existsSync(LEGACY_TOKEN)) fs.unlinkSync(LEGACY_TOKEN) } catch { /* noop */ } }
}

export function getAuthUrl(state?: string | number): string {
  const hint = process.env.GOOGLE_LOGIN_HINT ?? ''
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID!,
    redirect_uri:  process.env.GOOGLE_REDIRECT_URI!,
    response_type: 'code',
    // drive.readonly + spreadsheets.readonly (2026-07-21): Tika needs to read
    // Sheets/files a ticket links to, not just its OP text, for real context
    // instead of assumptions. documents + drive.file: Google Docs
    // integration (Helpdesk documentation) needs to actually create/write a
    // doc, not just read. Reconnecting is required to pick up new scopes —
    // an existing token keeps whatever scopes it was originally granted.
    scope:         'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/drive.file',
    access_type:   'offline',
    prompt:        'select_account consent',
  })
  if (hint) params.set('login_hint', hint)
  // Carry the connecting user's uid so the callback attributes the token correctly.
  if (state != null && String(state) !== '') params.set('state', String(state))
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

export async function exchangeCode(code: string): Promise<GoogleToken> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri:  process.env.GOOGLE_REDIRECT_URI!,
      grant_type:    'authorization_code',
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(data.error_description ?? 'OAuth failed')
  return {
    access_token:  data.access_token,
    refresh_token: data.refresh_token,
    expiry:        Date.now() + (data.expires_in - 60) * 1000,
  }
}

export async function getValidToken(uid?: number | null): Promise<string | null> {
  const token = loadToken(uid)
  if (!token) return null

  if (Date.now() < token.expiry) return token.access_token

  // Refresh
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: token.refresh_token,
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type:    'refresh_token',
    }),
  })
  const data = await res.json()
  if (!data.access_token) return null

  const updated: GoogleToken = {
    ...token,
    access_token: data.access_token,
    expiry: Date.now() + (data.expires_in - 60) * 1000,
  }
  saveToken(uid, updated)   // writes the per-user file (also migrates the owner off legacy)
  return updated.access_token
}
