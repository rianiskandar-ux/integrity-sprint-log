'use client'

export interface RecapTask {
  id: number
  subject: string
  status: string
  type: string
  estimatedHours: number | null
  spentHours: number | null
  percentDone: number
}

const STATUS_COLOR: Record<string, string> = {
  'new': 'text-gray-400', 'in progress': 'text-blue-500',
  'on hold': 'text-amber-500', 'closed': 'text-emerald-500', 'rejected': 'text-red-400',
}
const TYPE_ICON: Record<string, string> = {
  'Task': '⬜', 'User Story': '🔵', 'Bug': '🔴', 'Feature': '🟢', 'Epic': '🟣',
}
function fmtH(h: number | null): string {
  if (h === null) return '—'
  if (h < 1) return `${Math.round(h * 60)}m`
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60)
  return mm > 0 ? `${hh}h ${mm}m` : `${hh}h`
}

// Compact comprehensive recap of one sprint — ALL tasks (any status) in a single
// card with a totals summary footer. Mirrors the OpenProject sprint table view.
export default function SprintRecap({ title, subtitle, tasks, opUrl, onTaskClick }: {
  title: string
  subtitle?: string
  tasks: RecapTask[]
  opUrl: string
  onTaskClick?: (task: RecapTask) => void
}) {
  if (!tasks.length) return null
  const rank = (s: string) => {
    const k = s.toLowerCase()
    return k.includes('progress') ? 0 : k.includes('hold') ? 1 : k.includes('closed') || k.includes('reject') ? 3 : 2
  }
  const sorted = [...tasks].sort((a, b) => rank(a.status) - rank(b.status) || a.id - b.id)
  const totalEst   = tasks.reduce((a, t) => a + (t.estimatedHours ?? 0), 0)
  const totalSpent = tasks.reduce((a, t) => a + (t.spentHours ?? 0), 0)
  const avgPct     = Math.round(tasks.reduce((a, t) => a + t.percentDone, 0) / tasks.length)
  const c = tasks.reduce((acc, t) => {
    const k = t.status.toLowerCase()
    const key = k.includes('progress') ? 'progress' : k.includes('hold') ? 'hold' : (k.includes('closed') || k.includes('reject')) ? 'closed' : 'new'
    acc[key] = (acc[key] ?? 0) + 1; return acc
  }, {} as Record<string, number>)

  return (
    <div className="rounded-2xl border border-gray-100 dark:border-gray-700/50 bg-white dark:bg-gray-800/60 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-gray-100 dark:border-gray-700/50 bg-gray-50/60 dark:bg-gray-900/30 flex-wrap">
        <div>
          <p className="text-xs font-black text-gray-700 dark:text-gray-100">{title}</p>
          {subtitle && <p className="text-[10px] text-gray-400">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-1 text-[9px] font-bold flex-wrap">
          {c.progress ? <span className="px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950 text-blue-500">{c.progress} aktif</span> : null}
          {c.new ? <span className="px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">{c.new} new</span> : null}
          {c.hold ? <span className="px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950 text-amber-500">{c.hold} hold</span> : null}
          {c.closed ? <span className="px-1.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950 text-emerald-500">{c.closed} done</span> : null}
        </div>
      </div>
      <div className="divide-y divide-gray-50 dark:divide-gray-800 max-h-72 overflow-y-auto">
        {sorted.map(t => {
          const inner = (
            <>
              <span className="flex-shrink-0">{TYPE_ICON[t.type] ?? '⬜'}</span>
              <span className="font-mono text-[10px] text-gray-400 flex-shrink-0 w-10">#{t.id}</span>
              <span className="flex-1 truncate text-gray-700 dark:text-gray-200">{t.subject}</span>
              <span className={`text-[9px] font-semibold flex-shrink-0 ${STATUS_COLOR[t.status.toLowerCase()] ?? 'text-gray-400'}`}>{t.status}</span>
              <span className="text-[10px] text-gray-400 flex-shrink-0 w-12 text-right">{fmtH(t.estimatedHours)}</span>
              <span className="text-[9px] text-gray-400 flex-shrink-0 w-8 text-right">{t.percentDone}%</span>
            </>
          )
          const cls = 'flex items-center gap-2 px-4 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition text-[11px] w-full text-left'
          return onTaskClick
            ? <button key={t.id} type="button" onClick={() => onTaskClick(t)} className={cls}>{inner}</button>
            : <a key={t.id} href={`${opUrl}/work_packages/${t.id}`} target="_blank" rel="noopener" className={cls}>{inner}</a>
        })}
      </div>
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-t border-gray-100 dark:border-gray-700/50 bg-gray-50/60 dark:bg-gray-900/30 text-[10px] font-bold flex-wrap">
        <span className="text-gray-500">{tasks.length} task</span>
        <div className="flex items-center gap-3">
          <span className="text-gray-500">Est: <span className="text-violet-600 dark:text-violet-400">{fmtH(totalEst)}</span></span>
          <span className="text-gray-500">Spent: <span className="text-emerald-600 dark:text-emerald-400">{fmtH(totalSpent)}</span></span>
          <span className="text-gray-500">~{avgPct}%</span>
        </div>
      </div>
    </div>
  )
}
