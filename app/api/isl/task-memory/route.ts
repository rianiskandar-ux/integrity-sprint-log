import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { taskMemory } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { getRequestContext } from '@/lib/request-auth'
import { resolveCaptureUid } from '@/lib/capture-auth'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'

// POST /api/isl/task-memory — save task work history entry
export async function POST(req: Request) {
  try {
    const ctx  = await getRequestContext()
    const body = await req.json() as {
      opTaskId: number
      title: string
      bullets?: string[]
      date?: string
      actualMins?: number | null
      sessionId?: string
    }
    if (!body.opTaskId || !body.title) {
      return NextResponse.json({ error: 'opTaskId and title required' }, { status: 400 })
    }
    // Was `ctx?.uid ?? OWNER_UID` — unlike its sibling daily-log/append, this
    // never checked the per-user captureKey at all, so a teammate's own hook
    // capture always got misattributed to the owner, AND any caller with a
    // missing/invalid x-kafi-key (middleware only checks presence) could
    // write task-memory rows as the owner. resolveCaptureUid handles both the
    // legitimate global-key-=-owner case and per-user keys; fail closed
    // otherwise, matching daily-log/append's fix.
    const captureUid = await resolveCaptureUid(req.headers.get('x-kafi-key'))
    const uid = ctx?.uid ?? captureUid
    if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const id = `${body.sessionId?.slice(0, 8) ?? randomUUID().slice(0, 8)}-${body.opTaskId}`
    await db.insert(taskMemory).values({
      id,
      userId:    uid,
      opTaskId:  body.opTaskId,
      sessionId: body.sessionId ?? null,
      date:      body.date ?? new Date().toISOString().slice(0, 10),
      title:     body.title,
      bullets:   (body.bullets ?? []).filter(Boolean),
      actualMins: body.actualMins ?? null,
    }).onConflictDoUpdate({
      target: taskMemory.id,
      set: { title: body.title, bullets: (body.bullets ?? []).filter(Boolean), actualMins: body.actualMins ?? null },
    })
    return NextResponse.json({ ok: true, id })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// GET /api/isl/task-memory?opTaskId=123 — fetch work history for a task
export async function GET(req: Request) {
  try {
    const ctx = await getRequestContext()
    const { searchParams } = new URL(req.url)
    const opTaskId = Number(searchParams.get('opTaskId'))
    if (!opTaskId) return NextResponse.json({ error: 'opTaskId required' }, { status: 400 })
    const rows = await db.select().from(taskMemory)
      .where(eq(taskMemory.opTaskId, opTaskId))
      .orderBy(desc(taskMemory.loggedAt))
      .limit(50)
    return NextResponse.json({ entries: rows })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
