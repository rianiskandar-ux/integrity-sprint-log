import { NextResponse } from 'next/server'
import { loadProfile, deleteProfile, deleteToken } from '@/lib/google-auth'
import { getRequestContext } from '@/lib/request-auth'

export async function GET() {
  const ctx = await getRequestContext()
  const profile = loadProfile(ctx?.uid)
  if (!profile) return NextResponse.json({ profile: null })
  return NextResponse.json({ profile })
}

export async function DELETE() {
  const ctx = await getRequestContext()
  // Disconnect = remove this user's Google profile AND token.
  deleteProfile(ctx?.uid)
  deleteToken(ctx?.uid)
  return NextResponse.json({ ok: true })
}
