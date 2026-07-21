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
import { db, helpdeskTickets, ticketAnalyses, ticketLinks, ticketCorrections, userSettings, users, sessions } from './db'
import { and, eq, inArray, isNull, notInArray } from 'drizzle-orm'
import { decrypt } from './crypto'
import { getOpBaseUrl } from './user-config'
import { callLocalLLM } from './local-llm'
import { upsertEmbedding, semanticSearch } from './embeddings'
import { OWNER_UID, isOwnerUid } from './auth'
import { fetchInquiries, type OpInquiryElement } from './op-inquiries'
import crypto from 'crypto'

// OP status ids that mean "rejected" (lib/op-cache.ts's OP_STATUS_MAP — kept
// as a local literal here rather than importing that map, since op-cache.ts
// is oriented around CachedWorkPackage/ISL task status, a different concern).
const OP_REJECTED_STATUS_IDS = new Set([14, 6])

// First ISL->Launcher call this session (every other cross-app call has gone
// the other direction). ISL runs in Docker, Launcher runs on the Windows host
// as an NSSM service — host.docker.internal is the same escape hatch already
// used for Ollama (lib/local-llm.ts).
const LAUNCHER_URL = process.env.LAUNCHER_URL || 'http://host.docker.internal:9000'

async function sendViaLauncherRelay(to: string, subject: string, html: string): Promise<boolean> {
  try {
    const res = await fetch(`${LAUNCHER_URL}/api/nara/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-kafi-key': process.env.KAFI_API_KEY ?? '' },
      body: JSON.stringify({ to, subject, html }),
      signal: AbortSignal.timeout(20000),
    })
    return res.ok
  } catch {
    return false
  }
}

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

// ── Aufa email notification (2026-07-21, Rian's request) ───────────────────
// Proactive nudge on top of the passive AufaQueueView — she shouldn't have to
// remember to check ISL. Originally tried the owner's connected Gmail
// (lib/google-auth sendEmail) — live-tested and found Gmail API is disabled
// on that OAuth project (403 accessNotConfigured), so this instead relays
// through Launcher's /api/nara/send-email, which reuses the SAME Brevo SMTP
// account Nara's own dispatch already sends through successfully every
// weekday (NARA_SMTP_* env, confirmed working all session) — proven
// infrastructure instead of a fix-pending OAuth path. No-ops entirely until
// someone has users.role='qa' with a real email on file — safe to call on
// every poll.
export async function notifyQaIfPending(): Promise<{ notified: boolean; count: number }> {
  const qaUser = (await db.select().from(users).where(eq(users.role, 'qa')).limit(1))[0]
  if (!qaUser?.email || qaUser.email.endsWith('@local')) return { notified: false, count: 0 } // op-login's placeholder shape when OP had no real email

  const candidates = await db.select().from(helpdeskTickets)
    .where(and(isNull(helpdeskTickets.qaVerdict), isNull(helpdeskTickets.qaNotifiedAt)))
  if (!candidates.length) return { notified: false, count: 0 }

  const ids = candidates.map(t => t.id)
  const classifications = await db.select().from(ticketAnalyses).where(and(inArray(ticketAnalyses.ticketId, ids), eq(ticketAnalyses.kind, 'classify')))
  const bugTickets = candidates.filter(t =>
    classifications.some(a => a.ticketId === t.id && (a.result as { kind?: string })?.kind === 'bug'),
  )
  if (!bugTickets.length) return { notified: false, count: 0 }

  const base = getOpBaseUrl() || process.env.OP_BASE_URL || 'https://tokek.integrity-asia.com'
  const rows = bugTickets.map(t =>
    `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee"><a href="${base}/work_packages/${t.opWpId}">#${t.opWpId}</a></td>` +
    `<td style="padding:6px 10px;border-bottom:1px solid #eee">${t.subject}</td></tr>`,
  ).join('')
  const html = `
<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:16px;margin-bottom:16px">
  <strong style="color:#92400e">🎫 ${bugTickets.length} tiket bug baru menunggu QA</strong>
</div>
<table style="width:100%;border-collapse:collapse">${rows}</table>
<p style="margin-top:20px;color:#6b7280">Buka menu <strong>Helpdesk</strong> di ISL untuk lihat temuan Tika (klasifikasi, kelengkapan, kemungkinan duplikat) dan tekan PASS kalau valid — tolak langsung di OP kalau tidak.</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
<p style="color:#9ca3af;font-size:12px">🤖 Auto-sent by Tika · ISL Helpdesk · ${new Date().toLocaleString('id-ID')}</p>
</body></html>`

  const ok = await sendViaLauncherRelay(qaUser.email, `[ISL Helpdesk] ${bugTickets.length} tiket bug menunggu QA`, html)
  if (!ok) return { notified: false, count: 0 } // stays un-notified, retried next poll — never silently drops the alert

  for (const t of bugTickets) {
    await db.update(helpdeskTickets).set({ qaNotifiedAt: new Date() }).where(eq(helpdeskTickets.id, t.id))
  }
  return { notified: true, count: bugTickets.length }
}

// Dedup: cosine distance below this = suspected duplicate (PRD §6.2 initial
// threshold) — also reused as the correction-loop's similarity cutoff below.
const DUP_SIMILARITY_THRESHOLD = 0.3 // hybridSearch/semanticSearch distance is 1-similarity-ish; lower = closer

// ── Tika correction loop (2026-07-21) ───────────────────────────────────────
// Same proven pattern as arka_corrections (schema.ts): record real mistakes,
// embed them, retrieve similar past mistakes via semanticSearch when making
// a new judgment — no training loop, no model fine-tuning, just retrievable
// history. Narrow scope for v1: only "classified bug, got rejected in OP"
// (the case where over-classifying wastes Aufa's review time). Doesn't
// alter Tika's classification directly (unlike Arka's deterministic
// override) — surfaces as extra context in the classify prompt instead,
// since "why" a ticket got rejected isn't as clean-cut as a wrong task-id.

async function fetchWpStatusId(base: string, auth: string, wpId: number): Promise<number | null> {
  try {
    const res = await fetch(`${base}/api/v3/work_packages/${wpId}`, { headers: { Authorization: auth } })
    if (!res.ok) return null
    const data = await res.json() as { _links?: { status?: { href?: string } } }
    const href = data._links?.status?.href ?? ''
    const m = href.match(/(\d+)$/)
    return m ? parseInt(m[1], 10) : null
  } catch {
    return null
  }
}

/** Checks tickets that dropped out of the open-tickets scope since the last
 *  poll (their OP status changed away from "open") — if Tika had classified
 *  one as 'bug' and it turns out the final status is Rejected, that's a real
 *  misclassification signal, recorded for future retrieval. Everything else
 *  (resolved normally, etc.) is just marked checked so it's never re-queried. */
async function detectRejectedOutcomes(base: string, auth: string, currentOpWpIds: number[]): Promise<number> {
  let corrections = 0
  const dropped = await db.select().from(helpdeskTickets).where(
    and(
      isNull(helpdeskTickets.outcomeCheckedAt),
      currentOpWpIds.length ? notInArray(helpdeskTickets.opWpId, currentOpWpIds) : undefined,
    ),
  ).limit(50) // bounded per poll — a huge backlog just spreads checks across multiple polls, never blocks one
  if (!dropped.length) return 0

  for (const ticket of dropped) {
    try {
      const statusId = await fetchWpStatusId(base, auth, ticket.opWpId)
      if (statusId === null) continue // OP unreachable for this one — retry next poll, don't mark checked

      if (OP_REJECTED_STATUS_IDS.has(statusId)) {
        const classifyRow = (await db.select().from(ticketAnalyses)
          .where(and(eq(ticketAnalyses.ticketId, ticket.id), eq(ticketAnalyses.kind, 'classify')))
          .limit(1))[0]
        const kind = (classifyRow?.result as { kind?: string } | undefined)?.kind
        if (kind === 'bug') {
          const description = '' // not stored on helpdeskTickets itself — subject alone is still useful signal for retrieval
          await db.insert(ticketCorrections).values({
            id: `tc-${ticket.opWpId}-${Date.now()}`,
            ticketId: ticket.id,
            opWpId: ticket.opWpId,
            subject: ticket.subject,
            description,
            tikaClassification: kind,
            opOutcome: 'rejected',
          })
          await upsertEmbedding({ sourceType: 'ticket_correction', sourceId: `${ticket.opWpId}-${Date.now()}`, title: ticket.subject, chunk: description })
          corrections++
        }
      }
      await db.update(helpdeskTickets).set({ outcomeCheckedAt: new Date() }).where(eq(helpdeskTickets.id, ticket.id))
    } catch { /* best-effort per ticket — skip, retried next poll since outcomeCheckedAt stays null */ }
  }
  return corrections
}

/** Past tickets similar to this one that were classified 'bug' but got
 *  rejected — folded into the classify prompt as context, not a hard
 *  override (unlike Arka's task-id override, "why" a ticket gets rejected
 *  isn't clean-cut enough to just flip the label). Empty string = no
 *  relevant history yet, prompt is unaffected. */
async function correctionContext(subject: string, description: string): Promise<string> {
  try {
    const hits = await semanticSearch(`${subject}\n${description}`, null, 5)
    const relevant = hits.filter(h => h.sourceType === 'ticket_correction' && h.distance <= DUP_SIMILARITY_THRESHOLD)
    if (!relevant.length) return ''
    return `\n\nCatatan riwayat: tiket berikut PERNAH diklasifikasi "bug" tapi ternyata ditolak (rejected) di OP — pertimbangkan pola ini kalau tiket sekarang mirip:\n${relevant.map(h => `- "${h.title}"`).join('\n')}`
  } catch {
    return ''
  }
}

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

function classifyPrompt(subject: string, description: string, correctionNote: string): string {
  return `Kamu adalah Tika, asisten triase tiket untuk tim dev/QA. Baca tiket ini dan klasifikasikan.

Judul: ${subject}
Deskripsi: ${description || '(tidak ada deskripsi)'}

Klasifikasikan "kind":
- "bug" = laporan sesuatu yang rusak/tidak berfungsi
- "request" = permintaan fitur/perubahan baru
- "question" = pertanyaan, bukan laporan masalah
- "unclear" = gak jelas termasuk yang mana

Reasoning 1 kalimat singkat, Bahasa Indonesia.${correctionNote}`
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

  const auth = 'Basic ' + Buffer.from(`apikey:${token}`).toString('base64')
  let wps: OpInquiryElement[]
  try {
    wps = await fetchInquiries(base, auth)
  } catch (e) {
    return { scanned: 0, analyzed: 0, dupSuspects: 0, errors: [String(e)] }
  }

  // Correction loop: check tickets that dropped out of scope since the last
  // poll for a Rejected outcome (best-effort — never blocks the main pass).
  try { await detectRejectedOutcomes(base, auth, wps.map(wp => wp.id)) } catch { /* retried next poll */ }

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

      const correctionNote = await correctionContext(subject, description)
      const [classifyRaw, clarityRaw] = await Promise.all([
        callLocalLLM(classifyPrompt(subject, description, correctionNote), CLASSIFY_FORMAT),
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
