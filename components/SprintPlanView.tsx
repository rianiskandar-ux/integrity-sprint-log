'use client'

import { useState, useEffect } from 'react'
import { useI18n } from '@/lib/i18n'
import TaskChatModal, { type TaskChatContext } from './TaskChatModal'
import SprintRecap, { type RecapTask } from './SprintRecap'
import OpTaskModal from './OpTaskModal'
import {
  CalendarDays, RefreshCw, Loader2, Sparkles, Bot, Lightbulb,
  MessageCircle, Folder, Clock, Send, ClipboardList, Lock, Pencil,
  BarChart2, Target, CheckCircle2, X, Zap,
} from 'lucide-react'

interface TaskItem {
  id: number
  subject: string
  status: string
  type: string
  project: string
  assignee: string | null
  estimatedHours: number | null
  spentHours: number | null
  percentDone: number
}

interface SprintInfo {
  id: number
  name: string
  startDate: string
  endDate: string
  isCurrent: boolean
}

interface SprintMeta {
  id: number
  name: string
  startDate: string
  endDate: string
  isCurrent: boolean
}

interface AiName {
  full: string | null
  theme: string | null
  goal: string | null
  suggestions: string[]
}

interface AiSuggestItem {
  subject: string
  type: string
  projectHint: string
  estimatedHours: number
  priority: 'high' | 'medium' | 'low'
  reason: string
}

interface PlanData {
  currentSprint: SprintInfo
  nextSprint: SprintInfo | null
  carryOver: TaskItem[]
  doneTasks: TaskItem[]
  nextTasks: TaskItem[]
  isHistorical: boolean
  aiName: AiName | null
  aiSummary: string | null
  aiSuggestedTasks: AiSuggestItem[]
  suggestedNum: number
}

const STATUS_COLOR: Record<string, string> = {
  'new':         'text-gray-400',
  'in progress': 'text-blue-500',
  'on hold':     'text-amber-500',
  'closed':      'text-emerald-500',
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
  if (!b) return <span className="inline-flex items-center justify-center px-1.5 h-4 text-[9px] font-bold rounded bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 flex-shrink-0">{type}</span>
  return <span className={`inline-flex items-center justify-center px-1.5 h-4 text-[9px] font-bold rounded ${b.cls} flex-shrink-0`}>{b.label}</span>
}

// Tasks/Bugs are interactive (selectable, clickable, editable).
// User Stories, Features, etc. are shown as read-only context rows.
function isInteractive(t: { type: string }): boolean {
  return t.type === 'Task' || t.type === 'Bug'
}

type Tab = 'active' | 'new' | 'done'

function fmtH(h: number | null): string {
  if (h === null) return '—'
  if (h < 1) return `${Math.round(h * 60)}m`
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60)
  return mm > 0 ? `${hh}h ${mm}m` : `${hh}h`
}

function statusKey(s: string) { return s.toLowerCase() }

