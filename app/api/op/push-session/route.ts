import { NextResponse } from 'next/server'
import { getAllSessions, saveSession, getSessionBySessionId } from '@/lib/session-store'
import { sendTelegram, getTelegramConfig, notifPushed } from '@/lib/telegram'

const OP_BASE  = process.env.OP_BASE_URL ?? ''
const OP_TOKEN = process.env.OP_API_TOKEN ?? ''

function toISODuration(minutes: number): string {
  const h = Math.floor(minutes / 60), m = minutes % 60
  return h > 0 ? `PT${h}H${m > 0 ? m + 'M' : ''}` : `PT${m}M`
}

function opHeaders() {
  return {
    Authorization: 'Basic ' + Buffer.from(`apikey:${OP_TOKEN}`).toString('base64'),
    'Content-Type': 'application/json',
  }
}

export async function POST(req: Request) {
  if (!OP_BASE || !OP_TOKEN) return NextResponse.json({ error: 'OP not configured' }, { status: 500 })

  const body = await req.json() as {
    sessionId: string           // ISL session id
    action: 'create_new' | 'link_existing'
    opTaskId?: number           // for link_existing
    newTask?: {
      subject: string
      projectId: number
      projectIdentifier: string
      parentId?: number | null
      sprintId?: number | null
      estimatedMins?: number
      typeId?: number           // 1=Task, 4=Feature, 7=Bug, 6=UserStory
      userId?: number
    }
  }

  const session = getAllSessions().find(s => s.id === body.sessionId)
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const headers = opHeaders()
  const date    = (session.startedAt ?? new Date().toISOString()).slice(0, 10)
  const mins    = session.actualMins ?? session.estimatedMins ?? 30

  let taskId: number | null = null

  if (body.action === 'link_existing') {
    if (!body.opTaskId) return NextResponse.json({ error: 'opTaskId required for link_existing' }, { status: 400 })
    // Verify WP exists
    const wpRes = await fetch(`${OP_BASE}/api/v3/work_packages/${body.opTaskId}`, { headers })
    if (!wpRes.ok) return NextResponse.json({ error: `OP task #${body.opTaskId} not found` }, { status: 404 })
    taskId = body.opTaskId

  } else if (body.action === 'create_new') {
    if (!body.newTask) return NextResponse.json({ error: 'newTask required for create_new' }, { status: 400 })

    const { subject, projectId, projectIdentifier, parentId, sprintId, estimatedMins, typeId = 1, userId = 8 } = body.newTask

    const descLines = [`**${subject}**`, '', 'Scope:', ...session.bullets.slice(0, 4).map(b => `- ${b}`), '', `*Created via ISL — ${date}*`]
    const links: Record<string, { href: string }> = {
      type:     { href: `/api/v3/types/${typeId}` },
      status:   { href: '/api/v3/statuses/7' },          // In Progress
      project:  { href: `/api/v3/projects/${projectId}` },
      assignee: { href: `/api/v3/users/${userId}` },
    }
    if (parentId)  links.parent  = { href: `/api/v3/work_packages/${parentId}` }
    if (sprintId)  links.version = { href: `/api/v3/versions/${sprintId}` }
    if (projectIdentifier === 'scrum-project') links.customField6 = { href: '/api/v3/custom_options/12' }

    const createRes = await fetch(`${OP_BASE}/api/v3/work_packages`, {
      method: 'POST', headers,
      body: JSON.stringify({
        subject,
        description:   { format: 'markdown', raw: descLines.join('\n') },
        estimatedTime: toISODuration(estimatedMins ?? mins),
        _links: links,
      }),
    })
    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}))
      return NextResponse.json({ error: (err as { message?: string }).message ?? `HTTP ${createRes.status}` }, { status: createRes.status })
    }
    const wp = await createRes.json()
    taskId = wp.id as number
  }

  if (!taskId) return NextResponse.json({ error: 'No task ID resolved' }, { status: 500 })

  // Post activity comment
  const h = Math.floor(mins / 60), m = mins % 60
  const durLabel = mins >= 60 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${mins}m`
  const activityLines = [
    `**Work Log — ${date}** | ${durLabel}`,
    '',
    ...session.bullets.map(b => `- ${b}`),
    `*Session: ${(session.sessionId ?? session.id).slice(0, 8)} · via ISL Push Queue*`,
  ]
  await fetch(`${OP_BASE}/api/v3/work_packages/${taskId}/activities`, {
    method: 'POST', headers,
    body: JSON.stringify({ comment: { format: 'markdown', raw: activityLines.join('\n') } }),
  }).catch(() => {})

  // Time entry
  await fetch(`${OP_BASE}/api/v3/time_entries`, {
    method: 'POST', headers,
    body: JSON.stringify({
      hours: toISODuration(mins), spentOn: date,
      comment: { format: 'markdown', raw: `**${session.title}**\n\n⏱ ${durLabel} | 🤖 ISL Push Queue` },
      _links: { workPackage: { href: `/api/v3/work_packages/${taskId}` }, activity: { href: '/api/v3/time_entries/activities/1' } },
    }),
  }).catch(() => {})

  // Update ISL session
  const updated = { ...session, opTaskId: taskId, pushStatus: 'pushed' as const, autoPushed: false, needsValidation: false, updatedAt: new Date().toISOString() }
  saveSession(updated)

  // Telegram notification — fire and forget
  const tg = getTelegramConfig()
  if (tg) sendTelegram(notifPushed(session.title, taskId, mins), tg).catch(() => {})

  return NextResponse.json({ ok: true, taskId, opUrl: `${OP_BASE}/work_packages/${taskId}` })
}
