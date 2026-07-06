import { NextResponse } from 'next/server'
import { getAllSessions, getSessionBySessionId, saveSession, createSessionId, type SessionLog } from '@/lib/session-store'
import { loadCache } from '@/lib/op-cache'
import { getRequestContext } from '@/lib/request-auth'
import { OWNER_UID } from '@/lib/auth'

export const runtime = 'nodejs'

// GET /api/isl/sessions
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const taskId   = searchParams.get('taskId')
    const status   = searchParams.get('status')
    const validate = searchParams.get('needsValidation')

    const ctx = await getRequestContext()
    let sessions = await getAllSessions(ctx?.uid)

    if (taskId)   sessions = sessions.filter(s => s.opTaskId === Number(taskId))
    if (status)   sessions = sessions.filter(s => s.pushStatus === status)
    if (validate) sessions = sessions.filter(s => s.needsValidation === (validate === 'true'))

    return NextResponse.json({ sessions, total: sessions.length })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// POST /api/isl/sessions — create or upsert by sessionId
export async function POST(req: Request) {
  try {
    const body = await req.json()
    if (body.bullets && !Array.isArray(body.bullets)) body.bullets = [String(body.bullets)]

    const ctx = await getRequestContext()
    // Machine auth untuk hook lokal (Arka/isl-context.mjs): x-kafi-key → OWNER.
    // Tanpa ini hook kena 401 sejak multiuser aktif — Arka diam ~10 hari (root cause).
    const machineAuth = req.headers.get('x-kafi-key') === (process.env.KAFI_API_KEY || 'kafi-bridge-2026')
    // Multi-user: every write must belong to an authenticated user. Without this,
    // a null ctx would write userId=null (orphan) or trust a client-supplied userId.
    if (process.env.ISL_MULTIUSER === '1' && !ctx && !machineAuth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const now  = new Date().toISOString()
    const date = (body.startedAt ?? now).slice(0, 10)

    // Upsert by sessionId
    const existing = body.sessionId ? await getSessionBySessionId(body.sessionId) : null

    if (existing) {
      if (ctx?.uid && existing.userId != null && existing.userId !== ctx.uid)
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      const updated: SessionLog = {
        ...existing,
        title:            body.title            ?? existing.title,
        bullets:          body.bullets          ?? existing.bullets,
        estimatedMins:    body.estimatedMins    ?? existing.estimatedMins,
        actualMins:       body.actualMins       ?? existing.actualMins,
        opTaskId:         body.opTaskId         ?? existing.opTaskId,
        opStoryId:        body.opStoryId        ?? existing.opStoryId,
        opEpicId:         body.opEpicId         ?? existing.opEpicId,
        isNewTask:        body.isNewTask        ?? existing.isNewTask,
        taskStatus:       body.taskStatus       ?? existing.taskStatus,
        aiStatus:         body.aiStatus         ?? existing.aiStatus,
        hasExplicitCmd:   body.hasExplicitCmd   ?? existing.hasExplicitCmd,
        needsValidation:  body.needsValidation  ?? existing.needsValidation,
        command:          body.command          ?? existing.command,
        ticketBinding:    body.ticketBinding    ?? existing.ticketBinding,
        relatedOldTaskId: 'relatedOldTaskId' in body ? body.relatedOldTaskId : existing.relatedOldTaskId,
        tokenUsage:       body.tokenUsage       ?? existing.tokenUsage,
        pushStatus:       body.pushStatus       ?? existing.pushStatus,
        autoPushed:       body.autoPushed       ?? existing.autoPushed,
        updatedAt:        now,
      }
      await saveSession(updated)
      return NextResponse.json({ ok: true, session: updated })
    }

    // Tag session with the authenticated user's uid. Never trust client body.userId.
    // Machine-auth (hook) di-attribute ke OWNER_UID supaya kebaca Kafi & filter user.
    const uid = ctx?.uid ?? (machineAuth ? OWNER_UID : null)

    const cache = loadCache(ctx?.uid)
    const session: SessionLog = {
      id:               createSessionId(),
      sessionId:        body.sessionId,
      userId:           uid,
      date,
      title:            body.title ?? 'Work Session',
      bullets:          body.bullets ?? [],
      source:           body.source ?? null,
      startedAt:        body.startedAt ?? now,
      actualMins:       body.actualMins,
      estimatedMins:    body.estimatedMins ?? 30,
      opTaskId:         body.opTaskId   ?? null,
      opStoryId:        body.opStoryId  ?? null,
      opEpicId:         body.opEpicId   ?? null,
      isNewTask:        body.isNewTask,
      taskStatus:       body.taskStatus ?? 'in_progress',
      aiStatus:         body.aiStatus,
      hasExplicitCmd:   body.hasExplicitCmd  ?? false,
      needsValidation:  body.needsValidation ?? true,
      command:          body.command    ?? null,
      ticketBinding:    body.ticketBinding   ?? null,
      relatedOldTaskId: body.relatedOldTaskId ?? null,
      tokenUsage:       body.tokenUsage ?? null,
      pushStatus:       body.pushStatus ?? 'pushed',
      autoPushed:       body.autoPushed ?? true,
      undoneAt:         null,
      createdAt:        now,
      updatedAt:        now,
    }

    await saveSession(session)
    return NextResponse.json({ ok: true, session })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
