import { NextResponse } from 'next/server'
import { signToken, AUTH_COOKIE, SESSION_TTL_MS } from '@/lib/session-token'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const pin = process.env.ISL_ACCESS_PIN ?? ''
  // Gate disabled when no PIN configured.
  if (!pin) return NextResponse.json({ ok: true, gateDisabled: true })

  const body = await req.json().catch(() => ({})) as { pin?: string }
  const entered = (body.pin ?? '').trim()
  if (!entered || entered !== pin) {
    return NextResponse.json({ ok: false, error: 'PIN salah' }, { status: 401 })
  }

  const exp = Date.now() + SESSION_TTL_MS
  const token = await signToken(JSON.stringify({ exp }))
  const res = NextResponse.json({ ok: true })
  res.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false, // LAN over http — https not used
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  })
  return res
}
