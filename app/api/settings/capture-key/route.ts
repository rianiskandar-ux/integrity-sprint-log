import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { db, userSettings } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { getRequestContext } from '@/lib/request-auth'

export const runtime = 'nodejs'

// Per-user machine key for the Claude Code Stop hook. The teammate puts this
// in their own ~/.claude/settings.json env as KAFI_API_KEY (plus ISL_URL
// pointing at this instance) — captured sessions then land under THEIR uid.
export async function GET() {
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const row = (await db.select({ captureKey: userSettings.captureKey })
    .from(userSettings).where(eq(userSettings.userId, ctx.uid)).limit(1))[0]
  return NextResponse.json({ captureKey: row?.captureKey ?? null })
}

export async function POST() {
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const captureKey = `cap-${ctx.uid}-${randomBytes(12).toString('base64url')}`
  const existing = (await db.select({ userId: userSettings.userId })
    .from(userSettings).where(eq(userSettings.userId, ctx.uid)).limit(1))[0]
  if (existing) {
    await db.update(userSettings).set({ captureKey, updatedAt: new Date() })
      .where(eq(userSettings.userId, ctx.uid))
  } else {
    await db.insert(userSettings).values({ userId: ctx.uid, captureKey })
  }
  return NextResponse.json({ ok: true, captureKey })
}

export async function DELETE() {
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await db.update(userSettings).set({ captureKey: null, updatedAt: new Date() })
    .where(eq(userSettings.userId, ctx.uid))
  return NextResponse.json({ ok: true })
}
