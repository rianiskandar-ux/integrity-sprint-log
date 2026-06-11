import fs from 'fs'
import path from 'path'

const AUTH_DIR = process.env.AUTH_DATA_DIR ?? process.cwd()
const TOKEN_FILE = path.join(AUTH_DIR, 'google-token.json')

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

const PROFILE_FILE = path.join(AUTH_DIR, 'google-profile.json')

export function loadProfile(): GoogleProfile | null {
  try {
    if (!fs.existsSync(PROFILE_FILE)) return null
    return JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf-8'))
  } catch { return null }
}

export function saveProfile(p: GoogleProfile) {
  fs.writeFileSync(PROFILE_FILE, JSON.stringify(p, null, 2), 'utf-8')
}

export function deleteProfile() {
  try { if (fs.existsSync(PROFILE_FILE)) fs.unlinkSync(PROFILE_FILE) } catch { /* noop */ }
}

export function loadToken(): GoogleToken | null {
  try {
    if (!fs.existsSync(TOKEN_FILE)) return null
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'))
  } catch { return null }
}

export function saveToken(token: GoogleToken) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(token, null, 2), 'utf-8')
}

export function getAuthUrl(): string {
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID!,
    redirect_uri:  process.env.GOOGLE_REDIRECT_URI!,
    response_type: 'code',
    scope:         'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.send',
    access_type:   'offline',
    prompt:        'consent',
  })
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

export async function sendEmail(to: string, subject: string, htmlBody: string): Promise<boolean> {
  const token = await getValidToken()
  if (!token) return false
  try {
    const message = [
      `To: ${to}`,
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=utf-8`,
      `X-Priority: 1`,
      `Importance: high`,
      '',
      htmlBody,
    ].join('\r\n')
    const encoded = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: encoded }),
    })
    return res.ok
  } catch { return false }
}

export async function getValidToken(): Promise<string | null> {
  const token = loadToken()
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
  saveToken(updated)
  return updated.access_token
}
