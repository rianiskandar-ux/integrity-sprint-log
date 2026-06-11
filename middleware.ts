import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Don't redirect API routes, static assets, or the setup page itself
  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/setup') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next()
  }

  // Check setup via cookie (set by setup page after successful save)
  const setupDone = request.cookies.get('isl-setup-done')?.value
  if (!setupDone) {
    return NextResponse.redirect(new URL('/setup', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
