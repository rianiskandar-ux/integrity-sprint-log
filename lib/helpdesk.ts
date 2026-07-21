/**
 * Tika — Helpdesk & QA Validation Pipeline, Phase 0 (shadow mode).
 * PRD: docs/PRD-helpdesk-qa-pipeline.md
 *
 * Shadow mode contract (PRD §12 Phase 0): reads OP, writes ONLY to the new
 * helpdesk_tickets/ticket_analyses/ticket_links tables. NEVER writes to OP
 * (no comments, no status changes) and NEVER touches any existing ISL table.
 * OP stays the single source of truth (PRD §16 decision #1) — these tables
 * are derived state, safe to drop and rebuild from OP at any time.
 */
import { db, helpdeskTickets, ticketAnalyses, ticketLinks, userSettings, users, sessions } from './db'
import { eq } from 'drizzle-orm'
import { decrypt } from './crypto'
import { getOpBaseUrl } from './user-config'
import { callLocalLLM } from './local-llm'
import { upsertEmbedding, semanticSearch } from './embeddings'
import { OWNER_UID, isOwnerUid } from './auth'
import { fetchInquiries, type OpInquiryElement } from './op-inquiries'
import crypto from 'crypto'

// ── QA routing (PRD §16.2 build A) ──────────────────────────────────────────
// Shared by both POST /api/helpdesk/qa/pass (Aufa's immediate action) and
// pollInquiries() below (retroactive routing — an assignee can be added in
// OP AFTER Aufa already passed the ticket). Never routes to Rian's own queue
// as a fallback: his explicit correction was "jgn masuk ke queue gw" — an
// unresolved assignee just leaves pushedToQueueAt null, and the ticket stays
// visible/marked [UNASSIGNED] in the Helpdesk view until this resolves.
type HelpdeskTicketRow = typeof helpdeskTickets.$inferSelect

/** Who may see/act on the Helpdesk QA queue: the owner, or a user whose
 *  users.role = 'qa' (set manually by the owner once someone like Aufa is
 *  onboarded — no self-service role picker, this is a deliberate grant). */
export async function isQaOrOwner(uid: number | null | undefined): Promise<boolean> {
  if (isOwnerUid(uid)) return true
  if (uid == null) return false
  const row = (await db.select().from(users).where(eq(users.id, uid)).limit(1))[0]
  return row?.role === 'qa'
}

export async function routeToPushQueueIfReady(ticket: HelpdeskTicketRow): Promise<boolean> {
  if (ticket.qaVerdict !== 'pass' || ticket.pushedToQueueAt || !ticket.assigneeOpUserId) return false

  const assignee = (await db.select().from(users).where(eq(users.opUserId, ticket.assigneeOpUserId)).limit(1))[0]
  if (!assignee) return false // no ISL account for this OP user yet — stays pending

  await db.insert(sessions).values({
    id: `sl-hd-${ticket.opWpId}-${Date.now()}`,
    sessionId: `helpdesk-pass-${ticket.opWpId}`,
    userId: assignee.id,
    date: new Date().toISOString().slice(0, 10),
    title: `[BUG PASS VALID] ${ticket.subject}`,
    bullets: [],
    source: 'helpdesk',
    startedAt: new Date().toISOString(),
    estimatedMins: 60,
    opTaskId: ticket.opWpId,
    taskStatus: 'in_progress',
    pushStatus: 'pending',
    autoPushed: false,
  }).onConflictDoNothing()

  await db.update(helpdeskTickets).set({ pushedToQueueAt: new Date() }).where(eq(helpdeskTickets.id, ticket.id))
  return true
}

// Dedup: cosine distance below this = suspected duplicate (PRD §6.2 initial threshold)
const DUP_SIMILARITY_THRESHOLD = 0.3 // hybridSearch/semanticSearch distance is 1-similarity-ish; lower = closer

function computeContentHash(wp: OpInquiryElement): string {
  return crypto.createHash('sha1').update(`${wp.subject}|${wp.description}|${wp.lockVersion ?? ''}`).digest('hex')
}

const CLASSIFY_FORMAT = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['bug', 'request', 'question', 'unclear'] },
    reasoning: { type: 'string' },
  },
  required: ['kind', 'reasoning'],
} as const

const CLARITY_FORMAT = {
  type: 'object',
  properties: {
    hasReproSteps: { type: 'boolean' },
    hasExpectedActual: { type: 'boolean' },
    missing: { type: 'array', items: { type: 'string' } },
  },
  required: ['hasReproSteps', 'hasExpectedActual', 'missing'],
} as const

function classifyPrompt(subject: string, description: string): string {
  return `Kamu adalah Tika, asisten triase tiket untuk tim dev/QA. Baca tiket ini dan klasifikasikan.

Judul: ${subject}
Deskripsi: ${description || '(tidak ada deskripsi)'}

Klasifikasikan "kind":
- "bug" = laporan sesuatu yang rusak/tidak berfungsi
- "request" = permintaan fitur/perubahan baru
- "question" = pertanyaan, bukan laporan masalah
- "unclear" = gak jelas termasuk yang mana

Reasoning 1 kalimat singkat, Bahasa Indonesia.`
}

function clarityPrompt(subject: string, description: string): string {
  return `Kamu adalah Tika. Baca laporan ini dan cek kelengkapannya sebagai laporan bug.

Judul: ${subject}
Deskripsi: ${description || '(tidak ada deskripsi)'}

Tentukan:
- hasReproSteps: apakah ada langkah-langkah reproduksi yang jelas?
- hasExpectedActual: apakah ada penjelasan "harusnya apa" vs "yang terjadi apa"?
- missing: daftar singkat (Bahasa Indonesia) apa yang kurang — array kosong kalau sudah lengkap.`
}

