import { NextResponse } from 'next/server'
import { saveSession, createSessionId, type SessionLog } from '@/lib/session-store'
import { OWNER_UID } from '@/lib/auth'

export const runtime = 'nodejs'

function verifyKey(req: Request): boolean {
  const key = process.env.KAFI_API_KEY || 'kafi-bridge-2026'
  return req.headers.get('x-kafi-key') === key
}

export async function POST(req: Request) {
  if (!verifyKey(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { title, bullets, date, actualMins, opTaskId } = body

  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 })

  const now = new Date().toISOString()
  const sessionDate = date ?? now.slice(0, 10)

  const session: SessionLog = {
    id:               createSessionId(),
    sessionId:        `kafi-${Date.now()}`,
    userId:           OWNER_UID,
    date:             sessionDate,
    title:            String(title),
    bullets:          Array.isArray(bullets) ? bullets : [],
    source:           'kafi',
    startedAt:        now,
    endedAt:          now,
    actualMins:       typeof actualMins === 'number' ? actualMins : null,
    estimatedMins:    30,
    opTaskId:         opTaskId ?? null,
    opStoryId:        null,
    opEpicId:         null,
    isNewTask:        false,
    taskStatus:       'completed',
    aiStatus:         null,
    hasExplicitCmd:   false,
    needsValidation:  false,
    command:          null,
    ticketBinding:    null,
    relatedOldTaskId: null,
    tokenUsage:       null,
    pushStatus:       'hub' as const,
    autoPushed:       true,
    undoneAt:         null,
    createdAt:        now,
    updatedAt:        now,
  }

  await saveSession(session)

  return NextResponse.json({ ok: true, sessionId: session.id, pushStatus: 'hub' })
}
