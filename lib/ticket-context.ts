/**
 * Ticket context enrichment for Tika (2026-07-21, Rian's accuracy request:
 * "dia harus tau semua file yg terkait misal google sheet dll dan baca
 * konteksnya dari sana juga, dari OP relation juga — bukan asumsi tapi update
 * nyata"). Gathers REAL context around an OP ticket beyond its own text:
 *   - OP relations (related/parent/child work packages + their subjects)
 *   - Linked Google resources found in the description (Sheets/Docs/Drive)
 *
 * Every fetch is best-effort and bounded — a missing/private/broken resource
 * degrades to a short note, never throws, never blocks the poll. Uses the
 * OWNER's Google token (Tika runs as the owner's poll); no token / disabled
 * API just yields no Google context.
 */
import { getValidToken } from './google-auth'
import { OWNER_UID } from './auth'

// Total context handed to the LLM is capped so it can't blow the prompt /
// local-model context window — enrichment is a hint, not the whole ticket.
const MAX_CONTEXT_CHARS = 2000
const PER_RESOURCE_CHARS = 700

interface GoogleLink { kind: 'sheet' | 'doc' | 'drive'; id: string; url: string }

/** Pulls Google Sheets/Docs/Drive links out of free text. Dedupes by id. */
export function extractGoogleLinks(text: string): GoogleLink[] {
  if (!text) return []
  const out: GoogleLink[] = []
  const seen = new Set<string>()
  const push = (kind: GoogleLink['kind'], id: string, url: string) => {
    if (id && !seen.has(id)) { seen.add(id); out.push({ kind, id, url }) }
  }
  for (const m of text.matchAll(/https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/g)) push('sheet', m[1], m[0])
  for (const m of text.matchAll(/https:\/\/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/g)) push('doc', m[1], m[0])
  for (const m of text.matchAll(/https:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/g)) push('drive', m[1], m[0])
  for (const m of text.matchAll(/https:\/\/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/g)) push('drive', m[1], m[0])
  return out.slice(0, 5) // never chase more than 5 links per ticket
}

async function fetchSheet(id: string, token: string): Promise<string> {
  try {
    const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=properties.title,sheets.properties.title`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000),
    })
    if (!metaRes.ok) return `Sheet ${id}: tidak bisa dibaca (${metaRes.status})`
    const meta = await metaRes.json() as { properties?: { title?: string }; sheets?: Array<{ properties?: { title?: string } }> }
    const title = meta.properties?.title ?? '(untitled)'
    const firstTab = meta.sheets?.[0]?.properties?.title
    let sample = ''
    if (firstTab) {
      const valRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(firstTab)}!A1:E8`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000),
      })
      if (valRes.ok) {
        const vals = (await valRes.json() as { values?: string[][] }).values ?? []
        sample = vals.map(r => r.join(' | ')).join('\n')
      }
    }
    return `Google Sheet "${title}" (tab: ${firstTab ?? '—'}):\n${sample}`.slice(0, PER_RESOURCE_CHARS)
  } catch {
    return `Sheet ${id}: gagal diambil`
  }
}

async function fetchDoc(id: string, token: string): Promise<string> {
  try {
    const res = await fetch(`https://docs.googleapis.com/v1/documents/${id}?fields=title,body.content`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return `Doc ${id}: tidak bisa dibaca (${res.status})`
    const doc = await res.json() as { title?: string; body?: { content?: Array<{ paragraph?: { elements?: Array<{ textRun?: { content?: string } }> } }> } }
    const text = (doc.body?.content ?? [])
      .flatMap(c => c.paragraph?.elements ?? [])
      .map(e => e.textRun?.content ?? '')
      .join('')
      .replace(/\n{2,}/g, '\n')
      .trim()
    return `Google Doc "${doc.title ?? '(untitled)'}":\n${text}`.slice(0, PER_RESOURCE_CHARS)
  } catch {
    return `Doc ${id}: gagal diambil`
  }
}

async function fetchDriveMeta(id: string, token: string): Promise<string> {
  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=name,mimeType`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return `Drive file ${id}: tidak bisa dibaca (${res.status})`
    const f = await res.json() as { name?: string; mimeType?: string }
    return `File Drive terkait: "${f.name ?? id}" (${f.mimeType ?? 'unknown'})`
  } catch {
    return `Drive file ${id}: gagal diambil`
  }
}

/** related/parent/child work packages with their subjects — cheap: OP embeds
 *  the `title` in each relation link, so no per-relation follow-up fetch. */
async function fetchOpRelations(base: string, auth: string, wpId: number): Promise<string> {
  try {
    const res = await fetch(`${base}/api/v3/work_packages/${wpId}/relations`, {
      headers: { Authorization: auth }, signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return ''
    const data = await res.json() as { _embedded?: { elements?: Array<{ name?: string; _links?: { from?: { href?: string; title?: string }; to?: { href?: string; title?: string } } }> } }
    const els = data._embedded?.elements ?? []
    const lines: string[] = []
    for (const rel of els) {
      // Whichever end isn't this WP is the related one.
      for (const end of [rel._links?.from, rel._links?.to]) {
        const m = end?.href?.match(/work_packages\/(\d+)/)
        if (m && Number(m[1]) !== wpId) {
          lines.push(`- #${m[1]} "${end?.title ?? ''}" (${rel.name ?? 'terkait'})`)
        }
      }
    }
    return lines.length ? `Tiket OP terkait:\n${lines.join('\n')}` : ''
  } catch {
    return ''
  }
}

/** Assembles a bounded context blob for one ticket. Returns '' when nothing
 *  was found — the caller appends it to prompts only when non-empty. */
export async function gatherTicketContext(
  wp: { id: number; description: string },
  base: string,
  auth: string,
): Promise<string> {
  const parts: string[] = []

  const relations = await fetchOpRelations(base, auth, wp.id)
  if (relations) parts.push(relations)

  const links = extractGoogleLinks(wp.description)
  if (links.length) {
    const token = await getValidToken(OWNER_UID)
    if (token) {
      for (const link of links) {
        if (link.kind === 'sheet') parts.push(await fetchSheet(link.id, token))
        else if (link.kind === 'doc') parts.push(await fetchDoc(link.id, token))
        else parts.push(await fetchDriveMeta(link.id, token))
      }
    } else {
      parts.push(`(${links.length} link Google di tiket, tapi Tika belum punya akses Google — reconnect di Settings)`)
    }
  }

  return parts.join('\n\n').slice(0, MAX_CONTEXT_CHARS)
}
