import { NextResponse } from 'next/server'
import { getAllSessions, saveSession } from '@/lib/session-store'
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
  if (!clean.length) return [{ label: sessionTitle, bullets: [], mins: totalMins }]
  if (clean.length <= 2) return [{ label: sessionTitle, bullets: clean, mins: totalMins }]

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
  if (!OP_BASE || !OP_TOKEN) return NextResponse.json({ error: 'OP not configured' }, { status: 500 })

  const body = await req.json() as {
    sessionId: string
    action: 'create_new' | 'link_existing'
    bullets?: string[]
    opTaskId?: number
    newTask?: {
      subject: string
      projectId: number
      projectIdentifier: string
      parentId?: number | null
      sprintId?: number | null
      estimatedMins?: number
      typeId?: number
      userId?: number
    }
  }

  const session = (await getAllSessions()).find(s => s.id === body.sessionId)
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const headers = opHeaders()
  const date    = (session.startedAt ?? new Date().toISOString()).slice(0, 10)
  const mins    = session.actualMins ?? session.estimatedMins ?? 30

  let taskId: number | null = null   // main WP id stored in ISL (User Story when create_new)

  // ── link_existing ────────────────────────────────────────────────────────────
  if (body.action === 'link_existing') {
    if (!body.opTaskId) return NextResponse.json({ error: 'opTaskId required for link_existing' }, { status: 400 })

    const wpRes = await fetch(`${OP_BASE}/api/v3/work_packages/${body.opTaskId}`, { headers })
    if (!wpRes.ok) return NextResponse.json({ error: `OP task #${body.opTaskId} not found` }, { status: 404 })
    taskId = body.opTaskId

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

    // Time entry
    await fetch(`${OP_BASE}/api/v3/time_entries`, {
      method: 'POST', headers,
      body: JSON.stringify({
        hours: toISODuration(mins), spentOn: date,
        comment: { format: 'markdown', raw: `**${session.title}**\n\n⏱ ${durLabel(mins)} | 🤖 ISL Push Queue` },
        _links: { workPackage: { href: `/api/v3/work_packages/${taskId}` }, activity: { href: '/api/v3/time_entries/activities/1' } },
      }),
    }).catch(() => {})

  // ── create_new ───────────────────────────────────────────────────────────────
  } else if (body.action === 'create_new') {
    if (!body.newTask) return NextResponse.json({ error: 'newTask required for create_new' }, { status: 400 })

    const { subject, projectId, parentId, sprintId, estimatedMins, typeId = 1, userId = 8 } = body.newTask

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
      if (!tRes.ok) continue
      const task = await tRes.json()
      createdTasks.push({ id: task.id as number, subject: taskSubject, mins: group.mins })

      // Activity comment per task
      await fetch(`${OP_BASE}/api/v3/work_packages/${task.id}/activities`, {
        method: 'POST', headers,
        body: JSON.stringify({ comment: { format: 'markdown', raw: [
          `**Work Log — ${date}** | ${durLabel(group.mins)}`,
          '', ...group.bullets.map(b => `- ${b}`),
          `*Session: ${(session.sessionId ?? session.id).slice(0, 8)} · ISL*`,
        ].join('\n') } }),
      }).catch(() => {})
    }

    // ── Step 3: Time entry on User Story ───────────────────────────────────────
    await fetch(`${OP_BASE}/api/v3/time_entries`, {
      method: 'POST', headers,
      body: JSON.stringify({
        hours:   toISODuration(mins),
        spentOn: date,
        comment: { format: 'markdown', raw: `**${subject}**\n\n⏱ ${durLabel(mins)} · ${createdTasks.length} task(s) | 🤖 ISL Push Queue` },
        _links: {
          workPackage: { href: `/api/v3/work_packages/${usId}` },
          activity:    { href: '/api/v3/time_entries/activities/1' },
        },
      }),
    }).catch(() => {})

    // Return extra info about created structure
    const structureInfo = { usId, tasks: createdTasks }
    const updated = { ...session, opTaskId: usId, pushStatus: 'pushed' as const, autoPushed: false, needsValidation: false, updatedAt: new Date().toISOString() }
    await saveSession(updated)

    const tg = getTelegramConfig()
    if (tg) sendTelegram(notifPushed(session.title, usId, mins), tg).catch(() => {})

    return NextResponse.json({
      ok: true,
      taskId: usId,
      structure: structureInfo,
      opUrl: `${OP_BASE}/work_packages/${usId}`,
    })
  }

  if (!taskId) return NextResponse.json({ error: 'No task ID resolved' }, { status: 500 })

  // Update ISL session (for link_existing path)
  const updated = { ...session, opTaskId: taskId, pushStatus: 'pushed' as const, autoPushed: false, needsValidation: false, updatedAt: new Date().toISOString() }
  await saveSession(updated)

  const tg = getTelegramConfig()
  if (tg) sendTelegram(notifPushed(session.title, taskId, mins), tg).catch(() => {})

  return NextResponse.json({ ok: true, taskId, opUrl: `${OP_BASE}/work_packages/${taskId}` })
}
