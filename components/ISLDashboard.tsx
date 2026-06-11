'use client'

import { useState, useEffect } from 'react'

const BRAND = '#1d3a5c'
const RED   = '#cc1a2e'

interface DashData {
  queue: { count: number; sessions: { id: string; title: string; date: string }[] }
  autoLog: { totalPushed: number; recent: { id: string; title: string; date: string; opTaskId: number | null; actualMins: number }[]; todayCount: number; todayMins: number }
  incoming: { total: number; newCount: number; preview: { id: number; subject: string; status: string }[] }
  sprint: { current: { id: number; name: string; startDate: string; endDate: string } | null; stats: { total: number; done: number; pct: number } | null }
  backlog: { count: number; preview: { id: number; subject: string }[] }
}

function fmtMins(m: number) {
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60), min = m % 60
  return min > 0 ? `${h}h ${min}m` : `${h}h`
}

function daysLeft(endDate: string) {
  return Math.ceil((new Date(endDate).getTime() - Date.now()) / 86400000)
}

interface Props { onNavigate: (view: string) => void; onReport?: () => void }

// Horizontal stat strip card (like reference top cards)
function StatStrip({ icon, label, count, sub, gradient, badge, onClick }: {
  icon: string; label: string; count: number | string; sub: string
  gradient: string; badge?: string; onClick: () => void
}) {
  return (
    <button onClick={onClick}
      className="group relative text-left rounded-2xl overflow-hidden hover:shadow-xl hover:-translate-y-0.5 transition-all w-full"
      style={{ background: gradient }}>
      <div className="absolute -right-4 -top-4 w-24 h-24 rounded-full bg-white/10 pointer-events-none" />
      <div className="absolute right-4 bottom-2 w-14 h-14 rounded-full bg-white/5 pointer-events-none" />
      <div className="flex items-center gap-4 px-5 py-4 relative z-10">
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-white/60 mb-0.5">{label}</p>
          <p className="text-2xl font-black text-white leading-none">{count}</p>
          <p className="text-[10px] text-white/60 mt-0.5">{sub}</p>
        </div>
        {badge && (
          <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/25 text-white flex-shrink-0">
            {badge}
          </span>
        )}
        <span className="text-2xl ml-auto opacity-70 flex-shrink-0">{icon}</span>
      </div>
    </button>
  )
}

