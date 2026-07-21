import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getSessionUser, USER_COOKIE, multiUserEnabled, isOwnerUid } from '@/lib/auth'
import { isSecureRequest } from '@/lib/request-proto'
import { db, users } from '@/lib/db'
import { eq } from 'drizzle-orm'

export const runtime = 'nodejs'

export async function GET() {
  const c = await cookies()
  const u = await getSessionUser(c.get(USER_COOKIE)?.value)
  // role drives the Helpdesk nav split (owner's full view vs Aufa's QA queue,
  // PRD §16.2 build A) — cheap enough to just look up per request.
  const row = u ? (await db.select().from(users).where(eq(users.id, u.uid)).limit(1))[0] : null
  return NextResponse.json({
    multiUser: multiUserEnabled(),
    user: u ? { id: u.uid, name: u.name, opUserId: u.opUserId } : null,
    isOwner: isOwnerUid(u?.uid),
    isQa: row?.role === 'qa',
  })
}

export async function DELETE(req: Request) {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(USER_COOKIE, '', { httpOnly: true, secure: isSecureRequest(req), path: '/', maxAge: 0 })
  return res
}
