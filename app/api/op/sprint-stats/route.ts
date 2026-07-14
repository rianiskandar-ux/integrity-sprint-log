import { NextResponse } from 'next/server'
import { loadCache } from '@/lib/op-cache'
import { getRequestContext } from '@/lib/request-auth'
import { OWNER_UID } from '@/lib/auth'

export const runtime = 'nodejs'

// which=next reports the next sprint's stats instead of the current one — used
// by the Aryo report (cross-app, launcher-dashboard) so it can show both.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const which = searchParams.get('which') === 'next' ? 'next' : 'current'

  const ctx = await getRequestContext()
  // Machine auth: launcher-dashboard's Aryo report calls this cross-app with no
  // session cookie. Without this it always 401s — the report's "Sprint Status"
  // section showing permanent "—" dashes was this, not a data problem.
  const machineAuth = req.headers.get('x-kafi-key') === (process.env.KAFI_API_KEY)
  if (!ctx && !machineAuth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const OP_TOKEN = ctx?.opToken || (machineAuth ? process.env.OP_API_TOKEN : '') || ''
  const OP_BASE  = ctx?.opBaseUrl || process.env.OP_BASE_URL || ''
  const uid      = ctx?.uid ?? (machineAuth ? OWNER_UID : null)
  if (!OP_TOKEN || !OP_BASE) return NextResponse.json({ error: 'OP not configured' }, { status: 500 })

  const cache = loadCache(uid)
  const sprints = cache.sprints ?? []
  const currentSprint = which === 'current'
    ? sprints.find(s => s.isCurrent)
    : sprints
        .filter(s => (s.startDate ?? '') > (sprints.find(x => x.isCurrent)?.endDate ?? ''))
        .sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''))[0]
  if (!currentSprint) return NextResponse.json({ error: which === 'current' ? 'No current sprint' : 'No next sprint' }, { status: 404 })

  const auth = 'Basic ' + Buffer.from(`apikey:${OP_TOKEN}`).toString('base64')

  const filters = encodeURIComponent(JSON.stringify([
    { version: { operator: '=', values: [String(currentSprint.id)] } },
    { type:    { operator: '!', values: ['5'] } },
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
