import { NextResponse } from 'next/server'
import { pollInquiries, notifyQaIfPending } from '@/lib/helpdesk'
import { getRequestContext } from '@/lib/request-auth'
import { isOwnerUid } from '@/lib/auth'

export const runtime = 'nodejs'

const KAFI_KEY = process.env.KAFI_API_KEY

// POST /api/helpdesk/tika/poll — Tika Phase 0 shadow-mode poll. Two callers:
// (1) machine-triggered (Launcher cron) via x-kafi-key/?key, same self-gate
//     pattern as /api/internal/sync — middleware only checks key PRESENCE,
//     this route validates the VALUE;
// (2) owner's browser session, for a manual "Poll now" button in HelpdeskPanel.
// Shadow mode: writes only to helpdesk_tickets/ticket_analyses/ticket_links,
// never to OP. See lib/helpdesk.ts for the full contract.
export async function POST(req: Request) {
  const url = new URL(req.url)
  const key = req.headers.get('x-kafi-key') ?? url.searchParams.get('key')
  const machineOk = !!KAFI_KEY && key === KAFI_KEY

  if (!machineOk) {
    const ctx = await getRequestContext()
    if (process.env.ISL_MULTIUSER === '1' && !isOwnerUid(ctx?.uid)) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  try {
    const result = await pollInquiries()
    // Best-effort — a failed/skipped notify (e.g. Aufa not onboarded yet, or
    // Gmail token expired) must never fail the poll itself; un-notified
    // tickets just get retried on the next poll (qaNotifiedAt stays null).
    const notify = await notifyQaIfPending().catch(() => ({ notified: false, count: 0 }))
    return NextResponse.json({ ok: true, ...result, qaNotified: notify.count })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e).slice(0, 300) }, { status: 500 })
  }
}
