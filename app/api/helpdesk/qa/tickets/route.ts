import { NextResponse } from 'next/server'
import { db, helpdeskTickets, ticketAnalyses, ticketLinks } from '@/lib/db'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { getRequestContext } from '@/lib/request-auth'

export const runtime = 'nodejs'

// GET /api/helpdesk/qa/tickets — the QA queue (PRD §16.2 build A, opened to
// everyone 2026-07-21 per Rian: full transparency for the whole team, not
// just the designated verifier — "mungkin aja semua orang mau bantu/make
// sure". Any logged-in user can SEE this; only POST /qa/pass (the actual
// decision) stays gated to isQaOrOwner. Scope: tickets Tika classified as
// 'bug' with no QA verdict yet.
export async function GET() {
  const ctx = await getRequestContext()
  if (process.env.ISL_MULTIUSER === '1' && !ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tickets = await db.select().from(helpdeskTickets)
    .where(isNull(helpdeskTickets.qaVerdict))
    .orderBy(desc(helpdeskTickets.updatedAt))
    .limit(100)
  if (!tickets.length) return NextResponse.json({ tickets: [] })

  const ids = tickets.map(t => t.id)
  const [analyses, links] = await Promise.all([
    db.select().from(ticketAnalyses).where(inArray(ticketAnalyses.ticketId, ids)).orderBy(desc(ticketAnalyses.createdAt)),
    db.select().from(ticketLinks).where(and(inArray(ticketLinks.ticketId, ids), eq(ticketLinks.status, 'suspected'))),
  ])

  const result = tickets
    .map(t => ({
      ...t,
      classify: analyses.find(a => a.ticketId === t.id && a.kind === 'classify')?.result as { kind?: string; reasoning?: string } | undefined ?? null,
      clarity:  analyses.find(a => a.ticketId === t.id && a.kind === 'clarity')?.result as { hasReproSteps?: boolean; hasExpectedActual?: boolean; missing?: string[] } | undefined ?? null,
      // Tika's suggested clarifying question (Phase 1) — pre-fills the "Tanya
      // ke pelapor" box for a human to review/edit/send. Latest one wins
      // (analyses is ordered createdAt desc). null when nothing was missing.
      draft:    (analyses.find(a => a.ticketId === t.id && a.kind === 'draft')?.result as { text?: string } | undefined)?.text ?? null,
      links:    links.filter(l => l.ticketId === t.id),
      // Vera findings land here once build B exists (validation_runs) — absent for now.
      vera: null as null,
    }))
    // Aufa's queue = actual bugs only; request/question/unclear tickets are
    // info-only in Rian's full view, not her decision queue.
    .filter(t => t.classify?.kind === 'bug')

  return NextResponse.json({ tickets: result })
}
