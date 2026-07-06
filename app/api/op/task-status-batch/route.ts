import { NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/request-auth'

export const runtime = 'nodejs'

interface TaskStatus {
  status: string
  isClosed: boolean
  sprintName: string | null
}

// In-memory cache per (user, id-set) — 30 min TTL so the sidebar doesn't
// hammer OP on every mount/list-reload.
const cache = new Map<string, { at: number; statuses: Record<string, TaskStatus> }>()
const TTL_MS = 30 * 60 * 1000

interface OpElement {
  id: number
  _links?: {
    status?: { title?: string }
    version?: { title?: string }
  }
  _embedded?: {
    status?: { name?: string; isClosed?: boolean }
  }
}

export async function GET(req: Request) {
  const ctx = await getRequestContext()
  if (process.env.ISL_MULTIUSER === '1' && !ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = ctx?.opToken || process.env.OP_API_TOKEN || ''
  const base  = ctx?.opBaseUrl || process.env.OP_BASE_URL || ''
  if (!token || !base) return NextResponse.json({ error: 'OP not configured' }, { status: 500 })

  const { searchParams } = new URL(req.url)
  const ids = Array.from(new Set(
    (searchParams.get('ids') ?? '')
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => Number.isFinite(n) && n > 0)
  )).sort((a, b) => a - b)
  if (!ids.length) return NextResponse.json({ ok: true, statuses: {} })

  const cacheKey = `${ctx?.uid ?? 0}:${ids.join(',')}`
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json({ ok: true, statuses: hit.statuses, cached: true })
  }

  // ONE OP call for the whole id set
  const filters = encodeURIComponent(JSON.stringify([
    { id: { operator: '=', values: ids.map(String) } },
  ]))
  const res = await fetch(`${base}/api/v3/work_packages?filters=${filters}&pageSize=100`, {
    headers: {
      Authorization: 'Basic ' + Buffer.from(`apikey:${token}`).toString('base64'),
      'Content-Type': 'application/json',
    },
  }).catch(() => null)
  if (!res || !res.ok) {
    return NextResponse.json({ error: `OP error ${res ? res.status : 'network'}` }, { status: 502 })
  }

  const data = await res.json() as { _embedded?: { elements?: OpElement[] } }

  // Ids not returned by OP (deleted / no permission) → status unknown, not closed
  const statuses: Record<string, TaskStatus> = {}
  for (const id of ids) statuses[id] = { status: 'unknown', isClosed: false, sprintName: null }

  for (const el of data._embedded?.elements ?? []) {
    if (!el?.id) continue
    const statusName = el._embedded?.status?.name ?? el._links?.status?.title ?? 'unknown'
    // Closed = OP's own isClosed flag when embedded, OR the status name looks final
    const isClosed = el._embedded?.status?.isClosed === true || /closed|rejected|done/i.test(statusName)
    statuses[el.id] = {
      status: statusName,
      isClosed,
      sprintName: el._links?.version?.title ?? null,
    }
  }

  cache.set(cacheKey, { at: Date.now(), statuses })
  return NextResponse.json({ ok: true, statuses })
}
