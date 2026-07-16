/**
 * Shared fetcher for OP saved query id=112 ("Inquiries") — the exact scope
 * Rian confirmed for Tika's intake (PRD §15, resolved 2026-07-16): rather
 * than re-derive the filter (status=open AND author IN [...]) and risk it
 * drifting from query 112 if someone edits the query in the OP UI, both
 * consumers hit the live query directly.
 *
 * Extracted from app/api/op/inquiries/route.ts (InquiriesPanel's read-only
 * mirror, pre-existing) so lib/helpdesk.ts (Tika, new) uses the SAME fetch
 * logic instead of a second, divergence-prone implementation. Behavior for
 * the existing route is unchanged — this is a pure extraction plus adding
 * fields (description, projectId, createdById, lockVersion) Tika needs that
 * InquiriesPanel didn't previously read.
 */

const QUERY_ID = 112

export interface OpInquiryElement {
  id: number
  subject: string
  description: string
  type: string
  project: string
  projectId: string | null
  status: string
  sprintName: string | null
  createdBy: string | null
  createdById: number | null
  assignee: string
  assigneeId: number | null
  createdAt: string | null
  updatedAt: string | null
  lockVersion: number | null
}

interface OpLink { title?: string; href?: string }
interface OpElement {
  id: number
  subject: string
  description?: { raw?: string }
  createdAt?: string | null
  updatedAt?: string | null
  lockVersion?: number
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

function mapElement(el: OpElement): OpInquiryElement {
  const links = el._links ?? {}
  // Defensive: OP's field is normally `assignee`, but handle `assignedTo` too.
  const assigneeLink = links.assignedTo ?? links.assignee ?? null
  return {
    id: el.id,
    subject: el.subject,
    description: el.description?.raw ?? '',
    type: links.type?.title ?? '',
    project: links.project?.title ?? '',
    projectId: extractId(links.project?.href)?.toString() ?? null,
    status: links.status?.title ?? '',
    sprintName: links.version?.title ?? null,
    createdBy: links.author?.title ?? null,
    createdById: extractId(links.author?.href),
    assignee: assigneeLink?.title ?? 'Unassigned',
    assigneeId: extractId(assigneeLink?.href),
    createdAt: el.createdAt ?? null,
    updatedAt: el.updatedAt ?? null,
    lockVersion: el.lockVersion ?? null,
  }
}

/** Fetch OP saved query 112's current results under the given token. */
export async function fetchInquiries(base: string, auth: string): Promise<OpInquiryElement[]> {
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
