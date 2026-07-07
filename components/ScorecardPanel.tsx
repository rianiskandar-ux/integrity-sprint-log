'use client'

import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, BarChart3, AlertTriangle } from 'lucide-react'

// ── Scorecard — agent activity/efficiency dashboard ──────────────────────────
// Reads app/api/events/scorecard, a rollup of the durable agentEvents log
// (replaces ephemeral stderr/console lines). Also seeds the data needed for a
// future correction-loop feature (Luna suggestions vs actual outcomes).

interface ScorecardData {
  ok: boolean
  sinceDays: number
  arka: { local: number; fallback: number; localPct: number }
  luna: { suggestions: number; byType: Record<string, number> }
  aryo: { proposed: number; approved: number; dismissed: number; approvalPct: number }
  kafi: { pushed: number; skipped: number }
  sage: { digests: number; riskFlagged: number }
}

const DAY_OPTIONS = [7, 30, 90] as const
const LUNA_TYPES = ['push_existing', 'new_task', 'delete', 'keep'] as const

export default function ScorecardPanel() {
  const [days, setDays]           = useState<number>(30)
  const [data, setData]           = useState<ScorecardData | null>(null)
  const [loading, setLoading]     = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (d: number) => {
    try {
      const r = await fetch(`/api/events/scorecard?days=${d}`)
      const json = await r.json()
      if (json.ok) setData(json)
    } catch { /* offline — keep last known data */ }
  }, [])

  useEffect(() => {
    setLoading(true)
    load(days).finally(() => setLoading(false))
  }, [days, load])

  async function refresh() {
    setRefreshing(true)
    await load(days)
    setRefreshing(false)
  }

  const hasAnyData = !!data && (
    data.arka.local + data.arka.fallback +
    data.luna.suggestions +
    data.aryo.proposed +
    data.kafi.pushed + data.kafi.skipped +
    data.sage.digests
  ) > 0

  if (loading) return (
    <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Memuat scorecard…</div>
  )

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <BarChart3 size={16} /> Scorecard
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">Aktivitas & efisiensi agent — dari log agent_events</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            {DAY_OPTIONS.map(d => (
              <button key={d} onClick={() => setDays(d)}
                className={`px-2.5 py-1.5 text-xs font-semibold transition ${
                  days === d
                    ? 'bg-cyan-500 text-white'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}>
                {d}d
              </button>
            ))}
          </div>
          <button
            onClick={refresh}
            disabled={refreshing}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition">
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Empty state */}
      {!data || !hasAnyData ? (
        <div className="text-center text-gray-400 text-sm py-12">
          <div className="flex justify-center mb-3"><BarChart3 size={40} className="text-gray-300 dark:text-gray-600" /></div>
          <p>Belum ada data — jalankan agent dulu.</p>
          <p className="text-xs mt-1 text-gray-300 dark:text-gray-600">
            Event akan muncul di sini setelah Arka/Luna/Aryo/Kafi/Sage jalan dan mulai logging.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

          {/* Arka — local vs Claude-fallback split */}
          <div className="rounded-xl border p-4 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">Arka — Summarization</h3>
              <span className="text-[10px] text-gray-400">local vs fallback</span>
            </div>
            <div className="text-2xl font-extrabold text-cyan-500">
              {data.arka.localPct}% <span className="text-xs font-semibold text-gray-400">lokal</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden flex">
              <div className="h-full bg-emerald-400" style={{ width: `${data.arka.localPct}%` }} />
              <div className="h-full bg-amber-400" style={{ width: `${100 - data.arka.localPct}%` }} />
            </div>
            <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-400">
              <span><span className="text-emerald-500 font-semibold">{data.arka.local}</span> local</span>
              <span><span className="text-amber-500 font-semibold">{data.arka.fallback}</span> fallback</span>
            </div>
          </div>

          {/* Luna — suggestion breakdown */}
          <div className="rounded-xl border p-4 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">Luna — Triage Suggestions</h3>
              <span className="text-[10px] text-gray-400">{data.luna.suggestions} total</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5 mt-2">
              {LUNA_TYPES.map(key => (
                <div key={key} className="text-center rounded-lg bg-gray-50 dark:bg-gray-900/40 py-2">
                  <div className="text-sm font-bold text-gray-700 dark:text-gray-200">{data.luna.byType[key] ?? 0}</div>
                  <div className="text-[9px] text-gray-400 mt-0.5 leading-tight">{key.replace('_', ' ')}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Aryo — proposed/approved/dismissed */}
          <div className="rounded-xl border p-4 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">Aryo — Insights</h3>
              <span className="text-[10px] text-gray-400">{data.aryo.approvalPct}% approved</span>
            </div>
            <div className="flex items-center gap-4 text-[11px] text-gray-400">
              <span>proposed <strong className="text-gray-700 dark:text-gray-200">{data.aryo.proposed}</strong></span>
              <span>approved <strong className="text-emerald-500">{data.aryo.approved}</strong></span>
              <span>dismissed <strong className="text-red-400">{data.aryo.dismissed}</strong></span>
            </div>
          </div>

          {/* Kafi — pushed vs skipped */}
          <div className="rounded-xl border p-4 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-2">Kafi — Field Capture</h3>
            <div className="flex items-center gap-4 text-[11px] text-gray-400">
              <span>pushed <strong className="text-emerald-500">{data.kafi.pushed}</strong></span>
              <span>skipped <strong className="text-gray-500">{data.kafi.skipped}</strong></span>
            </div>
          </div>

          {/* Sage — digests + risk-flagged runs */}
          <div className="rounded-xl border p-4 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100 mb-2">Sage — AI Digest</h3>
            <div className="flex items-center gap-4 text-[11px] text-gray-400">
              <span>digests <strong className="text-gray-700 dark:text-gray-200">{data.sage.digests}</strong></span>
              <span className="flex items-center gap-1">
                risk flagged
                <strong className={data.sage.riskFlagged > 0 ? 'text-red-500' : 'text-gray-500'}>
                  {data.sage.riskFlagged}
                </strong>
                {data.sage.riskFlagged > 0 && <AlertTriangle size={11} className="text-amber-500" />}
              </span>
            </div>
          </div>

        </div>
      )}
    </div>
  )
}
