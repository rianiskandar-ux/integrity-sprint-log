import { NextResponse } from 'next/server'
import { getAllSessions, saveSession, type SessionLog } from '@/lib/session-store'
import { sendTelegram, getTelegramConfig, notifPushed } from '@/lib/telegram'
import { getRequestContext } from '@/lib/request-auth'
import { db, agentEvents, arkaCorrections } from '@/lib/db'
import { upsertEmbedding } from '@/lib/embeddings'

// ── Arka Correction Loop v1 ───────────────────────────────────────────────────
// This route is the single choke point where a session's opTaskId — already
// set once by Arka's hook-side matcher (findMatchingTask in isl-context.mjs,
// or left null for a 'hub' session) — gets finalized/changed by Rian during
// triage (Push Queue "link existing" or "create new"). Whenever the final
// taskId differs from what was already stored on the session, that's a
// correction signal: log it durably + make it retrievable via hybridSearch
// (same embeddings table/search used everywhere else — no new search infra).
async function logCorrection(session: SessionLog, newTaskId: number) {
  const oldTaskId = session.opTaskId ?? null
  if (oldTaskId === newTaskId) return

  const correctionId = `corr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  try {
    await db.insert(arkaCorrections).values({
      id:              correctionId,
      sessionId:       session.id,
      sessionTitle:    session.title,
      sessionBullets:  session.bullets ?? [],
      arkaGuessTaskId: oldTaskId,
      correctedTaskId: newTaskId,
    })
  } catch (e) {
    console.warn('[arka-correction] insert failed:', e instanceof Error ? e.message : e)
    return // don't embed/log an event for a correction that never landed
  }

  // Durable event log (Scorecard) — fire-and-forget, never blocks the route
  db.insert(agentEvents).values({
    id:    `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    agent: 'arka',
    event: 'correction',
    meta:  { sessionId: session.id, arkaGuessTaskId: oldTaskId, correctedTaskId: newTaskId },
  }).catch(() => {})

  // Retrievable via the SAME hybridSearch used everywhere else — fire-and-forget
  upsertEmbedding({
    userId:     null,
    sourceType: 'correction',
    sourceId:   `correction-${correctionId}`,
    title:      `Koreksi Arka: ${session.title}`,
    chunk:      `Sesi ini SEHARUSNYA di-assign ke task berbeda dari tebakan awal. Judul sesi: ${session.title}. Detail: ${(session.bullets ?? []).join('; ')}. Tebakan salah: task #${oldTaskId}. Koreksi benar: task #${newTaskId}.`,
  }).catch(() => {})
}

function toISODuration(minutes: number): string {
  const h = Math.floor(minutes / 60), m = minutes % 60
  return h > 0 ? `PT${h}H${m > 0 ? m + 'M' : ''}` : `PT${m}M`
}

