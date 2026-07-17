import { NextResponse } from 'next/server'
import { AUTH_COOKIE } from '@/lib/session-token'
import { isSecureRequest } from '@/lib/request-proto'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(AUTH_COOKIE, '', { httpOnly: true, secure: isSecureRequest(req), path: '/', maxAge: 0 })
  return res
}
