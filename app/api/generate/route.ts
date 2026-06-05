import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { getSprintDir } from '@/lib/parser'

const OP_BASE = process.env.OP_BASE_URL ?? ''
const OP_TOKEN = process.env.OP_API_TOKEN ?? ''
const OP_PROJECT = process.env.OP_PROJECT_ID ?? ''

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

  // Pull OpenProject data
  const filters = JSON.stringify([
    { project: { operator: '=', values: [OP_PROJECT] } },
    { updatedAt: { operator: '>d', values: [`${today}T00:00:00Z`] } },
  ])
  const params = new URLSearchParams({
    filters,
    pageSize: '50',
    sortBy: JSON.stringify([['updatedAt', 'desc']]),
  })

  const result = await opGet(`/work_packages?${params}`)
  const workPackages: string[] = []
  if (result?._embedded?.elements) {
    for (const wp of result._embedded.elements) {
      const status = wp._links?.status?.title ?? 'Unknown'
      workPackages.push(`**[#${wp.id}]** ${wp.subject} _${status}_`)
    }
  }

  const filtersTomorrow = JSON.stringify([
    { project: { operator: '=', values: [OP_PROJECT] } },
    { status: { operator: '!', values: ['Closed', 'Rejected', 'On hold'] } },
    { dueDate: { operator: '<=d', values: [new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)] } },
  ])
  const paramsTomorrow = new URLSearchParams({
    filters: filtersTomorrow,
    pageSize: '20',
    sortBy: JSON.stringify([['dueDate', 'asc']]),
  })

  const resultTomorrow = await opGet(`/work_packages?${paramsTomorrow}`)
  const openTasks: string[] = []
  if (resultTomorrow?._embedded?.elements) {
    for (const wp of resultTomorrow._embedded.elements) {
      const status = wp._links?.status?.title ?? 'Unknown'
      const due = wp.dueDate ? ` — due **${wp.dueDate}**` : ''
      openTasks.push(`**[#${wp.id}]** ${wp.subject} _${status}_${due}`)
    }
  }

  const doneSection =
    '## Dikerjakan Hari Ini\n\n' +
    (workPackages.length
      ? workPackages.map((w) => `- ${w}`).join('\n') + '\n\n'
      : '_Tidak ada activity OpenProject hari ini._\n\n')

  const openSection =
    '## Open Tasks (Next 3 Days)\n\n' +
    (openTasks.length
      ? openTasks.map((t) => `- ${t}`).join('\n') + '\n\n'
      : '_Tidak ada open tasks._\n\n')

  if (fs.existsSync(filePath) && !force) {
    // Preserve Technical Notes — only update top 2 sections
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

  return NextResponse.json({ ok: true, workPackages: workPackages.length, openTasks: openTasks.length })
}
