import { loadCache } from '@/lib/op-cache'
import { NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/request-auth'

export const runtime = 'nodejs'

export async function GET() {
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { opToken: token, opBaseUrl: base, uid } = ctx
  const auth = Buffer.from(`apikey:${token}`).toString('base64')

  const cache = loadCache(uid)
  const allWP = [...(cache.myOpenTasks ?? []), ...(cache.incomingTasks ?? []), ...(cache.myClosedTasks ?? [])]
  const userProjectIds = new Set<number>(
    (allWP as { projectId?: number }[]).map(wp => wp.projectId).filter((id): id is number => !!id)
  )

  const url = `${base}/api/v3/meetings?pageSize=50&sortBy=%5B%5B%22startTime%22%2C%22desc%22%5D%5D`
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
  })
  if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: res.status })
  const data = await res.json()

  const meetings = (data._embedded?.elements ?? []).map((m: {
    id: number; title: string; state: string; startTime: string; endTime: string
    _links: { project?: { href: string; title: string }; self?: { href: string } }
  }) => {
    const projHref = m._links?.project?.href ?? ''
    const projIdMatch = projHref.match(/\/projects\/(\d+)/)
    const projId = projIdMatch ? Number(projIdMatch[1]) : null

    return {
      id:          m.id,
      title:       m.title,
      state:       m.state,
      startTime:   m.startTime,
      endTime:     m.endTime,
      project:     m._links?.project?.title ?? '',
      projectHref: projHref,
      projectId:   projId,
      autoMatched: projId !== null && userProjectIds.size > 0 ? userProjectIds.has(projId) : false,
    }
  })

  return NextResponse.json({ meetings })
}
