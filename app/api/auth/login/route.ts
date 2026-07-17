import { NextResponse } from 'next/server'
import { signToken, AUTH_COOKIE, SESSION_TTL_MS } from '@/lib/session-token'
import { isSecureRequest } from '@/lib/request-proto'

export const runtime = 'nodejs'

// Rate limit brute-force PIN: max 5 gagal / 10 menit per IP, lalu lockout.
const MAX_FAILS = 5
const WINDOW_MS = 10 * 60 * 1000
const fails = new Map<string, { count: number; first: number }>()

function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  return (xff ? xff.split(',')[0] : '') || req.headers.get('x-real-ip') || 'unknown'
}

export async function POST(req: Request) {
  const pin = process.env.ISL_ACCESS_PIN ?? ''
  // Gate disabled when no PIN configured.
  if (!pin) return NextResponse.json({ ok: true, gateDisabled: true })

  const ip = clientIp(req)
  const now = Date.now()
  const rec = fails.get(ip)
  if (rec && now - rec.first < WINDOW_MS && rec.count >= MAX_FAILS) {
    const waitMin = Math.ceil((WINDOW_MS - (now - rec.first)) / 60000)
    return NextResponse.json({ ok: false, error: `Terlalu banyak percobaan. Coba lagi ~${waitMin} menit.` }, { status: 429 })
  }

  const body = await req.json().catch(() => ({})) as { pin?: string }
  const entered = (body.pin ?? '').trim()
  if (!entered || entered !== pin) {
    // catat kegagalan
    if (rec && now - rec.first < WINDOW_MS) rec.count++
    else fails.set(ip, { count: 1, first: now })
    return NextResponse.json({ ok: false, error: 'PIN salah' }, { status: 401 })
  }
  fails.delete(ip) // sukses → reset

  const exp = Date.now() + SESSION_TTL_MS
  const token = await signToken(JSON.stringify({ exp }))
  const res = NextResponse.json({ ok: true })
  res.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(req), // true only when the client actually connected via HTTPS (nginx TLS)
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  })
  return res
}
