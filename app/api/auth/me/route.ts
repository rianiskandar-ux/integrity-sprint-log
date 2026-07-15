import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getSessionUser, USER_COOKIE, multiUserEnabled, isOwnerUid } from '@/lib/auth'

export const runtime = 'nodejs'

export async function GET() {
  const c = await cookies()
  const u = await getSessionUser(c.get(USER_COOKIE)?.value)
  return NextResponse.json({
    multiUser: multiUserEnabled(),
    user: u ? { id: u.uid, name: u.name, opUserId: u.opUserId } : null,
    isOwner: isOwnerUid(u?.uid),
  })
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(USER_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
  return res
}
