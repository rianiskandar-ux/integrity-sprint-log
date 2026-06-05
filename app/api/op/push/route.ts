import { NextResponse } from 'next/server'

interface PushPayload {
  title: string
  time: string
  bullets: string[]
  date: string
  userSettings: {
    userId: number
    userHref: string
    defaultAccountableId: number | null
    defaultProjectIdentifier: string
    defaultVersionId: number | null
    opApiToken: string
  }
}

const TYPE_IDS = { task: 1, bug: 7, feature: 4 }
const STATUS_IN_PROGRESS = 7

function detectProject(title: string, bullets: string[]): { id: number; href: string; identifier: string } {
  const text = [title, ...bullets].join(' ').toLowerCase()
  const map: Array<{ keywords: string[]; id: number; identifier: string }> = [
    { id: 20, identifier: 'know-your-vendor-kyv',               keywords: ['kyv', 'know your vendor', 'knowyourvendor'] },
    { id: 11, identifier: 'knowme',                             keywords: ['knowme', 'know me'] },
    { id: 25, identifier: 'omnibot-omni-channel-with-chatbot',  keywords: ['omnibot', 'chatbot', 'omni', 'crisp'] },
    { id: 9,  identifier: 'phoenix',                            keywords: ['phoenix', 'wbs', 'customer portal'] },
    { id: 10, identifier: 'minerva',                            keywords: ['minerva', 'minerva-global'] },
    { id: 40, identifier: 'services-websites',                  keywords: ['integrity asia', 'integrity indonesia', 'integrity malaysia', 'integrity thailand', 'headless'] },
    { id: 12, identifier: 'integritys-websites',                keywords: ['kyv', 'eduverif', 'empverif', 'minerva', 'wordpress', 'laragon', 'daily-sprint', 'portal', 'education', 'employment'] },
  ]
  for (const p of map) {
    if (p.keywords.some((k) => text.includes(k))) return { ...p, href: `/api/v3/projects/${p.id}` }
  }
  return { id: 12, identifier: 'integritys-websites', href: '/api/v3/projects/12' }
}

function detectType(title: string): keyof typeof TYPE_IDS {
  const t = title.toLowerCase()
  if (/bug|fix|error|crash|broken|gagal|rusak|fail/.test(t)) return 'bug'
  if (/feature|fitur|tambah|implement|buat/.test(t)) return 'feature'
  return 'task'
}

function estimateMinutes(title: string, bullets: string[]): number {
  const count = bullets.filter(Boolean).length
  const t = title.toLowerCase()
  if (/deploy|migrate|setup docker|setup server/.test(t)) return 120
  if (/debug|diagnos|troubleshoot/.test(t)) return 90
  if (/fix|update|config/.test(t)) return 45
  if (count >= 5) return 90
  if (count >= 3) return 60
  return 30
}

function toISODuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `PT${h}H${m > 0 ? m + 'M' : ''}` : `PT${m}M`
}

function timeToMinutes(timeStr: string): number {
  const m = timeStr.match(/(\d{1,2})[:.:](\d{2})/)
  if (!m) return 0
  return parseInt(m[1]) * 60 + parseInt(m[2])
}

