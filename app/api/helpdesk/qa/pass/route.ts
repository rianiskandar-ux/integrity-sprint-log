import { NextResponse } from 'next/server'
import { db, helpdeskTickets } from '@/lib/db'
import { and, eq, isNull } from 'drizzle-orm'
import { getRequestContext } from '@/lib/request-auth'
import { isQaOrOwner, routeToPushQueueIfReady } from '@/lib/helpdesk'

export const runtime = 'nodejs'

// POST /api/helpdesk/qa/pass { ticketId } — Aufa's PASS decision (PRD §16.2
// build A). Records who/when (audit trail) and attempts routing immediately;
// if the OP ticket has no assignee (or the assignee has no ISL account yet),
// the ticket just stays qaVerdict='pass' with pushedToQueueAt null — visible
// in the Helpdesk view as [UNASSIGNED], NOT routed to the owner's own queue
// (Rian's explicit correction). Tika's next poll retries routing once an
// assignee appears. No REJECT endpoint by design — reject happens directly
// in OP, and the ticket drops out of intake (Inquiries = open tickets only)
// on the next poll.
export async function POST(req: Request) {
  const ctx = await getRequestContext()
  if (process.env.ISL_MULTIUSER === '1' && !(await isQaOrOwner(ctx?.uid))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as { ticketId?: string }
  const ticketId = (body.ticketId ?? '').trim()
  if (!ticketId) return NextResponse.json({ error: 'ticketId required' }, { status: 400 })

  const decidedBy = ctx?.uid ?? null
  const updated = (await db.update(helpdeskTickets)
    .set({ qaVerdict: 'pass', qaDecidedBy: decidedBy, qaDecidedAt: new Date() })
    .where(and(eq(helpdeskTickets.id, ticketId), isNull(helpdeskTickets.qaVerdict)))
    .returning())[0]

  if (!updated) return NextResponse.json({ error: 'Ticket tidak ditemukan atau sudah diputuskan sebelumnya' }, { status: 409 })

  const routed = await routeToPushQueueIfReady(updated)
  return NextResponse.json({
    ok: true,
    routed,
    assigneeName: updated.assigneeName,
    message: routed
      ? `Masuk ke Push Queue milik ${updated.assigneeName}`
      : updated.assigneeOpUserId
        ? `${updated.assigneeName ?? 'Assignee'} belum punya akun ISL — menunggu, akan otomatis masuk saat dia login`
        : 'Belum ada assignee di OP — tetap di Helpdesk sampai di-assign',
  })
}