export default function SprintPlanView({ initialSprintId }: { initialSprintId?: number | null } = {}) {
  const { t } = useI18n()
  const [data, setData]               = useState<PlanData | null>(null)
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState<string | null>(null)
  const [opUrl, setOpUrl]             = useState('https://tokek.integrity-asia.com')
  const [tab, setTab]                 = useState<Tab>('active')
  const [projectFilter, setProjectFilter] = useState<string>('all')
  const [customTheme, setCustomTheme] = useState('')
  const [aiLoading, setAiLoading]         = useState(false)
  const [reloading, setReloading]         = useState(false)
  const [sendingToQueue, setSendingToQueue] = useState(false)
  const [selectedSuggests, setSelectedSuggests] = useState<Set<number>>(new Set())
  const [sendingSuggests, setSendingSuggests]   = useState(false)
  const [filling, setFilling]                   = useState(false)

  const [selected, setSelected]       = useState<Set<number>>(new Set())
  const [edits, setEdits]             = useState<Record<number, string>>({})
  const [editingId, setEditingId]     = useState<number | null>(null)
  const [pushing, setPushing]         = useState(false)
  const [pushResults, setPushResults] = useState<{ id: number; ok: boolean; error?: string }[] | null>(null)
  const [toast, setToast]             = useState<string | null>(null)
  const [chatTask, setChatTask]       = useState<TaskChatContext | null>(null)
  const [opTask, setOpTask]           = useState<RecapTask | null>(null)
  const [allSprints, setAllSprints]   = useState<SprintMeta[]>([])
  const [selectedSprintId, setSelectedSprintId] = useState<number | null>(initialSprintId ?? null)

  // Sync when parent navigates to a different ISL sprint (initialSprintId changes)
  useEffect(() => {
    setSelectedSprintId(initialSprintId ?? null)
  }, [initialSprintId])

  useEffect(() => {
    load(selectedSprintId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSprintId])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  async function load(sprintId?: number | null) {
    setLoading(true); setError(null); setSelected(new Set()); setPushResults(null)
    try {
      const qs = sprintId ? `?sprintId=${sprintId}` : ''
      const [r, cacheR] = await Promise.all([
        fetch(`/api/op/sprint-plan${qs}`).then(r => r.json()),
        fetch('/api/op/cache').then(r => r.json()).catch(() => ({})),
      ])
      if (r.error) throw new Error(r.error)
      setData(r)
      setCustomTheme('')
      if (cacheR._opUrl) setOpUrl(cacheR._opUrl)
      if (cacheR.sprints?.length) {
        const sorted = [...cacheR.sprints].sort((a: SprintMeta, b: SprintMeta) =>
          b.startDate.localeCompare(a.startDate)
        )
        setAllSprints(sorted)
      }
    } catch (e) { setError(String(e)) }
    setLoading(false)
    if (!sprintId) loadAI()
  }

  async function loadAI() {
    setAiLoading(true)
    try {
      const r = await fetch('/api/op/sprint-plan/ai').then(r => r.json())
      setData(prev => prev ? {
        ...prev,
        aiName: r.aiName ?? prev.aiName,
        aiSummary: r.aiSummary ?? prev.aiSummary,
        aiSuggestedTasks: r.aiSuggestedTasks?.length ? r.aiSuggestedTasks : prev.aiSuggestedTasks,
      } : prev)
      if (r.aiName?.theme) setCustomTheme(r.aiName.theme)
    } catch {}
    setAiLoading(false)
  }

  async function reloadAI() {
    if (!data) return
    setReloading(true)
    try {
      const r = await fetch('/api/op/sprint-plan/ai').then(r => r.json())
      setData(prev => prev ? {
        ...prev,
        aiName: r.aiName ?? prev.aiName,
        aiSummary: r.aiSummary ?? prev.aiSummary,
        aiSuggestedTasks: r.aiSuggestedTasks?.length ? r.aiSuggestedTasks : prev.aiSuggestedTasks,
      } : prev)
      if (r.aiName?.theme) setCustomTheme(r.aiName.theme)
    } catch {}
    setReloading(false)
  }

  async function doPush() {
    if (!data?.nextSprint || selected.size === 0) return
    setPushing(true)
    try {
      const taskIds = Array.from(selected)
      const editMap: Record<number, { subject: string }> = {}
      for (const id of taskIds) {
        if (edits[id]) editMap[id] = { subject: edits[id] }
      }
      const r = await fetch('/api/op/sprint-move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskIds, targetSprintId: data.nextSprint.id, edits: editMap, defaultEstMins: 60 }),
      }).then(r => r.json())
      if (!Array.isArray(r.results)) { showToast(`❌ ${r.error ?? 'Gagal pindah'}`); setPushing(false); return }
      setPushResults(r.results)
      const ok   = r.results.filter((x: { ok: boolean }) => x.ok).length
      const fail = r.results.length - ok
      showToast(`✅ ${ok} task dipindah ke ${data.nextSprint.name}${fail > 0 ? ` · ❌ ${fail} gagal` : ''}`)
      if (ok > 0) {
        const movedIds = new Set(r.results.filter((x: { ok: boolean }) => x.ok).map((x: { id: number }) => x.id))
        setData(prev => prev ? { ...prev, carryOver: prev.carryOver.filter(t => !movedIds.has(t.id)) } : prev)
        setSelected(new Set())
      }
    } catch (e) { showToast(`❌ ${String(e)}`) }
    setPushing(false)
  }

  async function batchStatus(ids: number[], islStatus: string) {
    let ok = 0, offline = 0
    for (const id of ids) {
      const r = await fetch('/api/op/status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wpId: id, islStatus }),
      }).then(res => res.json()).catch(() => ({ ok: false }))
      if (r.ok && r.synced) ok++
      else if (r.ok) offline++
    }
    showToast(`✅ ${ok}/${ids.length} sync OP${offline ? ` · ${offline} lokal (OP offline)` : ''}`)
    await fetch('/api/op/cache', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {})
    window.dispatchEvent(new Event('isl:cache-refreshed'))
    load()
  }

  async function fillEmptyEstimates() {
    if (!data || filling) return
    const targets = [...data.carryOver, ...data.doneTasks].filter(t => t.type === 'Task' && t.estimatedHours == null)
    if (!targets.length) { showToast('Semua task sudah ada estimasi'); return }
    setFilling(true)
    let ok = 0
    for (const t of targets) {
      const r = await fetch('/api/op/wp-update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wpId: t.id, estimatedMins: 60 }),
      }).then(res => res.json()).catch(() => ({ error: true }))
      if (!r.error) ok++
    }
    showToast(`⚡ ${ok}/${targets.length} task diisi estimasi 1h`)
    await fetch('/api/op/cache', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {})
    window.dispatchEvent(new Event('isl:cache-refreshed'))
    await load()
    setFilling(false)
  }

  async function sendToPushQueue() {
    if (selected.size === 0 || !data) return
    setSendingToQueue(true)
    const existing = await fetch('/api/isl/sessions').then(r => r.json()).then(d => {
      const s = new Set<number>()
      for (const sess of (d.sessions ?? []) as { opTaskId?: number | null; pushStatus?: string }[]) {
        if (typeof sess.opTaskId === 'number' && (sess.pushStatus === 'pending' || sess.pushStatus === 'pushed')) s.add(sess.opTaskId)
      }
      return s
    }).catch(() => new Set<number>())

    const candidates = Array.from(selected).map(id => {
      const t = [...data.carryOver, ...data.doneTasks].find(x => x.id === id)
      return t ? { id, subject: edits[id] ?? t.subject, type: t.type, project: t.project, estimatedHours: t.estimatedHours } : null
    }).filter(Boolean) as { id: number; subject: string; type: string; project: string; estimatedHours: number | null }[]
    const tasks   = candidates.filter(t => !existing.has(t.id))
    const skipped = candidates.length - tasks.length

    let ok = 0; const failed: number[] = []
    for (const task of tasks) {
      try {
        const r = await fetch('/api/isl/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: task.subject,
            bullets: [`Carry-over dari ${data.currentSprint.name}`, `Tipe: ${task.type}`, `Project: ${task.project}`],
            estimatedMins: task.estimatedHours ? Math.round(task.estimatedHours * 60) : 60,
            opTaskId: task.id,
            pushStatus: 'pending',
            needsValidation: true,
            source: 'sprint-plan',
          }),
        })
        if (r.ok) ok++; else failed.push(task.id)
      } catch { failed.push(task.id) }
    }
    showToast(`${ok}/${tasks.length} ke Push Queue${skipped ? ` · ${skipped} sudah ada (dilewati)` : ''}${failed.length ? ` · ${failed.length} gagal` : ''}`)
    setSendingToQueue(false)
    setSelected(new Set())
    window.dispatchEvent(new Event('isl:session-updated'))
  }

  async function sendSuggestsToQueue() {
    if (selectedSuggests.size === 0 || !data) return
    setSendingSuggests(true)
    const items = data.aiSuggestedTasks.filter((_, i) => selectedSuggests.has(i))
    let ok = 0, fail = 0
    for (const item of items) {
      try {
        const r = await fetch('/api/isl/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: item.subject,
            bullets: [item.reason, `Tipe: ${item.type}`, `Area: ${item.projectHint}`],
            estimatedMins: Math.round(item.estimatedHours * 60),
            pushStatus: 'pending',
            needsValidation: true,
            source: 'ai-suggest',
          }),
        })
        if (r.ok) ok++; else fail++
      } catch { fail++ }
    }
    showToast(`${ok}/${items.length} AI suggest ke Push Queue${fail ? ` · ${fail} gagal` : ''}`)
    setSendingSuggests(false)
    setSelectedSuggests(new Set())
    window.dispatchEvent(new Event('isl:session-updated'))
  }

  if (loading) return <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Loading sprint plan…</div>
  if (error)   return <div className="flex items-center justify-center h-48 text-red-400 text-sm">{error}</div>
  if (!data)   return null

  const { currentSprint, nextSprint, carryOver, doneTasks, aiName, aiSummary, aiSuggestedTasks, suggestedNum } = data
  const isReadOnly = !!(data.isHistorical)

  const allTasks = [...carryOver, ...doneTasks]
  const projects = Array.from(new Set(allTasks.map(t => t.project).filter(Boolean))).sort()

  const byStatus = {
    inProgress: carryOver.filter(t => statusKey(t.status) === 'in progress').length,
    onHold:     carryOver.filter(t => statusKey(t.status) === 'on hold').length,
    new:        carryOver.filter(t => statusKey(t.status) === 'new' || !t.status).length,
    other:      carryOver.filter(t => !['in progress','on hold','new',''].includes(statusKey(t.status))).length,
    done:       doneTasks.length,
  }

  const tabTasks: Record<Tab, TaskItem[]> = {
    active: carryOver.filter(t => {
      const s = statusKey(t.status)
      return s === 'in progress' || s === 'on hold' || (s !== 'new' && s !== '')
    }),
    new:    carryOver.filter(t => statusKey(t.status) === 'new' || !t.status),
    done:   doneTasks,
  }

  const filtered = tabTasks[tab].filter(t => projectFilter === 'all' || t.project === projectFilter)

  const sprintName = `Sprint #${suggestedNum}${customTheme ? `: ${customTheme}` : ''}`
  const isSelectable = tab !== 'done' && !isReadOnly
  const allChecked   = filtered.length > 0 && filtered.every(t => selected.has(t.id))

  function toggleAll() {
    if (allChecked) {
      setSelected(prev => { const s = new Set(prev); filtered.forEach(t => s.delete(t.id)); return s })
    } else {
      setSelected(prev => { const s = new Set(prev); filtered.forEach(t => s.add(t.id)); return s })
    }
  }

  function toggleOne(id: number) {
    setPushResults(null)
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }

  const totalEst   = allTasks.filter(isInteractive).reduce((a, t) => a + (t.estimatedHours ?? 0), 0)
  const totalSpent = allTasks.filter(isInteractive).reduce((a, t) => a + (t.spentHours ?? 0), 0)
  const openEst    = carryOver.filter(isInteractive).reduce((a, t) => a + (t.estimatedHours ?? 0), 0)

  const capacityColor = openEst < 40
    ? { bar: 'bg-blue-400', text: 'text-blue-600 dark:text-blue-400', label: 'Under capacity', bg: 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800' }
    : openEst <= 50
    ? { bar: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', label: 'Good capacity', bg: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800' }
    : openEst <= 60
    ? { bar: 'bg-amber-400', text: 'text-amber-600 dark:text-amber-400', label: 'Near limit', bg: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800' }
    : { bar: 'bg-red-500', text: 'text-red-600 dark:text-red-400', label: 'Over capacity!', bg: 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800' }

  const sprintStart = new Date(currentSprint.startDate).getTime()
  const sprintEnd   = new Date(currentSprint.endDate).getTime()
  const now         = Date.now()
  const sprintElapsedPct = sprintEnd > sprintStart
    ? Math.min(100, Math.round((now - sprintStart) / (sprintEnd - sprintStart) * 100))
    : 0
  const interactiveTasks = allTasks.filter(isInteractive)
  const taskDonePct = interactiveTasks.length > 0 ? Math.round(doneTasks.filter(isInteractive).length / interactiveTasks.length * 100) : 0
  const velocityGap = sprintElapsedPct - taskDonePct

  function getMoveRule(t: TaskItem): 'must-finish' | 'can-move' | 'ok' {
    if (t.percentDone >= 70) return 'must-finish'
    if (t.percentDone < 50)  return 'can-move'
    return 'ok'
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">

      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-semibold px-4 py-2.5 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2"><CalendarDays size={16} /> Sprint Plan</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {currentSprint.name} — all tasks assigned to you across projects
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {allSprints.length > 1 && (
            <select
              value={selectedSprintId ?? ''}
              onChange={e => setSelectedSprintId(e.target.value ? parseInt(e.target.value) : null)}
              className="text-[10px] text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-400 max-w-[180px]">
              {allSprints.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.isCurrent ? ' ✓ aktif' : ''}
                </option>
              ))}
            </select>
          )}
          <button onClick={() => load(selectedSprintId)}
            className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-600 transition border border-gray-200 dark:border-gray-700 px-2.5 py-1.5 rounded-lg">
            <RefreshCw size={10} /> Refresh
          </button>
        </div>
      </div>

      {/* Historical read-only banner */}
      {isReadOnly && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-[11px]">
          <Clock size={12} className="flex-shrink-0" />
          <span><strong>Sprint lama — view only.</strong> Data dari OP. Semua aksi ISL dinonaktifkan. Klik <span className="font-mono text-[10px]">#ID</span> task untuk buka di OP.</span>
        </div>
      )}

      {/* Sprint summary bar */}
      <div className="border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-violet-600 dark:text-violet-400">● {currentSprint.name}</span>
          <span className="text-[10px] text-gray-400">ends {currentSprint.endDate}</span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {byStatus.inProgress > 0 && (
            <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950 text-blue-600 flex items-center gap-1">
              <span className="w-1 h-1 rounded-full bg-blue-500 inline-block" />{byStatus.inProgress} In Progress
            </span>
          )}
          {byStatus.onHold > 0 && (
            <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950 text-amber-600 flex items-center gap-1">
              <span className="w-1 h-1 rounded-full bg-amber-400 inline-block" />{byStatus.onHold} On Hold
            </span>
          )}
          {byStatus.new > 0 && (
            <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 flex items-center gap-1">
              <span className="w-1 h-1 rounded-full bg-gray-400 inline-block" />{byStatus.new} New
            </span>
          )}
          {byStatus.other > 0 && (
            <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-orange-50 dark:bg-orange-950 text-orange-500 flex items-center gap-1">
              <span className="w-1 h-1 rounded-full bg-orange-400 inline-block" />{byStatus.other} Other
            </span>
          )}
          <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950 text-emerald-600 flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-emerald-500 inline-block" />{byStatus.done} Done
          </span>
          <div className="flex-1 min-w-16 bg-gray-200 dark:bg-gray-700 rounded-full h-1 overflow-hidden ml-1">
            <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${taskDonePct}%` }} />
          </div>
          <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400">{taskDonePct}%</span>
        </div>

        <div className="flex gap-4 pt-1 border-t border-gray-100 dark:border-gray-800 flex-wrap">
          <div className="text-center">
            <p className="text-[9px] text-gray-400 uppercase tracking-wide">Total Est.</p>
            <p className="text-xs font-bold text-gray-700 dark:text-gray-200">{fmtH(totalEst)}</p>
          </div>
          <div className="text-center">
            <p className="text-[9px] text-gray-400 uppercase tracking-wide">Spent</p>
            <p className="text-xs font-bold text-blue-600 dark:text-blue-400">{fmtH(totalSpent)}</p>
          </div>
          <div className="text-center">
            <p className="text-[9px] text-gray-400 uppercase tracking-wide">Open Est.</p>
            <p className={`text-xs font-bold ${capacityColor.text}`}>{fmtH(openEst)}</p>
          </div>
          <div className="text-center">
            <p className="text-[9px] text-gray-400 uppercase tracking-wide">Tasks</p>
            <p className="text-xs font-bold text-gray-700 dark:text-gray-200">{allTasks.filter(isInteractive).length}</p>
          </div>
          <div className="flex-1 min-w-32">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[9px] text-gray-400 uppercase tracking-wide">Capacity (open est.)</p>
              <span className={`text-[9px] font-bold ${capacityColor.text}`}>{capacityColor.label}</span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
              <div className={`h-full rounded-full transition-all ${capacityColor.bar}`}
                style={{ width: `${Math.min(100, openEst / 60 * 100)}%` }} />
            </div>
            <p className="text-[8px] text-gray-400 mt-0.5">40h–60h ideal · {fmtH(openEst)} open</p>
          </div>
        </div>

        {sprintElapsedPct > 20 && velocityGap > 20 && (
          <div className="flex items-center gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
            <Zap size={12} className="text-amber-500 flex-shrink-0" />
            <p className="text-[10px] text-amber-600 dark:text-amber-400">
              Sprint {sprintElapsedPct}% lewat tapi baru {taskDonePct}% selesai — gap {velocityGap}%.
              {velocityGap > 40 ? ' Perlu akselerasi atau geser task ke sprint berikutnya.' : ' Monitor progress lebih ketat.'}
            </p>
          </div>
        )}
      </div>

      {/* Recap */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
          {isReadOnly ? `Recap — ${currentSprint.name}` : 'Recap menyeluruh — sprint aktif'}
        </p>
        <SprintRecap
          title={`${currentSprint.name}${isReadOnly ? ' · selesai' : ' · aktif'}`}
          subtitle={isReadOnly
            ? 'Data historis dari OP — view only'
            : 'Semua task sprint ini (new · in progress · hold · done) — klik untuk lihat/edit di OP'}
          tasks={[...carryOver, ...doneTasks] as RecapTask[]}
          opUrl={opUrl}
          onTaskClick={isReadOnly ? undefined : (tk) => setOpTask(tk)}
          onBatchStatus={isReadOnly ? undefined : batchStatus}
        />
        {!isReadOnly && [...carryOver, ...doneTasks].some(t => t.type === 'Task' && t.estimatedHours == null) && (
          <button onClick={fillEmptyEstimates} disabled={filling}
            className="w-full py-1.5 text-[10px] font-semibold text-violet-600 border border-dashed border-violet-200 dark:border-violet-800 rounded-lg hover:bg-violet-50 dark:hover:bg-violet-950/30 transition disabled:opacity-50">
            {filling ? <><Loader2 size={9} className="inline animate-spin mr-1" /> Mengisi…</> : <><Zap size={9} className="inline mr-1" />Isi estimasi kosong ({[...carryOver, ...doneTasks].filter(t => t.type === 'Task' && t.estimatedHours == null).length} Task × 1h) — Feature/Epic dilewati</>}
          </button>
        )}
      </div>

      {/* Next sprint name card — hidden for historical sprints */}
      {!isReadOnly && <div className="bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1 text-[10px] font-bold text-violet-700 dark:text-violet-300 uppercase tracking-wide"><Sparkles size={9} /> Next Sprint — Draft</p>
          <button onClick={reloadAI} disabled={reloading || aiLoading}
            className="text-[10px] text-violet-500 hover:text-violet-700 transition disabled:opacity-40">
            {reloading || aiLoading ? <><Loader2 size={9} className="inline animate-spin mr-1" /> generating…</> : <><RefreshCw size={9} className="inline mr-1" /> Suggest lagi</>}
          </button>
        </div>

        <div className="space-y-1.5">
          <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{sprintName}</p>
          {aiName?.goal && (
            <p className="flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 italic"><Target size={9} /> {aiName.goal}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] text-gray-500 font-semibold">Edit theme:</label>
          <input
            value={customTheme}
            onChange={e => setCustomTheme(e.target.value)}
            placeholder="e.g. Stability & Polish"
            className="w-full text-sm border border-violet-200 dark:border-violet-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-violet-400"
          />
        </div>

        {aiName?.suggestions && aiName.suggestions.length > 0 && (
          <div className="space-y-1">
            <p className="text-[9px] font-semibold text-violet-500 uppercase tracking-wide">Alternatif:</p>
            <div className="flex gap-1.5 flex-wrap">
              {aiName.suggestions.map((s, i) => (
                <button key={i} onClick={() => setCustomTheme(s)}
                  className={`text-[10px] px-2.5 py-1 rounded-full border transition font-medium ${
                    customTheme === s
                      ? 'bg-violet-600 text-white border-violet-600'
                      : 'border-violet-200 dark:border-violet-700 text-violet-600 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-900'
                  }`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {nextSprint ? (
          <p className="text-[10px] text-violet-500 border-t border-violet-200 dark:border-violet-800 pt-2">
            ✅ Sprint berikutnya: <strong>{nextSprint.name}</strong> (starts {nextSprint.startDate})
          </p>
        ) : (
          <p className="text-[10px] text-amber-600 dark:text-amber-400 border-t border-violet-200 dark:border-violet-800 pt-2">
            {t('sprintplan.no_next')}
          </p>
        )}
      </div>}

      {aiLoading && !aiSummary && aiSuggestedTasks.length === 0 && (
        <div className="border border-indigo-100 dark:border-indigo-900 rounded-xl px-4 py-3 flex items-center gap-2 text-[11px] text-indigo-400">
          <Loader2 size={12} className="animate-spin" /> AI sedang analisa sprint…
        </div>
      )}

      {(aiSummary || aiSuggestedTasks.length > 0) && (
        <div className="border border-indigo-200 dark:border-indigo-800 rounded-xl overflow-hidden">
          <div className="bg-indigo-50 dark:bg-indigo-950/40 px-4 py-3 flex items-center justify-between">
            <div>
              <p className="flex items-center gap-1 text-[10px] font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-wide">
                <Bot size={10} /> AI Plan — Sprint #{suggestedNum}
              </p>
              <p className="text-[9px] text-indigo-400 mt-0.5">Berdasarkan data sprint {currentSprint.name}</p>
            </div>
            <button onClick={reloadAI} disabled={reloading || aiLoading}
              className="text-[10px] text-indigo-400 hover:text-indigo-600 transition disabled:opacity-40">
              {reloading || aiLoading ? <Loader2 size={10} className="animate-spin" /> : <><RefreshCw size={10} className="inline" /> Refresh</>}
            </button>
          </div>

          {aiSummary && (
            <div className="px-4 py-3 border-b border-indigo-100 dark:border-indigo-900">
              <p className="flex items-center gap-1 text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1.5"><BarChart2 size={10} /> Retrospektif</p>
              <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">{aiSummary}</p>
            </div>
          )}

          {aiSuggestedTasks.length > 0 && (
            <div className="px-4 py-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-1 text-[10px] font-bold text-gray-500 uppercase tracking-wide">
                  <Lightbulb size={10} /> Task Disarankan untuk Sprint #{suggestedNum}
                </p>
                <label className="flex items-center gap-1.5 text-[10px] text-gray-400 cursor-pointer">
                  <input type="checkbox"
                    checked={selectedSuggests.size === aiSuggestedTasks.length}
                    onChange={() => {
                      if (selectedSuggests.size === aiSuggestedTasks.length) {
                        setSelectedSuggests(new Set())
                      } else {
                        setSelectedSuggests(new Set(aiSuggestedTasks.map((_, i) => i)))
                      }
                    }}
                    className="w-3 h-3 rounded accent-indigo-600" />
                  {t('sprintplan.select_all')}
                </label>
              </div>

              <div className="space-y-2">
                {aiSuggestedTasks.map((item, i) => {
                  const isChecked = selectedSuggests.has(i)
                  const priorityBadge = {
                    high:   'bg-red-50 dark:bg-red-950 text-red-600 border-red-200 dark:border-red-800',
                    medium: 'bg-amber-50 dark:bg-amber-950 text-amber-600 border-amber-200 dark:border-amber-800',
                    low:    'bg-gray-50 dark:bg-gray-800 text-gray-500 border-gray-200 dark:border-gray-700',
                  }[item.priority] ?? 'bg-gray-50 text-gray-500'

                  return (
                    <div key={i}
                      onClick={() => setSelectedSuggests(prev => {
                        const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s
                      })}
                      className={`border rounded-lg px-3 py-2.5 cursor-pointer transition ${
                        isChecked
                          ? 'bg-indigo-50/80 dark:bg-indigo-950/30 border-indigo-300 dark:border-indigo-700'
                          : 'border-gray-100 dark:border-gray-800 hover:border-indigo-200 dark:hover:border-indigo-800'
                      }`}>
                      <div className="flex items-start gap-2.5">
                        <input type="checkbox" checked={isChecked} onChange={() => {}}
                          className="mt-0.5 w-3.5 h-3.5 rounded accent-indigo-600 flex-shrink-0 pointer-events-none" />
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-start gap-2 flex-wrap">
                            <p className="text-[12px] font-semibold text-gray-800 dark:text-gray-100 leading-snug flex-1">{item.subject}</p>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border flex-shrink-0 ${priorityBadge}`}>
                              {item.priority.toUpperCase()}
                            </span>
                          </div>
                          <p className="flex items-center gap-1 text-[10px] text-indigo-600 dark:text-indigo-400 italic leading-relaxed">
                            <MessageCircle size={9} className="flex-shrink-0" /> {item.reason}
                          </p>
                          <div className="flex items-center gap-3">
                            <span className="text-[9px] text-gray-400">{item.type}</span>
                            <span className="flex items-center gap-0.5 text-[9px] text-gray-400"><Folder size={9} /> {item.projectHint}</span>
                            <span className="flex items-center gap-0.5 text-[9px] font-mono text-blue-500"><Clock size={9} /> {item.estimatedHours}h</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {selectedSuggests.size > 0 && (
                <div className="flex items-center gap-2 pt-2 border-t border-indigo-100 dark:border-indigo-900">
                  <span className="text-[10px] text-indigo-500 flex-1">
                    {selectedSuggests.size} task akan dikirim ke Push Queue sebagai draft pending
                  </span>
                  <button onClick={sendSuggestsToQueue} disabled={sendingSuggests}
                    className="px-3 py-1.5 text-[11px] font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition disabled:opacity-40">
                    {sendingSuggests ? <><Loader2 size={9} className="animate-spin inline mr-1" /> Mengirim…</> : <><Send size={9} className="inline mr-1" /> Kirim ke Push Queue</>}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Task section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-gray-800 dark:text-gray-100"><ClipboardList size={14} /> Tasks {currentSprint.name}</h3>
          {projects.length > 1 && (
            <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)}
              className="text-[10px] text-gray-500 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 focus:outline-none">
              <option value="all">All projects ({allTasks.length})</option>
              {projects.map(p => (
                <option key={p} value={p}>{p} ({allTasks.filter(t => t.project === p).length})</option>
              ))}
            </select>
          )}
        </div>

        <div className="flex gap-0 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden text-[10px] font-semibold w-fit">
          {([
            ['active', `Active  ${byStatus.inProgress + byStatus.onHold + byStatus.other}`],
            ['new',    `New  ${byStatus.new}`],
            ['done',   `Done  ${byStatus.done}`],
          ] as const).map(([t, label]) => (
            <button key={t} onClick={() => { setTab(t); setSelected(new Set()) }}
              className={`px-3 py-1.5 transition ${
                tab === t
                  ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
                  : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {isSelectable && filtered.length > 0 && (
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[10px] text-gray-500 cursor-pointer select-none">
              <input type="checkbox" checked={allChecked} onChange={toggleAll}
                className="w-3 h-3 rounded accent-violet-600" />
              {t('sprintplan.select_all')} ({filtered.length})
            </label>
            {selected.size > 0 && (
              <span className="text-[10px] font-semibold text-violet-600 dark:text-violet-400">
                {selected.size} dipilih
              </span>
            )}
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="text-center text-gray-400 text-sm py-10">
            <p>{t('sprintplan.no_tasks')}</p>
            {tab === 'done' && <p className="text-xs mt-1 text-gray-300 dark:text-gray-600">{t('sprintplan.none_done')}</p>}
          </div>
        ) : (
          <div className="border border-gray-100 dark:border-gray-800 rounded-xl overflow-hidden">
            <div className="hidden sm:grid grid-cols-[auto_1fr_80px_60px_60px_60px] gap-3 px-4 py-1.5 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">
              {isSelectable && <div />}
              <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wide col-span-1">Subject</div>
              <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wide text-right">Work</div>
              <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wide text-right">Spent</div>
              <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wide text-right">%</div>
              <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wide text-right">Status</div>
            </div>

            {filtered.map(task => {
              const interactive  = isInteractive(task)
              const isChecked    = selected.has(task.id)
              const isEditing    = editingId === task.id
              const editedSubject = edits[task.id] ?? task.subject
              const sk           = statusKey(task.status)
              const statusCls    = STATUS_COLOR[sk] ?? 'text-gray-400'
              const moveRule     = isSelectable && interactive ? getMoveRule(task) : null

              return (
                <div key={task.id}
                  className={`border-b border-gray-50 dark:border-gray-800 last:border-0 transition-colors ${
                    !interactive
                      ? 'opacity-40 cursor-default'
                      : isChecked ? 'bg-violet-50/60 dark:bg-violet-950/20' : 'hover:bg-gray-50/40 dark:hover:bg-gray-800/20'
                  }`}>
                  <div className="flex items-start gap-2.5 px-4 py-2.5">
                    {isSelectable && interactive && (
                      <input type="checkbox" checked={isChecked} onChange={() => toggleOne(task.id)}
                        className="mt-0.5 w-3.5 h-3.5 rounded accent-violet-600 flex-shrink-0 cursor-pointer" />
                    )}
                    {isSelectable && !interactive && (
                      <span className="mt-0.5 w-3.5 h-3.5 flex-shrink-0" />
                    )}

                    <TypeBadge type={task.type} />

                    <a href={`${opUrl}/work_packages/${task.id}`} target="_blank" rel="noopener"
                      className="font-mono text-[11px] font-bold text-indigo-400 hover:text-indigo-600 flex-shrink-0 w-12 mt-0.5">
                      #{task.id}
                    </a>

                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <input autoFocus
                          value={editedSubject}
                          onChange={e => setEdits(prev => ({ ...prev, [task.id]: e.target.value }))}
                          onBlur={() => setEditingId(null)}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditingId(null) }}
                          className="w-full text-[12px] border border-violet-300 dark:border-violet-700 rounded px-2 py-0.5 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-violet-400"
                        />
                      ) : (
                        <div className="flex items-center gap-1 group/subject">
                          <p className={`text-[12px] text-gray-700 dark:text-gray-200 leading-snug ${isSelectable && interactive ? 'cursor-pointer' : ''} ${edits[task.id] ? 'text-violet-700 dark:text-violet-300' : ''}`}
                            onClick={() => isSelectable && interactive && toggleOne(task.id)}>
                            {editedSubject}
                            {edits[task.id] && <span className="ml-1 text-[9px] text-violet-400">edited</span>}
                          </p>
                          {isSelectable && interactive && (
                            <button onClick={() => setEditingId(task.id)}
                              className="opacity-0 group-hover/subject:opacity-100 transition text-[9px] text-gray-300 hover:text-gray-500 flex-shrink-0"><Pencil size={9} /></button>
                          )}
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-[9px] text-gray-400">{task.project}</span>
                        <span className={`text-[9px] font-semibold ${statusCls}`}>{task.status}</span>
                        {moveRule === 'must-finish' && (
                          <span className="flex items-center gap-0.5 text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 dark:bg-red-950 text-red-600 border border-red-200 dark:border-red-800">
                            <Lock size={7} /> Wajib selesai
                          </span>
                        )}
                        {moveRule === 'can-move' && (
                          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950 text-blue-500 border border-blue-200 dark:border-blue-800">
                            ➡ Bisa geser
                          </span>
                        )}
                        {task.percentDone > 0 && (
                          <div className="flex items-center gap-1">
                            <div className="w-12 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                              <div className="h-full bg-blue-500 rounded-full" style={{ width: `${task.percentDone}%` }} />
                            </div>
                            <span className="text-[9px] text-gray-400">{task.percentDone}%</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {!isReadOnly && (
                      <button
                        onClick={() => setChatTask({
                          id: `sprint-task-${task.id}`,
                          title: task.subject,
                          taskType: 'incoming',
                          opTaskId: task.id,
                          sprintName: currentSprint.name,
                          status: task.status,
                        })}
                        className="flex-shrink-0 mt-0.5 text-[10px] font-semibold px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-400 hover:text-blue-600 hover:border-blue-300 dark:hover:text-blue-400 dark:hover:border-blue-700 transition">
                        <MessageCircle size={10} />
                      </button>
                    )}

                    <div className="hidden sm:flex items-start gap-3 flex-shrink-0 text-right">
                      <div className="w-16">
                        <p className="text-[10px] font-mono text-gray-600 dark:text-gray-300">{fmtH(task.estimatedHours)}</p>
                        <p className="text-[8px] text-gray-400">est</p>
                      </div>
                      <div className="w-12">
                        <p className={`text-[10px] font-mono ${task.spentHours && task.estimatedHours && task.spentHours > task.estimatedHours ? 'text-red-500' : 'text-blue-500 dark:text-blue-400'}`}>
                          {fmtH(task.spentHours)}
                        </p>
                        <p className="text-[8px] text-gray-400">spent</p>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {isSelectable && selected.size > 0 && (
          <div className="bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-violet-700 dark:text-violet-300">{selected.size} task dipilih</p>
              <button onClick={() => setSelected(new Set())} className="text-[10px] text-gray-400 hover:text-gray-600">Clear</button>
            </div>

            <div className="space-y-1 max-h-36 overflow-y-auto">
              {Array.from(selected).map(id => {
                const task = allTasks.find(t => t.id === id)
                if (!task) return null
                return (
                  <div key={id} className="flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-400">
                    <a href={`${opUrl}/work_packages/${id}`} target="_blank" rel="noopener"
                      className="font-mono font-bold text-indigo-500 hover:underline flex-shrink-0">#{id}</a>
                    <span className="truncate flex-1">{edits[id] ?? task.subject}</span>
                    <span className="text-[9px] text-gray-400 flex-shrink-0">{fmtH(task.estimatedHours)}</span>
                    <button onClick={() => toggleOne(id)} className="text-[9px] text-gray-300 hover:text-red-400 flex-shrink-0">✕</button>
                  </div>
                )
              })}
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-violet-200 dark:border-violet-800 flex-wrap">
              <button onClick={sendToPushQueue} disabled={sendingToQueue}
                className="px-3 py-1.5 text-[11px] font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition disabled:opacity-40">
                {sendingToQueue ? <Loader2 size={10} className="animate-spin" /> : <><Send size={10} /> Kirim ke Push Queue ({selected.size})</>}
              </button>

              {nextSprint ? (
                <button onClick={doPush} disabled={pushing}
                  className="px-3 py-1.5 text-[11px] font-bold bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition disabled:opacity-40">
                  {pushing ? <Loader2 size={10} className="animate-spin" /> : <><CalendarDays size={10} /> Pindah ke {nextSprint.name} →</>}
                </button>
              ) : (
                <span className="text-[10px] text-amber-600 dark:text-amber-400">{t('sprintplan.no_next_badge')}</span>
              )}
            </div>

            {pushResults && (
              <div className="space-y-1 pt-1 border-t border-violet-200 dark:border-violet-800">
                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Hasil push:</p>
                {pushResults.map(r => (
                  <div key={r.id} className={`text-[10px] flex items-center gap-1.5 ${r.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                    {r.ok ? <CheckCircle2 size={10} /> : <X size={10} />}
                    <span className="font-mono font-bold">#{r.id}</span>
                    {r.error && <span className="opacity-70">{r.error}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {carryOver.length > 0 && (
          <button
            onClick={() => {
              const lines = [
                `${sprintName} — Carry-over Plan`,
                `From: ${currentSprint.name}`,
                `Open: ${carryOver.length} · Done: ${doneTasks.length}`,
                `Est remaining: ${fmtH(openEst)} · Spent this sprint: ${fmtH(totalSpent)}`,
                '',
                'Active:',
                ...tabTasks.active.map(t => `- #${t.id} ${t.subject} [${t.status}] (${fmtH(t.estimatedHours)})`),
                '',
                'New:',
                ...tabTasks.new.map(t => `- #${t.id} ${t.subject} (${fmtH(t.estimatedHours)})`),
              ]
              navigator.clipboard.writeText(lines.join('\n'))
              showToast('Copied!')
            }}
            className="w-full py-2 text-[10px] font-semibold text-gray-400 border border-dashed border-gray-200 dark:border-gray-700 rounded-lg hover:border-gray-400 hover:text-gray-600 transition">
            <ClipboardList size={10} /> Copy carry-over list ke clipboard
          </button>
        )}
      </div>

      {opTask && (
        <OpTaskModal
          wpId={opTask.id}
          opUrl={opUrl}
          onClose={() => setOpTask(null)}
          onSaved={() => load()}
          onChat={() => {
            setChatTask({ id: `sprinttask-${opTask.id}`, title: opTask.subject, taskType: 'session', opTaskId: opTask.id, status: opTask.status, sprintName: currentSprint.name })
            setOpTask(null)
          }}
        />
      )}

      {chatTask && (
        <TaskChatModal task={chatTask} onClose={() => setChatTask(null)} />
      )}
    </div>
  )
}
