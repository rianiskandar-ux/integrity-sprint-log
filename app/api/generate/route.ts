import { getOpToken, getOpBaseUrl } from '@/lib/user-config'
import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { getSprintDir } from '@/lib/parser'
import { getAllSessions } from '@/lib/session-store'

const OP_BASE = getOpBaseUrl()
const OP_TOKEN = getOpToken()

// All projects to query for daily activity
const OP_PROJECTS = [
  process.env.OP_PROJECT_ID ?? 'integritys-websites',
  'scrum-project',
].filter(Boolean)

async function opGet(endpoint: string) {
  const res = await fetch(`${OP_BASE}/api/v3${endpoint}`, {
    headers: {
      Authorization: 'Basic ' + Buffer.from(`apikey:${OP_TOKEN}`).toString('base64'),
      'Content-Type': 'application/json',
    },
    next: { revalidate: 0 },
  })
  if (!res.ok) return null
  return res.json()
}

export async function POST(req: Request) {
  const { date, force } = await req.json()
  const today = date ?? new Date().toISOString().slice(0, 10)
  const dir = getSprintDir()
  const filePath = path.join(dir, `${today}.md`)

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  // Pull OpenProject data from all projects
  const wpMap = new Map<number, string>()

  for (const projectId of OP_PROJECTS) {
    const filters = JSON.stringify([
      { project:    { operator: '=',  values: [projectId] } },
      { updatedAt:  { operator: '>d', values: [`${today}T00:00:00Z`] } },
    ])
    const params = new URLSearchParams({
      filters,
      pageSize: '50',
      sortBy: JSON.stringify([['updatedAt', 'desc']]),
    })
    const result = await opGet(`/work_packages?${params}`)
    if (result?._embedded?.elements) {
      for (const wp of result._embedded.elements) {
        if (!wpMap.has(wp.id)) {
          const status = wp._links?.status?.title ?? 'Unknown'
          wpMap.set(wp.id, `**[#${wp.id}]** ${wp.subject} _${status}_`)
        }
      }
    }
  }

  const workPackages = Array.from(wpMap.values())

  // Pull ISL session logs for this date
  const daySessions = getAllSessions().filter(s => s.date === today && s.pushStatus !== 'discarded')
  const sessionLines: string[] = []
  for (const s of daySessions) {
    const dur  = s.actualMins ? `${s.actualMins}m` : ''
    const tag  = s.opTaskId ? ` [#${s.opTaskId}]` : ''
    const stat = s.taskStatus ? ` _(${s.taskStatus})_` : ''
    sessionLines.push(`**ISL${tag}** ${s.title}${stat}${dur ? ` — ${dur}` : ''}`)
    for (const b of (s.bullets ?? []).slice(0, 3)) {
      sessionLines.push(`  - ${b}`)
    }
  }

  // Open tasks (next 3 days) — all projects
  const openTaskMap = new Map<number, string>()
  const cutoff = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)

  for (const projectId of OP_PROJECTS) {
    const filtersTomorrow = JSON.stringify([
      { project:  { operator: '=',  values: [projectId] } },
      { status:   { operator: '!',  values: ['12', '14', '6'] } },
      { dueDate:  { operator: '<=d', values: [cutoff] } },
    ])
    const paramsTomorrow = new URLSearchParams({
      filters: filtersTomorrow,
      pageSize: '20',
      sortBy: JSON.stringify([['dueDate', 'asc']]),
    })
    const resultTomorrow = await opGet(`/work_packages?${paramsTomorrow}`)
    if (resultTomorrow?._embedded?.elements) {
      for (const wp of resultTomorrow._embedded.elements) {
        if (!openTaskMap.has(wp.id)) {
          const status = wp._links?.status?.title ?? 'Unknown'
          const due = wp.dueDate ? ` — due **${wp.dueDate}**` : ''
          openTaskMap.set(wp.id, `**[#${wp.id}]** ${wp.subject} _${status}_${due}`)
        }
      }
    }
  }

  const openTasks = Array.from(openTaskMap.values())

  // Build sections
  const allDoneItems = [
    ...workPackages.map(w => `- ${w}`),
    ...(sessionLines.length
      ? ['', '_ISL Sessions:_', ...sessionLines.map(l => l.startsWith('  ') ? l : `- ${l}`)]
      : []),
  ]

  const doneSection =
    '## Dikerjakan Hari Ini\n\n' +
    (allDoneItems.length
      ? allDoneItems.join('\n') + '\n\n'
      : '_Tidak ada activity hari ini._\n\n')

  const openSection =
    '## Open Tasks (Next 3 Days)\n\n' +
    (openTasks.length
      ? openTasks.map((t) => `- ${t}`).join('\n') + '\n\n'
      : '_Tidak ada open tasks._\n\n')

  if (fs.existsSync(filePath) && !force) {
    let existing = fs.readFileSync(filePath, 'utf-8')
    existing = existing.replace(/^> Generated: .+$/m, `> Generated: ${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB (refreshed)`)
    existing = existing.replace(/## Dikerjakan Hari Ini\n\n[\s\S]*?(?=\n## )/m, doneSection)
    existing = existing.replace(/## Open Tasks \(Next 3 Days\)\n\n[\s\S]*?(?=\n## |\n---)/m, openSection)
    fs.writeFileSync(filePath, existing, 'utf-8')
  } else {
    const dayName = new Date(today + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
    const time = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    const md = `# Daily Sprint - ${dayName}\n\n> Generated: ${time} WIB\n\n${doneSection}${openSection}## Technical Notes\n\n_Tambahkan catatan teknis di sini._\n\n---\n_Auto-generated oleh Daily Sprint App_\n`
    fs.writeFileSync(filePath, md, 'utf-8')
  }

  return NextResponse.json({
    ok: true,
    workPackages: workPackages.length,
    sessions: daySessions.length,
    openTasks: openTasks.length,
  })
}
