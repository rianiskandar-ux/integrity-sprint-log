import { NextResponse } from 'next/server'
import { db, helpdeskTickets, ticketAnalyses, ticketLinks } from '@/lib/db'
import { desc, eq, inArray } from 'drizzle-orm'
import { getRequestContext } from '@/lib/request-auth'
import { isOwnerUid } from '@/lib/auth'

export const runtime = 'nodejs'

// GET /api/helpdesk/tickets — Tika Phase 0 shadow-mode read view. Owner-only
// (PRD NG5: not multi-tenant, single global backlog Rian reviews) — mirrors
// the gating pattern used by other owner-only routes (llm/models, user-config).
export async function GET() {
  if (process.env.ISL_MULTIUSER === '1') {
    const ctx = await getRequestContext()
    if (!isOwnerUid(ctx?.uid)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const tickets = await db.select().from(helpdeskTickets).orderBy(desc(helpdeskTickets.updatedAt)).limit(100)
  if (!tickets.length) return NextResponse.json({ tickets: [] })

  const ids = tickets.map(t => t.id)
  const [analyses, links] = await Promise.all([
    db.select().from(ticketAnalyses).where(inArray(ticketAnalyses.ticketId, ids)).orderBy(desc(ticketAnalyses.createdAt)),
    db.select().from(ticketLinks).where(inArray(ticketLinks.ticketId, ids)),
  ])

  const result = tickets.map(t => ({
    ...t,
    // Latest analysis per kind only — history stays in the table, view shows current state.
    classify: analyses.find(a => a.ticketId === t.id && a.kind === 'classify')?.result ?? null,
    clarity:  analyses.find(a => a.ticketId === t.id && a.kind === 'clarity')?.result ?? null,
    links:    links.filter(l => l.ticketId === t.id),
  }))

  return NextResponse.json({ tickets: result })
}
