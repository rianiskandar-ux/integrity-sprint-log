import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken, AUTH_COOKIE } from '@/lib/session-token'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Always allow API, static assets, the login page, and favicon
  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/login') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next()
  }

  // PIN gate is OPT-IN: only active when ISL_ACCESS_PIN is set (lockout-safe)
  const pin = process.env.ISL_ACCESS_PIN
  if (!pin) return NextResponse.next()

  const token = request.cookies.get(AUTH_COOKIE)?.value
  const valid = await verifyToken(token)
  if (!valid) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
