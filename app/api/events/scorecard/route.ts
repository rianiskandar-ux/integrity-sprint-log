import { NextRequest, NextResponse } from 'next/server'
import { db, agentEvents } from '@/lib/db'
import { gte } from 'drizzle-orm'
import { getRequestContext } from '@/lib/request-auth'

export const runtime = 'nodejs'

// ── Scorecard — agent activity/efficiency aggregation ────────────────────────
// Reads the raw agentEvents log and rolls it up into per-agent stats consumed
// by components/ScorecardPanel.tsx. One DB query, simple JS aggregation after —
// volumes here are small (event log, not raw session data).

const LUNA_SUGGESTIONS = ['push_existing', 'new_task', 'delete', 'keep'] as const

// ── Auth: machine key OR browser session — same dual pattern as events/log ───
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

export async function GET(req: NextRequest) {
  try {
    if (!(await isAuthed(req))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const daysParam = new URL(req.url).searchParams.get('days')
    const sinceDays = Math.max(1, Math.min(365, Number(daysParam) || 30))
    const since = new Date(Date.now() - sinceDays * 86_400_000)

    const rows = await db.select().from(agentEvents).where(gte(agentEvents.createdAt, since))

    // ── Grouped counts by (agent, event) ────────────────────────────────────
    const counts: Record<string, Record<string, number>> = {}
    for (const r of rows) {
      const byEvent = (counts[r.agent] ??= {})
      byEvent[r.event] = (byEvent[r.event] ?? 0) + 1
    }
    const countOf = (agent: string, event: string) => counts[agent]?.[event] ?? 0

    // ── Arka: local vs Claude-fallback summarization split ──────────────────
    const arkaLocal    = countOf('arka', 'summary_local')
    const arkaFallback = countOf('arka', 'summary_fallback')
    const arkaTotal    = arkaLocal + arkaFallback

    // ── Luna: suggestion breakdown by type (from meta.suggestion) ───────────
    const lunaByType: Record<string, number> = { push_existing: 0, new_task: 0, delete: 0, keep: 0 }
    for (const r of rows) {
      if (r.agent !== 'luna' || r.event !== 'suggestion_made') continue
      const s = (r.meta as { suggestion?: string } | null)?.suggestion
      if (s && (LUNA_SUGGESTIONS as readonly string[]).includes(s)) lunaByType[s]++
    }

    // ── Aryo: proposed/approved/dismissed + approval % (of decided insights) ─
    const aryoProposed  = countOf('aryo', 'insight_proposed')
    const aryoApproved  = countOf('aryo', 'insight_approved')
    const aryoDismissed = countOf('aryo', 'insight_dismissed')
    const aryoDecided   = aryoApproved + aryoDismissed

    // ── Kafi: pushed vs skipped runs ──────────────────────────────────────────
    const kafiPushed  = countOf('kafi', 'pushed')
    const kafiSkipped = countOf('kafi', 'skipped')

    // ── Sage: digests generated + how many flagged a security risk ──────────
    const sageDigests = countOf('sage', 'digest_generated')
    let sageRiskFlagged = 0
    for (const r of rows) {
      if (r.agent !== 'sage' || r.event !== 'digest_generated') continue
      if ((r.meta as { riskFlagged?: boolean } | null)?.riskFlagged === true) sageRiskFlagged++
    }

    return NextResponse.json({
      ok: true,
      sinceDays,
      arka: {
        local:    arkaLocal,
        fallback: arkaFallback,
        localPct: arkaTotal > 0 ? Math.round((arkaLocal / arkaTotal) * 100) : 0,
      },
      luna: {
        suggestions: countOf('luna', 'suggestion_made'),
        byType:      lunaByType,
      },
      aryo: {
        proposed:    aryoProposed,
        approved:    aryoApproved,
        dismissed:   aryoDismissed,
        approvalPct: aryoDecided > 0 ? Math.round((aryoApproved / aryoDecided) * 100) : 0,
      },
      kafi: {
        pushed:  kafiPushed,
        skipped: kafiSkipped,
      },
      sage: {
        digests:     sageDigests,
        riskFlagged: sageRiskFlagged,
      },
    })
  } catch (e) {
    console.error('[events/scorecard] error:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