function durLabel(mins: number): string {
  const h = Math.floor(mins / 60), m = mins % 60
  return mins >= 60 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${mins}m`
}

// ─── Bullet clustering ────────────────────────────────────────────────────────

interface TaskGroup { label: string; bullets: string[]; mins: number }
interface ClusterResult { groups: TaskGroup[]; needsEpic: boolean }

const THEMES: Array<{ label: string; keywords: string[] }> = [
  { label: 'Setup & Configuration',  keywords: ['setup', 'install', 'config', 'init', 'docker', 'env', 'nginx', 'apache', 'server', 'database', 'migration'] },
  { label: 'Investigation & Debug',  keywords: ['debug', 'diagnos', 'investigate', 'analyz', 'identif', 'found', 'trace', 'inspect', 'diagnosa'] },
  { label: 'Fix & Repair',           keywords: ['fix', 'repair', 'resolve', 'patch', 'correct', 'solve', 'bug', 'error', 'broken', 'gagal', 'rusak'] },
  { label: 'Implementation',         keywords: ['implement', 'create', 'build', 'develop', 'write', 'code', 'buat', 'tambah', 'feature', 'fitur', 'integrasi'] },
  { label: 'Update & Refactor',      keywords: ['update', 'upgrade', 'change', 'modify', 'refactor', 'improve', 'enhance', 'optimize', 'edit', 'ubah'] },
  { label: 'Deploy & Release',       keywords: ['deploy', 'push to', 'release', 'publish', 'launch', 'production', 'staging', 'commit', 'merge'] },
  { label: 'Test & Verification',    keywords: ['test', 'verify', 'check', 'validate', 'confirm', 'review', 'audit', 'cek'] },
]

function clusterIntoTasks(sessionTitle: string, bullets: string[], totalMins: number): ClusterResult {
  const clean = bullets.filter(b => b.trim())
  if (!clean.length) return { groups: [{ label: sessionTitle, bullets: [], mins: totalMins }], needsEpic: false }
  if (clean.length <= 2) return { groups: [{ label: sessionTitle, bullets: clean, mins: totalMins }], needsEpic: false }

  // Parse time prefixes [Xm] for proportional distribution
  const parsed = clean.map(b => {
    const m = b.match(/^\[(\d+)m\]\s*(.*)/)
    return { original: b, text: m ? m[2] : b, mins: m ? parseInt(m[1]) : null }
  })

  // Assign to themes
  const buckets: Record<string, typeof parsed> = {}
  const unmatched: typeof parsed = []
  for (const item of parsed) {
    const lower = item.text.toLowerCase()
    let hit = false
    for (const theme of THEMES) {
      if (theme.keywords.some(k => lower.includes(k))) {
        if (!buckets[theme.label]) buckets[theme.label] = []
        buckets[theme.label].push(item)
        hit = true
        break
      }
    }
    if (!hit) unmatched.push(item)
  }

  let groups: Array<{ label: string; items: typeof parsed }> = []
  for (const [label, items] of Object.entries(buckets)) {
    if (items.length > 0) groups.push({ label, items })
  }
  if (unmatched.length > 0) {
    if (groups.length === 0) {
      // All unmatched — split sequentially into chunks of 3
      const chunkSize = Math.max(1, Math.ceil(unmatched.length / Math.min(5, Math.ceil(unmatched.length / 3))))
      for (let i = 0; i < unmatched.length; i += chunkSize) {
        groups.push({ label: `Work Block ${Math.floor(i / chunkSize) + 1}`, items: unmatched.slice(i, i + chunkSize) })
      }
    } else {
      // Attach unmatched to the largest existing group (avoids tiny orphan group)
      groups.sort((a, b) => b.items.length - a.items.length)
      groups[0].items.push(...unmatched)
    }
  }

  // Track if Epic is needed (>5 groups before merging)
  const needsEpic = groups.length > 5

  // Merge down to max 5 groups
  while (groups.length > 5) {
    groups.sort((a, b) => a.items.length - b.items.length)
    const [a, b] = groups.splice(0, 2)
    groups.push({ label: a.label, items: [...a.items, ...b.items] })
  }

  // Split any group that has >8 bullets into 2
  const final: typeof groups = []
  for (const g of groups) {
    if (g.items.length > 8) {
      const half = Math.ceil(g.items.length / 2)
      final.push({ label: `${g.label} (Part 1)`, items: g.items.slice(0, half) })
      final.push({ label: `${g.label} (Part 2)`, items: g.items.slice(half) })
    } else {
      final.push(g)
    }
  }

  // Proportional time distribution
  const totalParsedMins = parsed.reduce((s, x) => s + (x.mins ?? 0), 0)
  const taskGroups = final.map(g => {
    const groupParsedMins = g.items.reduce((s, x) => s + (x.mins ?? 0), 0)
    const taskMins = totalParsedMins > 0
      ? Math.max(1, Math.round(groupParsedMins / totalParsedMins * totalMins))
      : Math.max(1, Math.round(totalMins / final.length))
    return { label: g.label, bullets: g.items.map(i => i.original), mins: taskMins }
  })
  return { groups: taskGroups, needsEpic }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const ctx = await getRequestContext()
  // Login required. Without this gate an unauthenticated LAN caller reached the
  // env owner-token fallback below and created/commented/logged-time in OP AS
  // THE OWNER, and getAllSessions(undefined) returned every user's sessions.
  // (Single-user mode still works: getRequestContext synthesizes a ctx whose
  // opToken IS the env token, so no explicit env fallback is needed here.)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const OP_TOKEN = ctx.opToken
  const OP_BASE  = ctx.opBaseUrl
  if (!OP_BASE || !OP_TOKEN) return NextResponse.json({ error: 'OP not configured' }, { status: 500 })

  const body = await req.json() as {
    sessionId: string
    action: 'create_new' | 'link_existing'
    bullets?: string[]
    opTaskId?: number
    loggedMins?: number     // explicit worklog minutes chosen by the user (estimate vs actual)
    estimatedMins?: number  // estimate to back-fill on an existing Task that has none
    newTask?: {
      subject: string
      projectId: number
      projectIdentifier: string
      parentId?: number | null
      newParent?: { subject: string; typeId: number } | null
      sprintId?: number | null
      estimatedMins?: number
      typeId?: number
      userId?: number
      relatesTo?: number | null
    }
  }

  const session = (await getAllSessions(ctx?.uid)).find(s => s.id === body.sessionId)
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const headers = {
    Authorization: 'Basic ' + Buffer.from(`apikey:${OP_TOKEN}`).toString('base64'),
    'Content-Type': 'application/json',
  }
  const date    = (session.startedAt ?? new Date().toISOString()).slice(0, 10)
  // Worklog (spent time) logged to OP. User's explicit choice (estimate/actual) wins;
  // else fall back to actual-if-measured, then estimate.
  // Use `|| null` so loggedMins=0 (timer not running) falls through to estimatedMins.
  const mins    = (body.loggedMins || null) ?? session.actualMins ?? session.estimatedMins ?? 30

  let taskId: number | null = null   // main WP id stored in ISL (User Story when create_new)
  // Track whether the ACTUAL work record (time entries) + task creation truly
  // landed in OP. Previously these were fire-and-forget (.catch(()=>{}), no
  // res.ok) yet the session was still marked 'pushed' — so a failed worklog or
  // a dropped task group left ISL showing "pushed" while OP had no time logged
  // (confirmed bug, audit 2026-07-22). Now a failure flags the session
  // needsValidation and surfaces a warning instead of claiming clean success.
  let worklogOk = true
  let failedGroups = 0
  const pushWarnings: string[] = []

  // ── link_existing ────────────────────────────────────────────────────────────
  if (body.action === 'link_existing') {
    if (!body.opTaskId) return NextResponse.json({ error: 'opTaskId required for link_existing' }, { status: 400 })

    const wpRes = await fetch(`${OP_BASE}/api/v3/work_packages/${body.opTaskId}`, { headers })
    if (!wpRes.ok) return NextResponse.json({ error: `OP task #${body.opTaskId} not found` }, { status: 404 })
    const wp = await wpRes.json() as { lockVersion?: number; estimatedTime?: string | null; _links?: { type?: { title?: string } } }
    taskId = body.opTaskId

    // Back-fill the estimate so a worked Task never stays estimate-less in OP. Only
    // for type Task with no existing estimate (Feature/Epic/US left untouched). Use the
    // session's estimate (NOT the worklog minutes).
    const estMins = body.estimatedMins ?? session.estimatedMins ?? 60
    if (estMins > 0 && !wp.estimatedTime && wp._links?.type?.title === 'Task') {
      await fetch(`${OP_BASE}/api/v3/work_packages/${taskId}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ lockVersion: wp.lockVersion, estimatedTime: toISODuration(estMins) }),
      }).catch(() => {})
    }

    // Activity comment
    const bulletLines = (body.bullets?.length ? body.bullets : session.bullets).map(b => `- ${b}`)
    await fetch(`${OP_BASE}/api/v3/work_packages/${taskId}/activities`, {
      method: 'POST', headers,
      body: JSON.stringify({ comment: { format: 'markdown', raw: [
        `**Work Log — ${date}** | ${durLabel(mins)}`,
        '', ...bulletLines,
        `*Session: ${(session.sessionId ?? session.id).slice(0, 8)} · via ISL Push Queue*`,
      ].join('\n') } }),
    }).catch(() => {})

    // Time entry — verify it actually landed (this is the worklog record).
    const teRes = await fetch(`${OP_BASE}/api/v3/time_entries`, {
      method: 'POST', headers,
      body: JSON.stringify({
        hours: toISODuration(mins), spentOn: date,
        comment: { format: 'markdown', raw: `**${session.title}**\n\n⏱ ${durLabel(mins)} | 🤖 ISL Push Queue` },
        _links: { workPackage: { href: `/api/v3/work_packages/${taskId}` }, activity: { href: '/api/v3/time_entries/activities/1' } },
      }),
    }).catch(() => null)
    if (!teRes || !teRes.ok) {
      worklogOk = false
      pushWarnings.push(`Time entry (${durLabel(mins)}) gagal tercatat di OP${teRes ? ` (HTTP ${teRes.status})` : ' (network)'} — sesi ditandai perlu validasi, worklog belum masuk OP.`)
    }

  // ── create_new ───────────────────────────────────────────────────────────────
  } else if (body.action === 'create_new') {
    if (!body.newTask) return NextResponse.json({ error: 'newTask required for create_new' }, { status: 400 })

    const { subject, projectId, parentId: pickedParentId, newParent, sprintId, estimatedMins, typeId = 1, userId = ctx?.opUserId ?? 0 } = body.newTask
    let parentId = pickedParentId ?? null

    // Create a brand-new parent (Epic/Feature) first, if requested, and use it as parent
    if (newParent?.subject?.trim()) {
      const npRes = await fetch(`${OP_BASE}/api/v3/work_packages`, {
        method: 'POST', headers,
        body: JSON.stringify({
          subject: newParent.subject.trim().slice(0, 255),
          description: { format: 'markdown', raw: `_Auto-created parent via ISL — ${date}_` },
          _links: {
            project: { href: `/api/v3/projects/${projectId}` },
            type:    { href: `/api/v3/types/${newParent.typeId}` },
          },
        }),
      })
      if (npRes.ok) { const np = await npRes.json(); parentId = np.id as number }
    }

    const bullets = body.bullets?.length ? body.bullets : session.bullets
    const { groups, needsEpic } = clusterIntoTasks(subject, bullets, mins)
    const isSingle = groups.length === 1

    // Build shared link template
    const baseLinks: Record<string, { href: string } | undefined> = {
      project:  { href: `/api/v3/projects/${projectId}` },
      status:   { href: '/api/v3/statuses/7' },
      assignee: { href: `/api/v3/users/${userId}` },
    }
    if (sprintId) baseLinks.version = { href: `/api/v3/versions/${sprintId}` }

    // ── Step 0: Create Epic if needed (>5 task groups) ────────────────────────
    let epicId: number | null = null
    if (needsEpic) {
      const epicLinks = { ...baseLinks, type: { href: '/api/v3/types/5' } }
      if (parentId) (epicLinks as Record<string, { href: string } | undefined>).parent = { href: `/api/v3/work_packages/${parentId}` }
      const epicRes = await fetch(`${OP_BASE}/api/v3/work_packages`, {
        method: 'POST', headers,
        body: JSON.stringify({
          subject: subject.slice(0, 255),
          description: { format: 'markdown', raw: `**Epic: ${subject}**\n\n_Auto-created from ISL — ${date}_\n\nCovers ${groups.length} task groups.` },
          estimatedTime: toISODuration(estimatedMins ?? mins),
          _links: epicLinks,
        }),
      })
      if (epicRes.ok) { const epic = await epicRes.json(); epicId = epic.id as number }
    }

    // ── Step 1: Create User Story ──────────────────────────────────────────────
    const usLinks: Record<string, { href: string } | undefined> = { ...baseLinks, type: { href: '/api/v3/types/6' } }
    if (epicId) usLinks.parent = { href: `/api/v3/work_packages/${epicId}` }
    else if (parentId) usLinks.parent = { href: `/api/v3/work_packages/${parentId}` }

    const usDesc = isSingle
      ? `**${subject}**\n\n${bullets.map(b => `- ${b}`).join('\n')}\n\n_${date} · via ISL_`
      : `**${subject}**\n\n_Auto-created from ISL — ${date}_\n\n**Task breakdown:**\n${groups.map((g, i) => `${i + 1}. ${g.label} (${durLabel(g.mins)})`).join('\n')}`

    const usRes = await fetch(`${OP_BASE}/api/v3/work_packages`, {
      method: 'POST', headers,
      body: JSON.stringify({
        subject: subject.slice(0, 255),
        description:   { format: 'markdown', raw: usDesc },
        estimatedTime: toISODuration(estimatedMins ?? mins),
        _links: usLinks,
      }),
    })
    if (!usRes.ok) {
      const err = await usRes.json().catch(() => ({}))
      return NextResponse.json({ error: (err as { message?: string }).message ?? `HTTP ${usRes.status}` }, { status: usRes.status })
    }
    const userStory = await usRes.json()
    const usId = userStory.id as number
    taskId = usId

    // ── Step 1.5: Add "relates" relation if requested ─────────────────────────
    if (body.newTask.relatesTo) {
      await fetch(`${OP_BASE}/api/v3/work_packages/${usId}/relations`, {
        method: 'POST', headers,
        body: JSON.stringify({
          _links: { to: { href: `/api/v3/work_packages/${body.newTask.relatesTo}` } },
          type: 'relates',
        }),
      }).catch(() => {})
    }

    // ── Step 2: Create Tasks under User Story ──────────────────────────────────
    const createdTasks: Array<{ id: number; subject: string; mins: number }> = []

    for (const group of groups) {
      const taskSubject = isSingle ? subject : `${subject} — ${group.label}`
      const taskLinks = {
        ...baseLinks,
        type:   { href: `/api/v3/types/${typeId}` },
        parent: { href: `/api/v3/work_packages/${usId}` },
      }
      const taskDesc = [
        `**${taskSubject}**`, '',
        ...group.bullets.map(b => `- ${b}`),
        '', `_${date} · via ISL_`,
      ].join('\n')

      const tRes = await fetch(`${OP_BASE}/api/v3/work_packages`, {
        method: 'POST', headers,
        body: JSON.stringify({
          subject:       taskSubject.slice(0, 255),
          description:   { format: 'markdown', raw: taskDesc },
          estimatedTime: toISODuration(group.mins),
          _links:        taskLinks,
        }),
      })
      if (!tRes.ok) {
        // Don't silently drop the group — its bullets + minutes would vanish
        // with no signal. Count it so the session is flagged, not marked clean.
        failedGroups++
        pushWarnings.push(`Task "${group.label}" (${durLabel(group.mins)}) gagal dibuat di OP (HTTP ${tRes.status}) — bullet & waktunya belum tercatat.`)
        continue
      }
      const task = await tRes.json()
      const taskId_ = task.id as number
      createdTasks.push({ id: taskId_, subject: taskSubject, mins: group.mins })

      // Activity comment per task
      await fetch(`${OP_BASE}/api/v3/work_packages/${taskId_}/activities`, {
        method: 'POST', headers,
        body: JSON.stringify({ comment: { format: 'markdown', raw: [
          `**Work Log — ${date}** | ${durLabel(group.mins)}`,
          '', ...group.bullets.map(b => `- ${b}`),
          `*Session: ${(session.sessionId ?? session.id).slice(0, 8)} · ISL*`,
        ].join('\n') } }),
      }).catch(() => {})

      // ── Time entry per Task (proportional) — logged here, not on US ──────────
      const teRes = await fetch(`${OP_BASE}/api/v3/time_entries`, {
        method: 'POST', headers,
        body: JSON.stringify({
          hours:   toISODuration(group.mins),
          spentOn: date,
          comment: { format: 'markdown', raw: `**${taskSubject}**\n\n⏱ ${durLabel(group.mins)} | 🤖 ISL Push Queue` },
          _links: {
            workPackage: { href: `/api/v3/work_packages/${taskId_}` },
            activity:    { href: '/api/v3/time_entries/activities/1' },
          },
        }),
      }).catch(() => null)
      if (!teRes || !teRes.ok) {
        worklogOk = false
        pushWarnings.push(`Time entry untuk "${group.label}" (${durLabel(group.mins)}) gagal di OP${teRes ? ` (HTTP ${teRes.status})` : ' (network)'} — waktunya belum tercatat.`)
      }
    }

    // Return extra info about created structure
    const structureInfo = { usId, tasks: createdTasks }
    await logCorrection(session, usId)
    // A dropped task group or a failed worklog means the push is NOT clean —
    // keep the session flagged (needsValidation) so it stays visible for
    // fixing, rather than silently reporting full success.
    const cleanPush = failedGroups === 0 && worklogOk && createdTasks.length > 0
    const updated = { ...session, opTaskId: usId, pushStatus: 'pushed' as const, autoPushed: false, needsValidation: !cleanPush, updatedAt: new Date().toISOString() }
    await saveSession(updated)

    const tg = getTelegramConfig()
    if (tg) sendTelegram(notifPushed(session.title, usId, mins), tg).catch(() => {})

    return NextResponse.json({
      ok: true,
      taskId: usId,
      structure: structureInfo,
      worklogOk: cleanPush,
      warnings: pushWarnings.length ? pushWarnings : undefined,
      opUrl: `${OP_BASE}/work_packages/${usId}`,
    })
  }

  if (!taskId) return NextResponse.json({ error: 'No task ID resolved' }, { status: 500 })

  // Update ISL session (for link_existing path). If the worklog time entry
  // failed, keep the session flagged (needsValidation) + warn — don't report a
  // clean 'pushed' when OP has no logged time.
  await logCorrection(session, taskId)
  const updated = { ...session, opTaskId: taskId, pushStatus: 'pushed' as const, autoPushed: false, needsValidation: !worklogOk, updatedAt: new Date().toISOString() }
  await saveSession(updated)

  const tg = getTelegramConfig()
  if (tg) sendTelegram(notifPushed(session.title, taskId, mins), tg).catch(() => {})

  return NextResponse.json({ ok: true, taskId, worklogOk, warnings: pushWarnings.length ? pushWarnings : undefined, opUrl: `${OP_BASE}/work_packages/${taskId}` })
}
