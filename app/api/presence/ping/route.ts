import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { userPresence } from '@/lib/db/schema'
import { getRequestContext } from '@/lib/request-auth'
import { eq } from 'drizzle-orm'

export const runtime = 'nodejs'

// POST /api/presence/ping — browser heartbeat, called every ~30s while ISL is
// open (see PresenceHeartbeat.tsx). `idle` is computed client-side from real
// mouse/keyboard/scroll events, never read from the page content — this is a
// single boolean, not telemetry. No-op (never throws to the caller) so a
// blip here never surfaces as a user-facing error; presence is a nice-to-have
// signal, not something the app depends on to function.
export async function POST(req: Request) {
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let idle = false
  try {
    const body = await req.json()
    idle = !!body?.idle
  } catch { /* missing/invalid body — treat as active */ }

  await db.insert(userPresence)
    .values({ userId: ctx.uid, lastPingAt: new Date(), idle })
    .onConflictDoUpdate({
      target: userPresence.userId,
      set: { lastPingAt: new Date(), idle },
    })

  return NextResponse.json({ ok: true })
}

// GET is used server-side only (team/board route imports the table directly),
// but exposed too for a quick manual check ("am I registering?").
export async function GET() {
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const rows = await db.select().from(userPresence).where(eq(userPresence.userId, ctx.uid)).limit(1)
  return NextResponse.json({ row: rows[0] ?? null })
}
