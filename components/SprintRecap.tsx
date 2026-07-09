'use client'

import { useState, useEffect } from 'react'

export interface RecapTask {
  id: number
  subject: string
  status: string
  type: string
  estimatedHours: number | null
  spentHours: number | null
  percentDone: number
  parentId?: number | null
}

const STATUS_COLOR: Record<string, string> = {
  'new': 'text-gray-400', 'in progress': 'text-blue-500',
  'on hold': 'text-amber-500', 'closed': 'text-emerald-500', 'rejected': 'text-red-400',
}
const TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  'Task':       { label: 'Task',    cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' },
  'Bug':        { label: 'Bug',     cls: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300' },
  'User Story': { label: 'Story',   cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300' },
  'Feature':    { label: 'Feature', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300' },
  'Epic':       { label: 'Epic',    cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300' },
}
function TypeBadge({ type }: { type: string }) {
  const b = TYPE_BADGE[type]
  if (!b) return <span className="inline-flex items-center px-1.5 h-4 text-[9px] font-bold rounded bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 flex-shrink-0">{type}</span>
  return <span className={`inline-flex items-center px-1.5 h-4 text-[9px] font-bold rounded ${b.cls} flex-shrink-0`}>{b.label}</span>
}
// Task/Bug are interactive (editable in ISL). Feature/Epic/User Story are
// managed at the OP level — view-only context rows, not part of batch actions.
function isManaged(type: string): boolean {
  return /^(task|bug)$/i.test(type)
}
function fmtH(h: number | null): string {
  if (h === null) return '—'
  if (h < 1) return `${Math.round(h * 60)}m`
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60)
  return mm > 0 ? `${hh}h ${mm}m` : `${hh}h`
}

const BATCH_ACTIONS: { key: string; label: string; cls: string }[] = [
  { key: 'new',         label: 'New',         cls: 'text-gray-600 border-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800' },
  { key: 'in_progress', label: 'In Progress', cls: 'text-blue-600 border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950' },
  { key: 'on_hold',     label: 'Hold',         cls: 'text-amber-600 border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950' },
  { key: 'done',        label: 'Close',        cls: 'text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950' },
]

// Compact comprehensive recap of one sprint — ALL tasks (any status) in a single
// card with a totals summary footer. Mirrors the OpenProject sprint table view.
// When onBatchStatus is provided, a "Select" mode lets the user pick multiple
// tasks and batch-set their status (New / In Progress / Hold / Close) in OP.
export default function SprintRecap({ title, subtitle, tasks, opUrl, onTaskClick, onBatchStatus }: {
  title: string
  subtitle?: string
  tasks: RecapTask[]
  opUrl: string
  onTaskClick?: (task: RecapTask) => void
  onBatchStatus?: (taskIds: number[], islStatus: string) => Promise<void>
}) {
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)

  // Reconcile selection when the tasks prop changes (e.g. a sibling revert/move or a
  // background cache-refresh removed a row). Without this a stale id stays selected
  // and a batch action would PATCH a task the user can no longer see. (Hook must run
  // before the early return below.)
  useEffect(() => {
    const valid = new Set(tasks.filter(t => isManaged(t.type)).map(t => t.id))
    setSelected(prev => {
      const kept = [...prev].filter(id => valid.has(id))
      return kept.length === prev.size ? prev : new Set(kept)
    })
  }, [tasks])

  if (!tasks.length) return null
  const rank = (s: string) => {
    const k = s.toLowerCase()
    return k.includes('progress') ? 0 : k.includes('hold') ? 1 : k.includes('closed') || k.includes('reject') ? 3 : 2
  }
  // Group by parent so a User Story's own Tasks/Bugs sit right under it, instead
  // of every row sorting flat by status (which put all User Stories together at
  // the top and all Tasks together below, looking like unrelated siblings).
  // Only one level deep — Epics are already excluded upstream, so the realistic
  // hierarchy here is US/Feature -> Task/Bug. A child whose parent isn't in this
  // same list (parent outside the sprint, or filtered out) surfaces at top level
  // rather than disappearing.
  const byId = new Map(tasks.map(t => [t.id, t]))
  const childrenOf = new Map<number, RecapTask[]>()
  const topLevel: RecapTask[] = []
  for (const t of tasks) {
    if (t.parentId != null && byId.has(t.parentId)) {
      const list = childrenOf.get(t.parentId) ?? []
      list.push(t)
      childrenOf.set(t.parentId, list)
    } else {
      topLevel.push(t)
    }
  }
  topLevel.sort((a, b) => rank(a.status) - rank(b.status) || a.id - b.id)
  const sorted: (RecapTask & { depth: number })[] = []
  for (const parent of topLevel) {
    sorted.push({ ...parent, depth: 0 })
    const kids = (childrenOf.get(parent.id) ?? []).sort((a, b) => rank(a.status) - rank(b.status) || a.id - b.id)
    for (const kid of kids) sorted.push({ ...kid, depth: 1 })
  }
  const managed    = tasks.filter(t => isManaged(t.type))
  const totalEst   = managed.reduce((a, t) => a + (t.estimatedHours ?? 0), 0)
  const totalSpent = managed.reduce((a, t) => a + (t.spentHours ?? 0), 0)
  const avgPct     = managed.length > 0 ? Math.round(managed.reduce((a, t) => a + t.percentDone, 0) / managed.length) : 0
  const c = tasks.reduce((acc, t) => {
    const k = t.status.toLowerCase()
    const key = k.includes('progress') ? 'progress' : k.includes('hold') ? 'hold' : (k.includes('closed') || k.includes('reject')) ? 'closed' : 'new'
    acc[key] = (acc[key] ?? 0) + 1; return acc
  }, {} as Record<string, number>)

  // Only managed types (not Feature/Epic) can be batch-selected.
  const selectableIds = sorted.filter(t => isManaged(t.type)).map(t => t.id)
  const allSelected = selectableIds.length > 0 && selectableIds.every(id => selected.has(id))

  function toggle(id: number) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectableIds))
  }
  async function runBatch(islStatus: string) {
    if (!onBatchStatus || busy) return
    // Send-time guard: only act on ids still present & selectable (never a phantom id).
    const ids = Array.from(selected).filter(id => selectableIds.includes(id))
    if (!ids.length) { setSelected(new Set()); return }
    setBusy(true)
    try { await onBatchStatus(ids, islStatus); setSelected(new Set()); setSelectMode(false) }
    finally { setBusy(false) }
  }

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
          {onBatchStatus && (
            <button onClick={() => { setSelectMode(v => !v); setSelected(new Set()) }}
              className={`ml-1 px-2 py-0.5 rounded-full border transition ${selectMode ? 'bg-violet-600 text-white border-violet-600' : 'border-gray-300 dark:border-gray-600 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
              {selectMode ? 'Batal' : 'Pilih'}
            </button>
          )}
        </div>
      </div>

      {/* Batch action bar */}
      {selectMode && onBatchStatus && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 dark:border-gray-700/50 bg-violet-50/50 dark:bg-violet-950/20 flex-wrap">
          <label className="flex items-center gap-1 text-[10px] font-semibold text-gray-500 cursor-pointer">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded accent-violet-600" />
            Semua ({selectableIds.length})
          </label>
          <span className="text-[10px] text-violet-600 dark:text-violet-400 font-bold">{selected.size} dipilih</span>
          <div className="flex-1" />
          {selected.size > 0 && BATCH_ACTIONS.map(a => (
            <button key={a.key} onClick={() => runBatch(a.key)} disabled={busy}
              className={`text-[10px] font-semibold px-2 py-1 rounded-lg border transition disabled:opacity-40 ${a.cls}`}>
              {busy ? '⏳' : a.label}
            </button>
          ))}
        </div>
      )}

      {/* Column headers */}
      <div className="flex items-center gap-2 px-4 py-1 bg-gray-50/80 dark:bg-gray-900/40 border-b border-gray-100 dark:border-gray-700/50 text-[9px] font-bold text-gray-400 uppercase tracking-wide">
        <span className="w-10 flex-shrink-0" />
        <span className="w-10 flex-shrink-0" />
        <span className="flex-1" />
        <span className="flex-shrink-0 w-14">Status</span>
        <span className="flex-shrink-0 w-10 text-right">Est</span>
        <span className="flex-shrink-0 w-7 text-right">Done</span>
        <span className="flex-shrink-0 w-10 text-right text-blue-400">Spent</span>
        <span className="flex-shrink-0 w-9 text-right">Sisa</span>
      </div>

      <div className="divide-y divide-gray-50 dark:divide-gray-800 max-h-72 overflow-y-auto">
        {sorted.map(t => {
          const managed = isManaged(t.type)
          const remaining = t.percentDone >= 100 ? 0 : Math.max(0, (t.estimatedHours ?? 0) - (t.spentHours ?? 0))
          const inner = (
            <>
              {t.depth > 0 && <span className="text-gray-300 dark:text-gray-600 flex-shrink-0 w-3 text-center">└</span>}
              <TypeBadge type={t.type} />
              <span className="font-mono text-[10px] text-gray-400 flex-shrink-0 w-10">#{t.id}</span>
              <span className={`flex-1 truncate text-gray-700 dark:text-gray-200 ${t.depth > 0 ? 'pl-1' : ''}`}>{t.subject}</span>
              <span className={`text-[9px] font-semibold flex-shrink-0 ${STATUS_COLOR[t.status.toLowerCase()] ?? 'text-gray-400'}`}>{t.status}</span>
              <span className="text-[10px] text-gray-400 flex-shrink-0 w-10 text-right" title="Estimated">{fmtH(t.estimatedHours)}</span>
              <span className="text-[9px] text-gray-400 flex-shrink-0 w-7 text-right">{t.percentDone}%</span>
              <span className="text-[10px] text-blue-400/80 flex-shrink-0 w-10 text-right" title="Spent">{fmtH(t.spentHours)}</span>
              <span className={`text-[10px] flex-shrink-0 w-9 text-right font-medium ${remaining === 0 ? 'text-emerald-500' : 'text-gray-400'}`} title="Remaining">
                {remaining === 0 ? '0m' : fmtH(remaining)}
              </span>
            </>
          )
          const base = 'flex items-center gap-2 px-4 py-1.5 transition text-[11px] w-full text-left'

          // Select mode: managed rows become selectable; Feature/Epic stay greyed + non-selectable.
          if (selectMode) {
            return (
              <div key={t.id}
                onClick={() => managed && toggle(t.id)}
                className={`${base} ${managed ? 'cursor-pointer hover:bg-violet-50/60 dark:hover:bg-violet-950/20' : 'opacity-40 cursor-not-allowed'} ${selected.has(t.id) ? 'bg-violet-50 dark:bg-violet-950/30' : ''}`}>
                <input type="checkbox" checked={selected.has(t.id)} disabled={!managed} readOnly
                  className="rounded accent-violet-600 flex-shrink-0" />
                {inner}
              </div>
            )
          }

          // Normal mode: managed → editable (opens OP modal); Feature/Epic → greyed link to OP.
          if (onTaskClick && managed) {
            return <button key={t.id} type="button" onClick={() => onTaskClick(t)} className={`${base} hover:bg-gray-50 dark:hover:bg-gray-800/40`}>{inner}</button>
          }
          return (
            <a key={t.id} href={`${opUrl}/work_packages/${t.id}`} target="_blank" rel="noopener"
              title={managed ? '' : 'Feature/Epic — dikelola di OpenProject'}
              className={`${base} ${managed ? 'hover:bg-gray-50 dark:hover:bg-gray-800/40' : 'opacity-40'}`}>{inner}</a>
          )
        })}
      </div>
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-t border-gray-100 dark:border-gray-700/50 bg-gray-50/60 dark:bg-gray-900/30 text-[10px] font-bold flex-wrap">
        <span className="text-gray-500">{managed.length} task{tasks.length > managed.length ? ` +${tasks.length - managed.length}` : ''}</span>
        <div className="flex items-center gap-3">
          <span className="text-gray-500">Est: <span className="text-violet-600 dark:text-violet-400">{fmtH(totalEst)}</span></span>
          <span className="text-gray-500">Spent: <span className="text-emerald-600 dark:text-emerald-400">{fmtH(totalSpent)}</span></span>
          <span className="text-gray-500">~{avgPct}%</span>
        </div>
      </div>
    </div>
  )
}
