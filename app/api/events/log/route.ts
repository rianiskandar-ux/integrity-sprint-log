import { NextRequest, NextResponse } from 'next/server'
import { db, agentEvents } from '@/lib/db'
import { getRequestContext } from '@/lib/request-auth'

export const runtime = 'nodejs'

// ── Agent Events Log — durable event log for agent activity ─────────────────
// Replaces ephemeral stderr/console lines with a queryable Postgres log.
// Feeds the Scorecard dashboard (app/api/events/scorecard) and seeds data for
// a future correction loop (Luna's suggestions vs actual outcomes).
// Fire-and-forget by design: callers should never let a failed log call break
// their main flow, so this route always returns 200 with { ok: boolean }.

const KNOWN_AGENTS: ReadonlySet<string> = new Set(['arka', 'luna', 'aryo', 'kafi', 'sage'])

// ── Auth: machine key (hooks/host-side callers) OR browser session — EITHER ──
async function isAuthed(req: NextRequest): Promise<boolean> {
  const key = process.env.KAFI_API_KEY || 'kafi-bridge-2026'
  const machineAuth =
    req.headers.get('x-kafi-key') === key ||
    new URL(req.url).searchParams.get('key') === key
  if (machineAuth) return true

  try {
    const ctx = await getRequestContext()
    return !!ctx
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!(await isAuthed(req))) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => null) as
      { agent?: string; event?: string; meta?: Record<string, unknown> } | null

    if (!body || typeof body.agent !== 'string' || typeof body.event !== 'string' || !body.agent || !body.event) {
      return NextResponse.json({ ok: false, error: 'Body harus { agent, event, meta? }' }, { status: 400 })
    }
    if (!KNOWN_AGENTS.has(body.agent)) {
      // Non-fatal — accept anyway so a new agent doesn't need a code change to log,
      // but flag it wasn't a recognized id.
      console.warn(`[events/log] unrecognized agent: ${body.agent}`)
    }

    const id = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await db.insert(agentEvents).values({
      id,
      agent: body.agent,
      event: body.event,
      meta: body.meta && typeof body.meta === 'object' ? body.meta : null,
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[events/log] error:', e)
    return NextResponse.json({ ok: false })
  }
}
