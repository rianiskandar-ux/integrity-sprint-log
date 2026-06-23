import { NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/request-auth'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')?.trim()
  if (!q || q.length < 2) return NextResponse.json({ results: [] })

  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ results: [] })
  const { opToken: OP_TOKEN, opBaseUrl: OP_BASE } = ctx

  const auth = 'Basic ' + Buffer.from(`apikey:${OP_TOKEN}`).toString('base64')
  const isNumeric = /^\d+$/.test(q)
  const filters = isNumeric
    ? JSON.stringify([{ id: { operator: '=', values: [q] } }])
    : JSON.stringify([{ subjectOrId: { operator: '**', values: [q] } }])

  try {
    const url = `${OP_BASE}/api/v3/work_packages?filters=${encodeURIComponent(filters)}&pageSize=10&sortBy=${encodeURIComponent('[["updatedAt","desc"]]')}`
    const res = await fetch(url, { headers: { Authorization: auth } })
    if (!res.ok) return NextResponse.json({ results: [] })

    const data = await res.json()
    const results = (data._embedded?.elements ?? []).map((wp: {
      id: number
      subject: string
      description?: { raw?: string }
      _links: {
        type?: { title?: string }
        status?: { title?: string }
        project?: { title?: string }
        assignee?: { title?: string }
        version?: { title?: string }
      }
    }) => ({
      id:          wp.id,
      subject:     wp.subject,
      type:        wp._links.type?.title ?? 'Task',
      status:      wp._links.status?.title ?? '',
      project:     wp._links.project?.title ?? '',
      assignee:    wp._links.assignee?.title ?? null,
      sprintName:  wp._links.version?.title ?? null,
      description: (wp.description?.raw ?? '').slice(0, 300) || null,
    }))

    return NextResponse.json({ results })
  } catch {
    return NextResponse.json({ results: [] })
  }
}
