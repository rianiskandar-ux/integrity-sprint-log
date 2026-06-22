import { NextResponse } from 'next/server'
import { AUTH_COOKIE } from '@/lib/session-token'

export const runtime = 'nodejs'

export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(AUTH_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
  return res
}
