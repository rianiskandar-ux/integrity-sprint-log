import { NextResponse } from 'next/server'
import { saveSession, createSessionId } from '@/lib/session-store'
import { getRequestContext } from '@/lib/request-auth'

// Wraps one or more EXISTING OP work packages (e.g. 2 Tasks + 1 Bug that came
// in together via Incoming) as children of a brand-new User Story, and
// optionally creates additional new breakdown Tasks under the same US.
// This is the one thing push-session's create_new flow can't do: it only
// ever creates brand-new work packages, never re-parents something that
// already exists in OP. See project-isl memory for why this route exists.

export async function POST(req: Request) {
  const ctx = await getRequestContext()
  // Login required — this route creates a User Story and re-parents existing OP
  // work packages. Without the gate an unauthenticated LAN caller hit the env
  // owner-token fallback and mutated OP structure as the owner.
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const OP_TOKEN = ctx.opToken
  const OP_BASE  = ctx.opBaseUrl
  if (!OP_BASE || !OP_TOKEN) return NextResponse.json({ error: 'OP not configured' }, { status: 500 })

  const body = await req.json() as {
    subject: string
    projectId: number
    existingWpIds: number[]
    newTaskSubjects?: string[]
    sprintId?: number | null
    userId?: number
    createSessions?: boolean
  }

  const subject = body.subject?.trim()
  if (!subject) return NextResponse.json({ error: 'subject required' }, { status: 400 })
  if (!body.projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  const existingWpIds = body.existingWpIds ?? []
  const newTaskSubjects = (body.newTaskSubjects ?? []).map(s => s.trim()).filter(Boolean)
  if (existingWpIds.length === 0 && newTaskSubjects.length === 0) {
    return NextResponse.json({ error: 'Need at least one existing ticket or one new task' }, { status: 400 })
  }

  const headers = {
    Authorization: 'Basic ' + Buffer.from(`apikey:${OP_TOKEN}`).toString('base64'),
    'Content-Type': 'application/json',
  }
  const date = new Date().toISOString().slice(0, 10)
  // Assignee = the authenticated caller. Never trust body.userId (client-controlled).
  const userId = ctx.opUserId ?? 0

  // If no sprint was explicitly given, inherit it from the first existing
  // ticket being wrapped — otherwise the new US ends up with NO version at
  // all (invisible in every sprint-scoped ISL view) while its re-parented
  // children keep whatever version they already had. Found 2026-07-09: a
  // real restructure left the US floating with version=none while its
  // child task showed "Sprint #119", making it look like only 1 lone task
  // existed instead of a US + task.
  let sprintId = body.sprintId ?? null
  if (!sprintId && existingWpIds.length > 0) {
    try {
      const firstRes = await fetch(`${OP_BASE}/api/v3/work_packages/${existingWpIds[0]}`, { headers })
      if (firstRes.ok) {
        const first = await firstRes.json()
        const versionHref = first._links?.version?.href as string | undefined
        if (versionHref) sprintId = Number(versionHref.split('/').pop())
      }
    } catch { /* fall through with no sprint — better than crashing the whole request */ }
  }

  const baseLinks: Record<string, { href: string } | undefined> = {
    project: { href: `/api/v3/projects/${body.projectId}` },
    status:  { href: '/api/v3/statuses/7' },
  }
  if (userId) baseLinks.assignee = { href: `/api/v3/users/${userId}` }
  if (sprintId) baseLinks.version = { href: `/api/v3/versions/${sprintId}` }

  // ── Step 1: Create the new User Story ────────────────────────────────────────
  const usDesc = [
    `**${subject}**`,
    '',
    `_Restrukturisasi via ISL — ${date}_`,
    existingWpIds.length > 0 ? `\nMenggabungkan tiket existing: ${existingWpIds.map(id => `#${id}`).join(', ')}` : '',
    newTaskSubjects.length > 0 ? `\nTask breakdown baru: ${newTaskSubjects.length}` : '',
  ].filter(Boolean).join('\n')

  const usRes = await fetch(`${OP_BASE}/api/v3/work_packages`, {
    method: 'POST', headers,
    body: JSON.stringify({
      subject: subject.slice(0, 255),
      description: { format: 'markdown', raw: usDesc },
      _links: { ...baseLinks, type: { href: '/api/v3/types/6' } },
    }),
  })
  if (!usRes.ok) {
    const err = await usRes.json().catch(() => ({}))
    return NextResponse.json({ error: (err as { message?: string }).message ?? `HTTP ${usRes.status}` }, { status: usRes.status })
  }
  const userStory = await usRes.json()
  const usId = userStory.id as number

  // ── Step 2: Re-parent existing work packages under the new US ───────────────
  const reparented: Array<{ id: number; ok: boolean; error?: string }> = []
  for (const wpId of existingWpIds) {
    try {
      const wpRes = await fetch(`${OP_BASE}/api/v3/work_packages/${wpId}`, { headers })
      if (!wpRes.ok) { reparented.push({ id: wpId, ok: false, error: `WP #${wpId} not found` }); continue }
      const wp = await wpRes.json()
      const patchRes = await fetch(`${OP_BASE}/api/v3/work_packages/${wpId}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({
          lockVersion: wp.lockVersion,
          _links: { parent: { href: `/api/v3/work_packages/${usId}` } },
        }),
      })
      if (!patchRes.ok) {
        const err = await patchRes.json().catch(() => ({}))
        reparented.push({ id: wpId, ok: false, error: (err as { message?: string }).message ?? `HTTP ${patchRes.status}` })
        continue
      }
      reparented.push({ id: wpId, ok: true })
      await fetch(`${OP_BASE}/api/v3/work_packages/${wpId}/activities`, {
        method: 'POST', headers,
        body: JSON.stringify({ comment: { format: 'markdown', raw: `🏗️ Direstrukturisasi ke bawah User Story **#${usId} ${subject}** — via ISL, ${date}` } }),
      }).catch(() => {})
    } catch (e) {
      reparented.push({ id: wpId, ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  }

  // ── Step 3: Create new breakdown Tasks under the same US ─────────────────────
  const newTasks: Array<{ id: number; subject: string }> = []
  for (const taskSubject of newTaskSubjects) {
    const tRes = await fetch(`${OP_BASE}/api/v3/work_packages`, {
      method: 'POST', headers,
      body: JSON.stringify({
        subject: taskSubject.slice(0, 255),
        description: { format: 'markdown', raw: `**${taskSubject}**\n\n_Breakdown task dari User Story #${usId} — via ISL, ${date}_` },
        _links: { ...baseLinks, type: { href: '/api/v3/types/1' }, parent: { href: `/api/v3/work_packages/${usId}` } },
      }),
    })
    if (!tRes.ok) continue
    const task = await tRes.json()
    newTasks.push({ id: task.id as number, subject: taskSubject })
  }

  // ── Step 4 (optional): mirror new breakdown tasks into ISL as sessions ──────
  // Tagged source:'op-restructure' so it's clearly distinguishable from
  // sessions captured locally (kafi/manual/etc.) — this data originated in OP.
  if (body.createSessions) {
    const now = new Date().toISOString()
    for (const t of newTasks) {
      await saveSession({
        id:            createSessionId(),
        userId:        ctx?.uid ?? null,
        date,
        title:         t.subject,
        bullets:       [],
        source:        'op-restructure',
        startedAt:     now,
        estimatedMins: 30,
        opTaskId:      t.id,
        opStoryId:     usId,
        pushStatus:    'pushed',
        createdAt:     now,
        updatedAt:     now,
      }).catch(() => {})
    }
  }

  return NextResponse.json({
    ok: true,
    usId,
    opUrl: `${OP_BASE}/work_packages/${usId}`,
    reparented,
    newTasks,
  })
}
