import { NextResponse } from 'next/server'
import { getAllSessions, getSessionBySessionId, saveSession, createSessionId, type SessionLog } from '@/lib/session-store'
import { loadCache } from '@/lib/op-cache'

// GET /api/isl/sessions
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const taskId   = searchParams.get('taskId')
    const status   = searchParams.get('status')
    const validate = searchParams.get('needsValidation')

    let sessions = getAllSessions()
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

    const now  = new Date().toISOString()
    const date = (body.startedAt ?? now).slice(0, 10)

    // Upsert by sessionId
    const existing = body.sessionId ? getSessionBySessionId(body.sessionId) : null

    if (existing) {
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
      saveSession(updated)
      return NextResponse.json({ ok: true, session: updated })
    }

    const cache = loadCache()
    const session: SessionLog = {
      id:               createSessionId(),
      sessionId:        body.sessionId,
      userId:           body.userId ?? cache.userId ?? null,
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

    saveSession(session)
    return NextResponse.json({ ok: true, session })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