async function opFetch(base: string, token: string, path: string, options: RequestInit = {}) {
  const res = await fetch(`${base}/api/v3${path}`, {
    ...options,
    headers: {
      Authorization: 'Basic ' + Buffer.from(`apikey:${token}`).toString('base64'),
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OP ${res.status}: ${err}`)
  }
  return res.json()
}

async function findOrCreateUserStory(
  base: string, token: string,
  projectHref: string, projectId: number,
  title: string, userHref: string
) {
  // Search for existing User Story with similar subject in this project
  const filters = encodeURIComponent(JSON.stringify([
    { project: { operator: '=', values: [String(projectId)] } },
    { type: { operator: '=', values: ['6'] } },
    { status: { operator: '!', values: ['12', '14'] } }, // not closed/rejected
  ]))
  const res = await opFetch(base, token, `/work_packages?filters=${filters}&pageSize=20&sortBy=${encodeURIComponent('[["updatedAt","desc"]]')}`)
  const existing = res._embedded?.elements ?? []

  // Try to find an existing User Story that matches by keyword
  const words = title.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
  const match = existing.find((wp: Record<string, unknown>) => {
    const subj = (wp.subject as string).toLowerCase()
    return words.some((w) => subj.includes(w))
  })
  if (match) return match as { id: number; subject: string; _links: { self: { href: string } } }

  // Create new User Story
  const body = {
    subject: title,
    description: { format: 'markdown', raw: `_Auto-created dari Daily Sprint App_\n\n**Tanggal:** ${new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}` },
    _links: {
      project:    { href: projectHref },
      type:       { href: '/api/v3/types/6' },
      assignee:   { href: userHref },
      status:     { href: '/api/v3/statuses/7' },
    },
  }
  return opFetch(base, token, '/work_packages', { method: 'POST', body: JSON.stringify(body) })
}

export async function POST(req: Request) {
  try {
    const payload: PushPayload = await req.json()
    const { title, time, bullets, date, userSettings } = payload

    const token = userSettings.opApiToken || process.env.OP_API_TOKEN
    const base  = process.env.OP_BASE_URL
    if (!token || !base) return NextResponse.json({ error: 'OP not configured' }, { status: 500 })

    const project  = detectProject(title, bullets)
    const type     = detectType(title)
    const estMins  = estimateMinutes(title, bullets)
    const spentMin = timeToMinutes(time)

    // 1. Find or create User Story
    const userStory = await findOrCreateUserStory(base, token, project.href, project.id, title, userSettings.userHref)

    // 2. Find current sprint version if not set
    let versionHref: string | null = null
    if (userSettings.defaultVersionId) {
      versionHref = `/api/v3/versions/${userSettings.defaultVersionId}`
    } else {
      try {
        const today = date
        const vers = await opFetch(base, token, `/projects/${project.identifier}/versions?pageSize=30`)
        const cur = (vers._embedded?.elements ?? []).find(
          (v: Record<string, string>) => v.startDate <= today && v.endDate >= today
        )
        if (cur) versionHref = `/api/v3/versions/${cur.id}`
      } catch { /* skip */ }
    }

    // 3. Build description from bullets
    const descRaw = bullets.filter(Boolean).map((b) => `- ${b}`).join('\n')
      || '_Auto-generated dari Daily Sprint App_'

    // 4. Create Task as child of User Story
    const taskLinks: Record<string, { href: string }> = {
      project:  { href: project.href },
      type:     { href: `/api/v3/types/${TYPE_IDS[type]}` },
      status:   { href: `/api/v3/statuses/${STATUS_IN_PROGRESS}` },
      assignee: { href: userSettings.userHref },
      parent:   { href: `/api/v3/work_packages/${userStory.id}` },
    }
    if (userSettings.defaultAccountableId) {
      taskLinks.accountable = { href: `/api/v3/users/${userSettings.defaultAccountableId}` }
    }
    if (versionHref) {
      taskLinks.version = { href: versionHref }
    }

    const taskBody = {
      subject:       title,
      description:   { format: 'markdown', raw: descRaw },
      estimatedTime: toISODuration(estMins),
      _links:        taskLinks,
    }

    const task = await opFetch(base, token, '/work_packages', { method: 'POST', body: JSON.stringify(taskBody) })

    // 5. Log time entry if we have session time
    let timeEntryId: number | null = null
    if (spentMin > 0) {
      try {
        const teBody = {
          hours:   toISODuration(spentMin),
          spentOn: date,
          comment: { format: 'plain', raw: `Session: ${title}` },
          _links:  {
            workPackage: { href: `/api/v3/work_packages/${task.id}` },
            project:     { href: project.href },
          },
        }
        const te = await opFetch(base, token, '/time_entries', { method: 'POST', body: JSON.stringify(teBody) })
        timeEntryId = te.id
      } catch { /* time entry optional */ }
    }

    return NextResponse.json({
      ok: true,
      userStoryId:   userStory.id,
      userStoryNew:  !userStory._links,
      taskId:        task.id,
      taskSubject:   task.subject,
      projectName:   project.identifier,
      estimatedMins: estMins,
      timeEntryId,
      opUrl:         `${base}/work_packages/${task.id}`,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
