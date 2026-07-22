/**
 * Google Docs writer (2026-07-21). Creates a real, editable Google Doc from
 * structured sections and returns its shareable link. Uses the OWNER's Google
 * token (documents + drive.file scopes, granted on reconnect). No-ops with a
 * clear error when the token/scope/API is unavailable — never throws to the
 * caller.
 *
 * First use: generating Helpdesk system documentation. Designed generically so
 * Vera's test-run documentation (once build B ships) can reuse it.
 *
 * Content model: a flat list of blocks, each with a style. We insert ALL text
 * in one batchUpdate (one insertText at index 1) then apply paragraph styles
 * by computed character range — Docs indices are 1-based and every block ends
 * in '\n', so block i occupies [offset+1, offset+1+len).
 */
import { getValidToken } from './google-auth'
import { OWNER_UID } from './auth'

export type DocBlockStyle = 'TITLE' | 'HEADING_1' | 'HEADING_2' | 'NORMAL_TEXT'
export interface DocBlock { text: string; style: DocBlockStyle }

export interface CreateDocResult {
  ok: boolean
  documentId?: string
  url?: string
  error?: string
}

const DOCS_API = 'https://docs.googleapis.com/v1/documents'

export async function createStructuredDoc(title: string, blocks: DocBlock[], uid: number = OWNER_UID): Promise<CreateDocResult> {
  const token = await getValidToken(uid)
  if (!token) return { ok: false, error: 'No Google token — reconnect Google in Settings (needs documents scope).' }

  // 1. Create the empty doc.
  let documentId: string
  try {
    const res = await fetch(DOCS_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return { ok: false, error: `Docs create failed: ${res.status} ${await res.text()}` }
    documentId = (await res.json() as { documentId?: string }).documentId ?? ''
    if (!documentId) return { ok: false, error: 'Docs create returned no documentId' }
  } catch (e) {
    return { ok: false, error: `Docs create error: ${e instanceof Error ? e.message : String(e)}` }
  }

  // 2. Build one insertText + per-block updateParagraphStyle requests.
  const fullText = blocks.map(b => (b.text.endsWith('\n') ? b.text : b.text + '\n')).join('')
  const requests: object[] = [{ insertText: { location: { index: 1 }, text: fullText } }]

  let offset = 1
  for (const b of blocks) {
    const len = (b.text.endsWith('\n') ? b.text : b.text + '\n').length
    if (b.style !== 'NORMAL_TEXT') {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: offset, endIndex: offset + len },
          paragraphStyle: { namedStyleType: b.style },
          fields: 'namedStyleType',
        },
      })
    }
    offset += len
  }

  // 3. Apply content.
  try {
    const res = await fetch(`${DOCS_API}/${documentId}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) {
      // Doc exists but is empty — surface the link anyway so it's not orphaned.
      return { ok: false, documentId, url: `https://docs.google.com/document/d/${documentId}/edit`, error: `content batchUpdate failed: ${res.status} ${await res.text()}` }
    }
  } catch (e) {
    return { ok: false, documentId, url: `https://docs.google.com/document/d/${documentId}/edit`, error: `batchUpdate error: ${e instanceof Error ? e.message : String(e)}` }
  }

  return { ok: true, documentId, url: `https://docs.google.com/document/d/${documentId}/edit` }
}
