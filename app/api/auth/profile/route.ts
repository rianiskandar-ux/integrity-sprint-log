import { NextResponse } from 'next/server'
import { loadProfile, deleteProfile } from '@/lib/google-auth'

export async function GET() {
  const profile = loadProfile()
  if (!profile) return NextResponse.json({ profile: null })
  return NextResponse.json({ profile })
}

export async function DELETE() {
  deleteProfile()
  return NextResponse.json({ ok: true })
}
