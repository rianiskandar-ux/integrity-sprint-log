import { NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/request-auth'

export const runtime = 'nodejs'

// OP saved query id=112 — "tickets created by others, across the whole team,
// not yet worked on". ISL adds ZERO extra filtering — this route is a pure
// read-only mirror of whatever that query returns on the OP side.
const QUERY_ID = 112

export interface InquiryItem {
  id: number
  subject: string
  type: string
  project: string
  status: string
  sprintName: string | null
  createdBy: string | null
  assignee: string
  assigneeId: number | null
  createdAt: string | null
  updatedAt: string | null
}

// In-memory cache — query 112 is a global saved view, same for everyone who
// can see it, so we key on nothing but the query id itself.
const TTL_MS = 5 * 60 * 1000
let cache: { at: number; items: InquiryItem[] } | null = null

interface OpLink { title?: string; href?: string }
interface OpElement {
  id: number
  subject: string
  createdAt?: string | null
  updatedAt?: string | null
  _links?: {
    type?: OpLink
    project?: OpLink
    status?: OpLink
    version?: OpLink | null
    author?: OpLink
    assignee?: OpLink | null
    assignedTo?: OpLink | null
  }
}

function extractId(href?: string | null): number | null {
  if (!href) return null
  const m = href.match(/(\d+)$/)
  return m ? parseInt(m[1], 10) : null
}

function mapElement(el: OpElement): InquiryItem {
  const links = el._links ?? {}
  // Defensive: OP's field is normally `assignee`, but handle `assignedTo` too.
  const assigneeLink = links.assignedTo ?? links.assignee ?? null
  return {
    id: el.id,
    subject: el.subject,
    type: links.type?.title ?? '',
    project: links.project?.title ?? '',
    status: links.status?.title ?? '',
    sprintName: links.version?.title ?? null,
    createdBy: links.author?.title ?? null,
    assignee: assigneeLink?.title ?? 'Unassigned',
    assigneeId: extractId(assigneeLink?.href),
    createdAt: el.createdAt ?? null,
    updatedAt: el.updatedAt ?? null,
  }
}

async function fetchQueryResults(base: string, auth: string): Promise<InquiryItem[]> {
  // Try #1: GET /api/v3/queries/:id — may return embedded results directly.
  try {
    const res = await fetch(`${base}/api/v3/queries/${QUERY_ID}`, {
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
    })
    if (res.ok) {
      const data = await res.json() as {
        _embedded?: { results?: { _embedded?: { elements?: OpElement[] } } }
      }
      const elements = data._embedded?.results?._embedded?.elements
      if (Array.isArray(elements)) {
        return elements.map(mapElement)
      }
    }
  } catch { /* fall through to #2 */ }

  // Fallback #2: GET /api/v3/queries/:id/results?pageSize=200
  try {
    const res = await fetch(`${base}/api/v3/queries/${QUERY_ID}/results?pageSize=200`, {
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
    })
    if (res.ok) {
      const data = await res.json() as { _embedded?: { elements?: OpElement[] } }
      const elements = data._embedded?.elements
      if (Array.isArray(elements)) {
        return elements.map(mapElement)
      }
    }
  } catch { /* give up, return empty below */ }

  return []
}

export async function GET() {
  const ctx = await getRequestContext()
  if (process.env.ISL_MULTIUSER === '1' && !ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = ctx?.opToken || process.env.OP_API_TOKEN || ''
  const base  = ctx?.opBaseUrl || process.env.OP_BASE_URL || ''
  if (!token || !base) return NextResponse.json({ error: 'OP not configured' }, { status: 500 })

  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json({
      ok: true,
      items: cache.items,
      fetchedAt: cache.at,
      currentUserId: ctx?.opUserId ?? null,
    })
  }

  const auth = 'Basic ' + Buffer.from(`apikey:${token}`).toString('base64')
  const items = await fetchQueryResults(base, auth)

  cache = { at: Date.now(), items }

  return NextResponse.json({
    ok: true,
    items,
    fetchedAt: cache.at,
    currentUserId: ctx?.opUserId ?? null,
  })
}