export interface PollResult {
  scanned: number
  analyzed: number
  dupSuspects: number
  errors: string[]
}

/** Shadow-mode poll: fetch Inquiries scope from OP, classify/clarity/dedup new
 *  or changed tickets, persist to helpdesk_tickets/ticket_analyses/ticket_links.
 *  Never writes to OP. Safe to call repeatedly (idempotent per content hash). */
export async function pollInquiries(): Promise<PollResult> {
  const errors: string[] = []
  let analyzed = 0
  let dupSuspects = 0

  const row = (await db.select().from(userSettings).where(eq(userSettings.userId, OWNER_UID)).limit(1))[0]
  const token = row?.opApiToken ? decrypt(row.opApiToken) : ''
  const base = getOpBaseUrl() || process.env.OP_BASE_URL || 'https://tokek.integrity-asia.com'
  if (!token) return { scanned: 0, analyzed: 0, dupSuspects: 0, errors: ['no OP token for owner'] }

  let wps: OpInquiryElement[]
  try {
    const auth = 'Basic ' + Buffer.from(`apikey:${token}`).toString('base64')
    wps = await fetchInquiries(base, auth)
  } catch (e) {
    return { scanned: 0, analyzed: 0, dupSuspects: 0, errors: [String(e)] }
  }

  for (const wp of wps) {
    try {
      const hash = computeContentHash(wp)
      const ticketId = `hdt-${wp.id}`
      const existing = (await db.select().from(helpdeskTickets).where(eq(helpdeskTickets.opWpId, wp.id)).limit(1))[0]

      const subject = wp.subject
      const description = wp.description

      const mirrored = {
        subject,
        opStatus: wp.status || null,
        opType: wp.type || null,
        opProjectId: wp.projectId,
        authorOpUserId: wp.createdById,
        authorName: wp.createdBy,
        // "Unassigned" in OP maps to assigneeId=null (fetchInquiries only sets
        // the display string to 'Unassigned', not the id) — keep both null.
        assigneeOpUserId: wp.assigneeId,
        assigneeName: wp.assignee === 'Unassigned' ? null : wp.assignee,
        lastOpActivityAt: wp.updatedAt ? new Date(wp.updatedAt) : null,
      }

      if (existing) {
        await db.update(helpdeskTickets).set({ ...mirrored, updatedAt: new Date() }).where(eq(helpdeskTickets.id, ticketId))
      } else {
        await db.insert(helpdeskTickets).values({ id: ticketId, opWpId: wp.id, ...mirrored })
      }

      // Retroactive routing: an already-PASSed ticket may only just now have
      // gotten an OP assignee (or that assignee only just created their ISL
      // account) — check on every poll, not just on content change below.
      if (existing) {
        try { await routeToPushQueueIfReady({ ...existing, ...mirrored }) } catch { /* best-effort, retried next poll */ }
      }

      // Analyze only on real content change (PRD §6.1) — track OP lockVersion via hash.
      if (existing?.contentHash === hash) continue

      const [classifyRaw, clarityRaw] = await Promise.all([
        callLocalLLM(classifyPrompt(subject, description), CLASSIFY_FORMAT),
        callLocalLLM(clarityPrompt(subject, description), CLARITY_FORMAT),
      ])

      if (classifyRaw) {
        try {
          await db.insert(ticketAnalyses).values({
            id: `ta-${wp.id}-classify-${Date.now()}`, ticketId, kind: 'classify',
            model: 'ollama', result: JSON.parse(classifyRaw),
          })
        } catch { /* malformed LLM JSON — skip this analysis row, ticket still tracked */ }
      }
      if (clarityRaw) {
        try {
          await db.insert(ticketAnalyses).values({
            id: `ta-${wp.id}-clarity-${Date.now()}`, ticketId, kind: 'clarity',
            model: 'ollama', result: JSON.parse(clarityRaw),
          })
        } catch { /* malformed LLM JSON — skip */ }
      }

      // Dedup: embed this ticket, search among other ticket embeddings only.
      await upsertEmbedding({ sourceType: 'ticket', sourceId: String(wp.id), title: subject, chunk: description })
      const hits = await semanticSearch(`${subject}\n${description}`, null, 10)
      const dupHits = hits.filter(h => h.sourceType === 'ticket' && h.sourceId !== String(wp.id) && h.distance <= DUP_SIMILARITY_THRESHOLD)
      for (const hit of dupHits) {
        const relatedOpWpId = Number(hit.sourceId)
        if (!Number.isFinite(relatedOpWpId)) continue
        await db.insert(ticketLinks).values({
          id: `tl-${wp.id}-${relatedOpWpId}`, ticketId, relatedOpWpId, similarity: hit.distance, status: 'suspected',
        }).onConflictDoNothing()
        dupSuspects++
      }
      if (dupHits.length > 0) {
        await db.insert(ticketAnalyses).values({
          id: `ta-${wp.id}-dedup-${Date.now()}`, ticketId, kind: 'dedup',
          model: 'ollama+embeddings', result: { suspects: dupHits.map(h => ({ opWpId: h.sourceId, distance: h.distance })) },
        }).catch(() => {})
      }

      await db.update(helpdeskTickets).set({ contentHash: hash, pipelineState: dupHits.length > 0 ? 'dup_suspect' : 'triaged' }).where(eq(helpdeskTickets.id, ticketId))
      analyzed++
    } catch (e) {
      errors.push(`wp#${wp.id}: ${String(e)}`)
    }
  }

  return { scanned: wps.length, analyzed, dupSuspects, errors }
}