export default function ISLDashboard({ onNavigate, onReport }: Props) {
  const [data, setData]       = useState<DashData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    load()
    window.addEventListener('isl:session-updated', load)
    return () => window.removeEventListener('isl:session-updated', load)
  }, [])

  async function load() {
    setLoading(true)
    try { setData(await fetch('/api/isl/dashboard').then(r => r.json())) } catch {}
    setLoading(false)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: `${RED} ${RED} ${RED} transparent` }} />
    </div>
  )

  if (!data) return null

  const { queue, autoLog, incoming, sprint, backlog } = data
  const days  = sprint.current ? daysLeft(sprint.current.endDate) : null
  const today = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    // Two-panel layout: main content + right summary panel
    <div className="flex gap-6 h-full min-h-0">

      {/* ── LEFT / MAIN CONTENT ──────────────────────────────── */}
      <div className="flex-1 min-w-0 overflow-y-auto pr-0.5 space-y-6 pb-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img
              src="https://www.integrity-indonesia.com/wp-content/uploads/sites/3/2025/03/int-logo-integrity.webp"
              alt="Integrity"
              className="h-7 w-auto object-contain dark:brightness-90"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
            <div className="w-px h-7 bg-gray-200 dark:bg-gray-700" />
            <div>
              <p className="text-[10px] text-gray-400">{today}</p>
              <h1 className="text-lg font-black text-gray-900 dark:text-gray-100 tracking-tight leading-none">ISL Dashboard</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onReport && (
              <button onClick={onReport}
                className="text-xs font-bold px-3 py-1.5 rounded-xl text-white transition hover:opacity-90"
                style={{ background: `linear-gradient(135deg, ${BRAND}, #2a5298)` }}>
                📋 Generate Report
              </button>
            )}
            <button onClick={load}
              className="text-xs font-medium text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-200 dark:border-gray-700 px-3 py-1.5 rounded-xl transition">
              Refresh
            </button>
          </div>
        </div>

        {/* Top 3 stat strips */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatStrip
            icon="📥"
            label="Incoming"
            count={incoming.total}
            sub="tasks from OpenProject"
            badge={incoming.newCount > 0 ? `${incoming.newCount} new` : undefined}
            gradient={`linear-gradient(135deg, ${BRAND} 0%, #2a5298 100%)`}
            onClick={() => onNavigate('incoming')}
          />
          <StatStrip
            icon="📤"
            label="Push Queue"
            count={queue.count}
            sub="awaiting approval"
            badge={queue.count > 0 ? `${queue.count} pending` : undefined}
            gradient={queue.count > 0
              ? `linear-gradient(135deg, ${RED} 0%, #ff4d5e 100%)`
              : `linear-gradient(135deg, #475569 0%, #64748b 100%)`}
            onClick={() => onNavigate('pushqueue')}
          />
          <StatStrip
            icon="🤖"
            label="Auto Log"
            count={autoLog.totalPushed}
            sub="sessions logged to OP"
            badge={autoLog.todayCount > 0 ? `+${autoLog.todayCount} today` : undefined}
            gradient="linear-gradient(135deg, #059669 0%, #10b981 100%)"
            onClick={() => onNavigate('autolog')}
          />
        </div>

        {/* Sprint + Backlog row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Sprint card */}
          <button onClick={() => onNavigate('sprint')}
            className="group text-left rounded-2xl border border-gray-100 dark:border-gray-700/50 bg-white dark:bg-gray-800/80 hover:shadow-md hover:-translate-y-0.5 transition-all p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg bg-violet-50 dark:bg-violet-900/30">🗓</div>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-violet-500 dark:text-violet-400">Sprint</p>
                  {sprint.current && <p className="text-[10px] text-gray-400 font-medium">{sprint.current.name}</p>}
                </div>
              </div>
              {days !== null && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  days <= 2 ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                  : days <= 5 ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
                  : 'bg-violet-50 text-violet-500 dark:bg-violet-900/30 dark:text-violet-400'
                }`}>
                  {days > 0 ? `${days}d left` : 'ends today'}
                </span>
              )}
            </div>
            {sprint.stats ? (
              <>
                <div className="flex items-end gap-2 mb-2">
                  <p className="text-3xl font-black text-gray-900 dark:text-gray-50">{sprint.stats.done}</p>
                  <p className="text-sm text-gray-400 pb-1">/ {sprint.stats.total} tasks done</p>
                </div>
                <div className="w-full h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all"
                    style={{ width: `${sprint.stats.pct}%`, background: 'linear-gradient(to right, #7c3aed, #a78bfa)' }} />
                </div>
                <p className="text-[10px] text-gray-400 mt-1.5">{sprint.stats.pct}% complete · {sprint.stats.total - sprint.stats.done} remaining</p>
              </>
            ) : (
              <p className="text-sm text-gray-400">No active sprint</p>
            )}
            <p className="mt-3 text-[11px] font-bold text-violet-500 dark:text-violet-400">View sprint plan →</p>
          </button>

          {/* Backlog card */}
          <button onClick={() => onNavigate('backlog')}
            className="group text-left rounded-2xl border border-gray-100 dark:border-gray-700/50 bg-white dark:bg-gray-800/80 hover:shadow-md hover:-translate-y-0.5 transition-all p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg bg-orange-50 dark:bg-orange-900/20">🗃</div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-orange-500">Backlog</p>
              </div>
            </div>
            <p className="text-3xl font-black text-gray-900 dark:text-gray-50 mb-1">{backlog.count}</p>
            <p className="text-xs text-gray-400 mb-3">tasks in backlog</p>
            <div className="space-y-1.5 border-t border-gray-50 dark:border-gray-700/50 pt-3">
              {backlog.preview.slice(0, 2).map(t => (
                <p key={t.id} className="text-[10px] text-gray-500 dark:text-gray-400 truncate flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full flex-shrink-0 bg-orange-400" />
                  #{t.id} {t.subject}
                </p>
              ))}
              {backlog.count > 2 && <p className="text-[10px] text-gray-400">+{backlog.count - 2} more</p>}
            </div>
            <p className="mt-3 text-[11px] font-bold text-orange-500">View backlog →</p>
          </button>
        </div>

        {/* Recent logs table */}
        {autoLog.recent.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-bold text-gray-800 dark:text-gray-100">Recent Logs</p>
              <button onClick={() => onNavigate('autolog')}
                className="text-[10px] font-bold hover:underline"
                style={{ color: RED }}>
                See all
              </button>
            </div>
            <div className="rounded-2xl border border-gray-100 dark:border-gray-700/50 bg-white dark:bg-gray-800/80 overflow-hidden">
              <div className="grid grid-cols-[auto_1fr_auto] text-[9px] font-black uppercase tracking-widest text-gray-400 px-5 py-2.5 border-b border-gray-50 dark:border-gray-700/50">
                <span className="w-8">#</span>
                <span>Task</span>
                <span>Time</span>
              </div>
              {autoLog.recent.slice(0, 4).map((s, i) => (
                <div key={s.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-5 py-3 border-b border-gray-50 dark:border-gray-700/30 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                    style={{ background: `linear-gradient(135deg, ${BRAND}, #2a5298)` }}>
                    {i + 1}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">{s.title}</p>
                    {s.opTaskId && <p className="text-[10px] text-gray-400">OP #{s.opTaskId}</p>}
                  </div>
                  <span className="text-xs font-bold text-gray-500 dark:text-gray-400">{fmtMins(s.actualMins)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Flow nav */}
        <div className="flex items-center justify-center gap-1 flex-wrap">
          {(['incoming','pushqueue','autolog','sprint','backlog'] as const).map((v, i, arr) => (
            <>
              <button key={v} onClick={() => onNavigate(v)}
                className="text-[10px] font-medium px-2 py-1 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition capitalize">
                {v === 'pushqueue' ? 'Push Queue' : v === 'autolog' ? 'Auto Log' : v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
              {i < arr.length - 1 && (
                <svg key={`sep-${v}`} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-200 dark:text-gray-700 flex-shrink-0"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              )}
            </>
          ))}
        </div>
      </div>

      {/* ── RIGHT SUMMARY PANEL ──────────────────────────────── */}
      <div className="w-64 flex-shrink-0 hidden lg:flex flex-col gap-4 overflow-y-auto pb-6">

        {/* Today summary card */}
        <div className="rounded-2xl border border-gray-100 dark:border-gray-700/50 bg-white dark:bg-gray-800/80 p-5">
          <p className="text-sm font-black text-gray-800 dark:text-gray-100 mb-4">Summary</p>

          <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">Today's Sessions</p>
          <div className="flex items-end gap-2 mb-4">
            <p className="text-3xl font-black text-gray-900 dark:text-gray-50 leading-none">{autoLog.todayCount}</p>
            {autoLog.todayMins > 0 && (
              <p className="text-sm font-bold pb-0.5" style={{ color: RED }}>{fmtMins(autoLog.todayMins)}</p>
            )}
            <button className="ml-auto w-7 h-7 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
              style={{ background: RED }}
              onClick={() => onNavigate('autolog')}>
              +
            </button>
          </div>

          {sprint.stats && (
            <>
              <div className="h-px bg-gray-50 dark:bg-gray-700 mb-4" />
              <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-2">Sprint Progress</p>
              <div className="w-full h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden mb-1.5">
                <div className="h-full rounded-full transition-all"
                  style={{ width: `${sprint.stats.pct}%`, background: `linear-gradient(to right, ${RED}, #ff5a6a)` }} />
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-gray-400">{sprint.stats.done} done</span>
                <span className="font-bold" style={{ color: RED }}>{sprint.stats.pct}%</span>
              </div>
            </>
          )}
        </div>

        {/* Activity feed */}
        <div className="rounded-2xl border border-gray-100 dark:border-gray-700/50 bg-white dark:bg-gray-800/80 p-5 flex-1">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-black text-gray-800 dark:text-gray-100">Activity</p>
            <button onClick={() => onNavigate('autolog')}
              className="text-[10px] font-bold hover:underline" style={{ color: RED }}>
              See all
            </button>
          </div>

          <div className="space-y-3">
            {autoLog.recent.slice(0, 5).map(s => (
              <div key={s.id} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center text-white text-[10px] font-bold"
                  style={{ background: `linear-gradient(135deg, ${BRAND}, #2a5298)` }}>
                  🤖
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-gray-800 dark:text-gray-200 leading-snug truncate">{s.title}</p>
                  {s.opTaskId && <p className="text-[9px] text-gray-400">OP #{s.opTaskId}</p>}
                </div>
                <span className="text-[10px] font-bold text-gray-400 flex-shrink-0">{fmtMins(s.actualMins)}</span>
              </div>
            ))}
            {autoLog.recent.length === 0 && (
              <p className="text-[11px] text-gray-400 text-center py-4">No logs yet today</p>
            )}
          </div>

          {queue.count > 0 && (
            <>
              <div className="h-px bg-gray-50 dark:bg-gray-700 my-4" />
              <button onClick={() => onNavigate('pushqueue')}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold transition hover:opacity-90"
                style={{ background: '#fef2f2', color: RED }}>
                <span className="w-2 h-2 rounded-full bg-current animate-pulse" />
                {queue.count} session pending review
              </button>
            </>
          )}

          {incoming.newCount > 0 && (
            <button onClick={() => onNavigate('incoming')}
              className="mt-2 w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold transition hover:opacity-90"
              style={{ background: '#eff6ff', color: BRAND }}>
              <span className="w-2 h-2 rounded-full bg-current" />
              {incoming.newCount} new incoming tasks
            </button>
          )}
        </div>

      </div>
    </div>
  )
}
