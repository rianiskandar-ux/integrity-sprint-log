import { NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/request-auth'

export const runtime = 'nodejs'

function isoToHours(dur: unknown): number | null {
  if (!dur || typeof dur !== 'string') return null
  const m = dur.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/)
  if (!m) return null
  return (Number(m[1] ?? 0) * 24) + Number(m[2] ?? 0) + (Number(m[3] ?? 0) / 60)
}

// GET /api/op/wp-detail?wpId=123 — structured OP task detail for the in-ISL popup
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const wpId = searchParams.get('wpId')
  if (!wpId) return NextResponse.json({ error: 'wpId required' }, { status: 400 })

  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { opToken, opBaseUrl } = ctx
  const auth = 'Basic ' + Buffer.from(`apikey:${opToken}`).toString('base64')

  try {
    const res = await fetch(`${opBaseUrl}/api/v3/work_packages/${wpId}`, { headers: { Authorization: auth } })
    if (!res.ok) return NextResponse.json({ error: `OP ${res.status}` }, { status: res.status })
    const wp = await res.json()
    const links = (wp._links ?? {}) as Record<string, { title?: string; href?: string } | null>

    const statusHref = links.status?.href ?? ''
    const statusId   = statusHref ? parseInt(statusHref.split('/').pop()!) : null
    const parentHref = links.parent?.href ?? ''
    const parentId   = parentHref ? parseInt(parentHref.split('/').pop()!) : null

    // Comments / activity
    let comments: { user: string; at: string; text: string }[] = []
    try {
      const aRes = await fetch(`${opBaseUrl}/api/v3/work_packages/${wpId}/activities?pageSize=50`, { headers: { Authorization: auth } })
      if (aRes.ok) {
        const els = ((await aRes.json())._embedded?.elements ?? []) as {
          comment?: { raw?: string }; createdAt?: string; _links?: { user?: { title?: string } }
        }[]
        comments = els
          .filter(a => (a.comment?.raw ?? '').trim().length > 0)
          .map(a => ({ user: a._links?.user?.title ?? '?', at: a.createdAt ?? '', text: (a.comment!.raw ?? '').slice(0, 1000) }))
      }
    } catch { /* non-fatal */ }

    return NextResponse.json({
      id:             wp.id,
      subject:        wp.subject,
      type:           links.type?.title ?? 'Task',
      status:         links.status?.title ?? '',
      statusId,
      project:        links.project?.title ?? '',
      assignee:       links.assignee?.title ?? null,
      accountable:    links.responsible?.title ?? null,
      version:        links.version?.title ?? null,
      priority:       links.priority?.title ?? null,
      estimatedHours: isoToHours(wp.estimatedTime),
      spentHours:     isoToHours(wp.spentTime),
      remainingHours: isoToHours(wp.remainingTime),
      percentDone:    (wp.percentageDone as number) ?? 0,
      startDate:      wp.startDate ?? null,
      dueDate:        wp.dueDate ?? null,
      date:           wp.date ?? wp.startDate ?? null,
      description:    (wp.description?.raw ?? ''),
      parent:         parentId ? { id: parentId, subject: links.parent?.title ?? '' } : null,
      lockVersion:    wp.lockVersion,
      comments,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
