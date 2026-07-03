import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { taskMemory } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { getRequestContext } from '@/lib/request-auth'
import { OWNER_UID } from '@/lib/auth'
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
    const id = `${body.sessionId?.slice(0, 8) ?? randomUUID().slice(0, 8)}-${body.opTaskId}`
    await db.insert(taskMemory).values({
      id,
      // Tanpa session (hook/terminal lokal) → attribute ke OWNER, sama seperti
      // daily-log/append — kalau NULL, Kafi daily-summary tidak melihatnya.
      userId:    ctx?.uid ?? OWNER_UID,
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
