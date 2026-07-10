import { NextResponse } from 'next/server'
import { db, userSettings } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { getRequestContext } from '@/lib/request-auth'

export const runtime = 'nodejs'

// Per-user watched-projects persistence. This lived only in localStorage
// before ("Saved in this browser"), so it never followed the account across
// machines and the server-side cache rebuild fell back to the OWNER's
// hardcoded project list for everyone.
export async function GET() {
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const row = (await db.select({ watchedProjects: userSettings.watchedProjects })
    .from(userSettings).where(eq(userSettings.userId, ctx.uid)).limit(1))[0]
  return NextResponse.json({ watchedProjects: (row?.watchedProjects as string[] | null) ?? [] })
}

export async function POST(req: Request) {
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { watchedProjects?: string[] }
  const projects = Array.isArray(body.watchedProjects)
    ? body.watchedProjects.filter(p => typeof p === 'string' && p.trim()).slice(0, 100)
    : []

  const existing = (await db.select({ userId: userSettings.userId })
    .from(userSettings).where(eq(userSettings.userId, ctx.uid)).limit(1))[0]
  if (existing) {
    await db.update(userSettings).set({ watchedProjects: projects, updatedAt: new Date() })
      .where(eq(userSettings.userId, ctx.uid))
  } else {
    await db.insert(userSettings).values({ userId: ctx.uid, watchedProjects: projects })
  }
  return NextResponse.json({ ok: true, watchedProjects: projects })
}
