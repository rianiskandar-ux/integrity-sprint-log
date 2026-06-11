import { getOpToken, getOpBaseUrl } from '@/lib/user-config'
import { NextResponse } from 'next/server'
import { loadCache } from '@/lib/op-cache'

const OP_BASE = getOpBaseUrl()
const OP_TOKEN = getOpToken()

export async function GET() {
  if (!OP_BASE || !OP_TOKEN) return NextResponse.json({ error: 'OP not configured' }, { status: 500 })

  const cache = loadCache()
  const currentSprint = (cache.sprints ?? []).find(s => s.isCurrent)
  if (!currentSprint) return NextResponse.json({ error: 'No current sprint' }, { status: 404 })

  const auth = 'Basic ' + Buffer.from(`apikey:${OP_TOKEN}`).toString('base64')

  // Fetch ALL work packages in current sprint version — all statuses, all types except Epic
  const filters = encodeURIComponent(JSON.stringify([
    { version: { operator: '=', values: [String(currentSprint.id)] } },
    { type:    { operator: '!', values: ['5'] } },  // exclude Epics (type 5)
  ]))

  try {
    const url = `${OP_BASE}/api/v3/work_packages?filters=${filters}&pageSize=500`
    const res = await fetch(url, { headers: { Authorization: auth } })
    if (!res.ok) return NextResponse.json({ error: `OP ${res.status}` }, { status: 502 })

    const data = await res.json()
    const wps  = data._embedded?.elements ?? []

    type Buckets = { new: number; in_progress: number; on_hold: number; done: number; total: number }
    const makeBuckets = (): Buckets => ({ new: 0, in_progress: 0, on_hold: 0, done: 0, total: 0 })

    const overall = makeBuckets()
    const byProject: Record<string, Buckets & { projectTitle: string }> = {}

    for (const wp of wps) {
      const statusHref   = wp._links?.status?.href ?? ''
      const statusId     = parseInt(statusHref.split('/').pop() ?? '0')
      const projectTitle = wp._links?.project?.title ?? 'Unknown'
      const projectHref  = wp._links?.project?.href ?? ''
      const projectKey   = projectHref.split('/').pop() ?? projectTitle

      if (!byProject[projectKey]) byProject[projectKey] = { ...makeBuckets(), projectTitle }

      const bucket = (b: Buckets) => {
        b.total++
        if      (statusId === 7)  b.in_progress++
        else if (statusId === 8)  b.on_hold++
        else if (statusId === 12 || statusId === 14 || statusId === 6) b.done++
        else    b.new++
      }
      bucket(overall)
      bucket(byProject[projectKey])
    }

    const pct = overall.total > 0 ? Math.round(overall.done / overall.total * 100) : 0

    return NextResponse.json({
      sprint:    { id: currentSprint.id, name: currentSprint.name, endDate: currentSprint.endDate },
      total:     overall.total,
      done:      overall.done,
      remaining: overall.total - overall.done,
      pct,
      buckets:   overall,
      byProject,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
