'use client'

import { useState, useEffect } from 'react'
import type { CachedWorkPackage } from '@/lib/op-cache'
import { useI18n } from '@/lib/i18n'
import TaskChatModal, { type TaskChatContext } from './TaskChatModal'
import OpTaskModal from './OpTaskModal'
import { Inbox, CalendarDays, CheckCircle2, Send, MessageCircle, Pencil, Info, RefreshCw, Play, PauseCircle, Layers, X, Plus, Trash2 } from 'lucide-react'

const ISL_STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  new:         { label: 'New',         color: 'text-gray-500',   dot: 'bg-gray-400' },
  in_progress: { label: 'In Progress', color: 'text-blue-500',   dot: 'bg-blue-500' },
  on_hold:     { label: 'On Hold',     color: 'text-amber-500',  dot: 'bg-amber-500' },
  done:        { label: 'Done',        color: 'text-emerald-600',dot: 'bg-emerald-500' },
  rejected:    { label: 'Rejected',    color: 'text-red-500',    dot: 'bg-red-400' },
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function IncomingTasksPanel() {
  const { t } = useI18n()
  const [tasks, setTasks]       = useState<CachedWorkPackage[]>([])
  const [loading, setLoading]   = useState(true)
  const [opUrl, setOpUrl]       = useState<string>('https://tokek.integrity-asia.com')
  const [updatingId, setUpdatingId] = useState<number | null>(null)
  const [toast, setToast]       = useState<string | null>(null)
  const [filter, setFilter]     = useState<'open' | 'all'>('open')
  const [chatTask, setChatTask] = useState<TaskChatContext | null>(null)
  const [opTask, setOpTask] = useState<{ id: number; subject: string } | null>(null)
  const [queuedIds, setQueuedIds] = useState<Set<number>>(new Set())
  const [pushedIds, setPushedIds] = useState<Set<number>>(new Set())
  const [nextSprint, setNextSprint] = useState<{ id: number; name: string } | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [restructureModal, setRestructureModal] = useState(false)
  const [restructureSubject, setRestructureSubject] = useState('')
  const [newTaskInputs, setNewTaskInputs] = useState<string[]>([''])
  const [restructuring, setRestructuring] = useState(false)

  useEffect(() => {
    fetch('/api/op/cache')
      .then(r => r.json())
      .then(d => {
        setTasks(d.incomingTasks ?? [])
        if (d._opUrl) setOpUrl(d._opUrl)
        // Tentukan next sprint: sprint pertama yang mulai setelah current berakhir
        const sprints = (d.sprints ?? []) as { id: number; name: string; startDate: string; endDate: string; isCurrent: boolean }[]
        const cur = sprints.find(s => s.isCurrent)
        if (cur) {
          const future = sprints
            .filter(s => (s.startDate ?? '') > (cur.endDate ?? ''))
            .sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''))
          if (future[0]) setNextSprint({ id: future[0].id, name: future[0].name })
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  async function moveToNextSprint(task: CachedWorkPackage) {
    if (!nextSprint) return showToast('Next sprint tidak ketemu')
    setUpdatingId(task.id)
    const r = await fetch('/api/op/sprint-move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskIds: [task.id], targetSprintId: nextSprint.id, defaultEstMins: 60 }),
    }).then(r => r.json()).catch(() => ({ results: [{ ok: false }] }))
    const ok = r.results?.[0]?.ok
    if (ok) {
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, sprintId: nextSprint.id, sprintName: nextSprint.name } : t))
      showToast(`#${task.id} → ${nextSprint.name}, sync OP…`)
      // Rebuild cache dari OP biar Next Sprint page lihat perubahan version
      await fetch('/api/op/cache', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {})
      showToast(`#${task.id} dipindah ke ${nextSprint.name} (OP)`)
      window.dispatchEvent(new Event('isl:cache-refreshed'))
    } else {
      showToast(`Gagal pindah: ${r.results?.[0]?.error ?? 'unknown'}`)
    }
    setUpdatingId(null)
  }

  // Tasks yang sudah punya session di Push Queue (pending) ATAU sudah dipush ke OP
  // (pushed) → tandai + matikan aksi di Incoming biar ga diproses dobel.
  useEffect(() => {
    function loadQueued() {
      fetch('/api/isl/sessions')
        .then(r => r.json())
        .then(d => {
          const pending = new Set<number>(), pushed = new Set<number>()
          for (const s of (d.sessions ?? []) as { opTaskId?: number | null; pushStatus?: string }[]) {
            if (typeof s.opTaskId !== 'number') continue
            if (s.pushStatus === 'pushed') pushed.add(s.opTaskId)
            else if (s.pushStatus === 'pending') pending.add(s.opTaskId)
          }
          setQueuedIds(pending)
          setPushedIds(pushed)
        })
        .catch(() => {})
    }
    loadQueued()
    window.addEventListener('isl:session-updated', loadQueued)
    window.addEventListener('isl:cache-refreshed', loadQueued)
    return () => {
      window.removeEventListener('isl:session-updated', loadQueued)
      window.removeEventListener('isl:cache-refreshed', loadQueued)
    }
  }, [])

  async function updateStatus(task: CachedWorkPackage, islStatus: string) {
    setUpdatingId(task.id)
    const r = await fetch('/api/op/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wpId: task.id, islStatus }),
    }).then(r => r.json()).catch(() => ({ ok: false }))

    if (r.ok) {
      setTasks(prev => prev.map(t =>
        t.id === task.id ? { ...t, islStatus, status: ISL_STATUS_CONFIG[islStatus]?.label ?? t.status } : t
      ))
      showToast(r.synced ? `Status → OP #${task.id}` : `Status disimpan (OP offline)`)
      // Notify SprintBanner + other components to refresh
      window.dispatchEvent(new Event('isl:cache-refreshed'))
    } else {
      showToast(`${t('incoming.failed_update')}: ${r.error ?? 'unknown'}`)
    }
    setUpdatingId(null)
  }

  async function triggerSync() {
    setLoading(true)
    try {
      await fetch('/api/op/cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),  // server reads userId/projects from op-mode.json
      })
      const r = await fetch('/api/op/cache')
      if (!r.ok) throw new Error(`Cache fetch failed: ${r.status}`)
      const d = await r.json()
      setTasks(d.incomingTasks ?? [])
      window.dispatchEvent(new Event('isl:cache-refreshed'))
    } catch (e) {
      console.error('[IncomingTasksPanel] sync error:', e)
    }
    setLoading(false)
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  function toggleSelect(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const selectedTasks = tasks.filter(t => selectedIds.has(t.id))
  const selectedProjectIds = new Set(selectedTasks.map(t => t.projectId))
  const selectionMixedProject = selectedProjectIds.size > 1

  async function submitRestructure() {
    if (!restructureSubject.trim() || restructuring) return
    setRestructuring(true)
    const projectId = selectedTasks[0]?.projectId
    const r = await fetch('/api/op/restructure-to-story', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: restructureSubject.trim(),
        projectId,
        existingWpIds: Array.from(selectedIds),
        newTaskSubjects: newTaskInputs.map(s => s.trim()).filter(Boolean),
      }),
    }).then(r => r.json()).catch((e) => ({ ok: false, error: String(e) }))
    setRestructuring(false)
    if (r.ok) {
      const failed = (r.reparented ?? []).filter((x: { ok: boolean }) => !x.ok)
      showToast(
        failed.length > 0
          ? `US #${r.usId} dibuat, tapi ${failed.length} tiket gagal di-reparent`
          : `✓ User Story #${r.usId} dibuat, ${r.reparented?.length ?? 0} tiket + ${r.newTasks?.length ?? 0} task baru`
      )
      setRestructureModal(false)
      setSelectedIds(new Set())
      setRestructureSubject('')
      setNewTaskInputs([''])
      await triggerSync()
    } else {
      showToast(`Gagal restrukturisasi: ${r.error ?? 'unknown'}`)
    }
  }

  const shown = filter === 'open'
    ? tasks.filter(t => t.islStatus !== 'done' && t.islStatus !== 'rejected')
    : tasks

  if (loading) return (
    <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Memuat tiket masuk…</div>
  )

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2"><Inbox size={16} /> Incoming Tickets</h2>
          <p className="text-xs text-gray-400 mt-0.5">Tasks assigned to you by others in OP — auto-synced</p>
        </div>
        {tasks.length > 0 && (
          <div className="text-right text-xs text-gray-400">
            <div className="font-semibold text-gray-700 dark:text-gray-200">{tasks.length} total tickets</div>
            <div>{tasks.filter(t => t.islStatus !== 'done' && t.islStatus !== 'rejected').length} open</div>
          </div>
        )}
      </div>

      {/* Sync notice */}
      <div className="text-[11px] text-gray-400 bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700 rounded-lg px-3 py-2 flex items-start gap-1.5">
        <Info size={11} className="flex-shrink-0 mt-0.5" /> <span>Incoming Tickets = tasks <strong>assigned to you</strong> in OP but <strong>created by someone else</strong>. Status changes here sync directly to OP.</span>
      </div>

      {/* Filter */}
      {tasks.length > 0 && (
        <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
          {(['open', 'all'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-2 text-xs font-semibold border-b-2 transition -mb-px ${
                filter === f
                  ? 'border-violet-500 text-violet-600 dark:text-violet-400'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}>
              {f === 'open'
                ? `Open (${tasks.filter(t => t.islStatus !== 'done' && t.islStatus !== 'rejected').length})`
                : `Semua (${tasks.length})`}
            </button>
          ))}
        </div>
      )}

      {/* Empty state */}
      {tasks.length === 0 ? (
        <div className="text-center text-gray-400 text-sm py-12">
          <div className="flex justify-center mb-3"><Inbox size={40} className="text-gray-300 dark:text-gray-600" /></div>
          <p>{t('incoming.empty')}</p>
          <p className="text-xs mt-1 text-gray-300 dark:text-gray-600">
            {t('incoming.empty_hint')}
          </p>
          <button
            onClick={triggerSync}
            className="mt-4 px-4 py-2 text-xs font-semibold text-indigo-600 border border-indigo-200 dark:border-indigo-700 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950 transition"
          >
            {t('incoming.sync_now')}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map(task => {
            const statusCfg = ISL_STATUS_CONFIG[task.islStatus] ?? ISL_STATUS_CONFIG.new
            const isPushed    = pushedIds.has(task.id)
            const isQueued    = queuedIds.has(task.id) && !isPushed
            const isProcessed = isPushed || isQueued
            return (
              <div key={task.id} className={`rounded-xl border p-4 transition ${
                isProcessed
                  ? 'bg-gray-100 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700 opacity-70'
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
              }`}>
                <div className="flex items-start gap-3">
                  {!isProcessed && (
                    <input
                      type="checkbox"
                      checked={selectedIds.has(task.id)}
                      onChange={() => toggleSelect(task.id)}
                      className="mt-1 flex-shrink-0 w-3.5 h-3.5 accent-violet-500 cursor-pointer"
                      title="Pilih untuk restrukturisasi ke User Story"
                    />
                  )}
                  <div className="flex-1 min-w-0">

                    {/* Row 1: project badge + type + status */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-full">
                        {task.project}
                      </span>
                      <span className="text-[10px] text-gray-400">{task.type}</span>
                      <span className="flex items-center gap-1 text-[10px] font-semibold">
                        <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dot}`} />
                        <span className={statusCfg.color}>{task.status || statusCfg.label}</span>
                      </span>
                      {task.sprintName && (
                        <span className="flex items-center gap-0.5 text-[10px] text-indigo-400 bg-indigo-50 dark:bg-indigo-950 px-1.5 py-0.5 rounded">
                          <CalendarDays size={9} />{task.sprintName}
                        </span>
                      )}
                      {isPushed && (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950 px-2 py-0.5 rounded-full">
                          <CheckCircle2 size={9} /> Sudah di OP
                        </span>
                      )}
                      {isQueued && (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950 px-2 py-0.5 rounded-full">
                          <Send size={9} /> Di Push Queue
                        </span>
                      )}
                    </div>

                    {/* Row 2: ID + title */}
                    <div className="flex items-baseline gap-2 mt-1.5 flex-wrap">
                      <a href={`${opUrl}/work_packages/${task.id}`} target="_blank" rel="noopener"
                        className="flex-shrink-0 text-sm font-bold text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 font-mono">
                        #{task.id}
                      </a>
                      <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 leading-snug">{task.subject}</p>
                    </div>

                    {/* Row 3: who sent + when */}
                    <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-400 flex-wrap">
                      <span className="flex items-center gap-1"><Pencil size={9} /> Dibuat: <strong className="text-gray-600 dark:text-gray-300">{task.createdBy ?? '—'}</strong></span>
                      <span className="flex items-center gap-1"><CalendarDays size={9} />{formatDate(task.createdAt)}</span>
                      {task.updatedAt && task.updatedAt !== task.createdAt && (
                        <span className="flex items-center gap-1"><RefreshCw size={9} /> Update: {formatDate(task.updatedAt)}</span>
                      )}
                    </div>
                  </div>

                  {/* Status quick-set */}
                  <div className="flex-shrink-0 flex flex-col gap-1.5 min-w-[88px]">
                    {isPushed ? (
                      <div className="flex flex-col gap-1 items-center text-center px-2 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50">
                        <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-300"><CheckCircle2 size={9} /> Sudah di OP</span>
                        <span className="text-[9px] text-emerald-600/70 dark:text-emerald-400/60 leading-tight">Sudah dipush, tidak perlu aksi lagi</span>
                      </div>
                    ) : isQueued ? (
                      <div className="flex flex-col gap-1 items-center text-center px-2 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50">
                        <span className="flex items-center gap-1 text-[10px] font-bold text-amber-700 dark:text-amber-300"><Send size={9} /> Sudah di Queue</span>
                        <span className="text-[9px] text-amber-600/70 dark:text-amber-400/60 leading-tight">Selesaikan di Push Queue</span>
                      </div>
                    ) : (
                    <>
                    <button
                      onClick={() => setOpTask({ id: task.id, subject: task.subject })}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition">
                      <Info size={10} /> Detail
                    </button>
                    <button
                      onClick={() => setChatTask({
                        id: `incoming-${task.id}`,
                        title: task.subject,
                        taskType: 'incoming',
                        opTaskId: task.id,
                        sprintName: task.sprintName ?? null,
                        status: task.status,
                      })}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-indigo-600 border border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950 transition">
                      <MessageCircle size={10} /> Diskusi
                    </button>
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent('isl:start-session', { detail: { title: task.subject, opTaskId: task.id } }))}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-emerald-700 border border-emerald-200 dark:border-emerald-800 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-950 transition">
                      <Play size={10} /> Mulai Kerja
                    </button>
                    {nextSprint && (
                      task.sprintId === nextSprint.id ? (
                        <span className="px-2 py-1 text-[10px] font-semibold text-purple-600 bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-lg text-center">
                          ✓ {nextSprint.name}
                        </span>
                      ) : (
                        <button
                          onClick={() => moveToNextSprint(task)}
                          disabled={updatingId === task.id}
                          title={`Pindah version OP ke ${nextSprint.name}`}
                          className="px-2 py-1 text-[10px] font-semibold text-purple-600 border border-purple-200 dark:border-purple-800 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-950 disabled:opacity-50 transition">
                          → {nextSprint.name}
                        </button>
                      )
                    )}
                    {(task.islStatus === 'new' || !task.islStatus) && (
                      <button
                        onClick={() => updateStatus(task, 'in_progress')}
                        disabled={updatingId === task.id}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-blue-600 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950 disabled:opacity-50 transition">
                        <Play size={10} /> Mulai
                      </button>
                    )}
                    {task.islStatus === 'in_progress' && (
                      <button
                        onClick={() => updateStatus(task, 'on_hold')}
                        disabled={updatingId === task.id}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-amber-600 border border-amber-200 dark:border-amber-800 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-950 disabled:opacity-50 transition">
                        <PauseCircle size={10} /> Hold
                      </button>
                    )}
                    {task.islStatus === 'on_hold' && (
                      <button
                        onClick={() => updateStatus(task, 'in_progress')}
                        disabled={updatingId === task.id}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-blue-600 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950 disabled:opacity-50 transition">
                        <Play size={10} /> Lanjut
                      </button>
                    )}
                    </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Restructure CTA bar — appears once 1+ ticket selected */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 dark:bg-gray-800 text-white rounded-xl shadow-xl z-40 px-4 py-3 flex items-center gap-3">
          <span className="text-xs font-semibold">{selectedIds.size} tiket dipilih</span>
          {selectionMixedProject && (
            <span className="text-[10px] text-amber-300">⚠ beda project, tidak bisa digabung</span>
          )}
          <button
            onClick={() => setRestructureModal(true)}
            disabled={selectionMixedProject}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition">
            <Layers size={12} /> Restrukturisasi ke User Story
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="text-gray-400 hover:text-white transition" title="Batal pilih">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Restructure modal */}
      {restructureModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <Layers size={15} /> User Story Baru
              </h3>
              <button onClick={() => setRestructureModal(false)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">Judul User Story</label>
              <input
                autoFocus
                value={restructureSubject}
                onChange={e => setRestructureSubject(e.target.value)}
                placeholder="Misal: New EBS LP for Singapore"
                className="mt-1 w-full text-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-900 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-400"
              />
            </div>

            <div>
              <label className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">
                Tiket yang akan jadi child ({selectedTasks.length})
              </label>
              <ul className="mt-1 space-y-1">
                {selectedTasks.map(t => (
                  <li key={t.id} className="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
                    <span className="font-mono text-indigo-500">#{t.id}</span> {t.subject}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">Task breakdown baru (opsional)</label>
              <div className="mt-1 space-y-1.5">
                {newTaskInputs.map((val, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <input
                      value={val}
                      onChange={e => setNewTaskInputs(prev => prev.map((v, j) => j === i ? e.target.value : v))}
                      placeholder={`Task baru #${i + 1}`}
                      className="flex-1 text-xs border border-gray-200 dark:border-gray-700 dark:bg-gray-900 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-400"
                    />
                    {newTaskInputs.length > 1 && (
                      <button onClick={() => setNewTaskInputs(prev => prev.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={() => setNewTaskInputs(prev => [...prev, ''])}
                  className="flex items-center gap-1 text-[11px] font-semibold text-violet-600 hover:text-violet-700">
                  <Plus size={11} /> Tambah task
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setRestructureModal(false)} className="px-3 py-1.5 text-xs font-semibold text-gray-500 hover:text-gray-700">
                Batal
              </button>
              <button
                onClick={submitRestructure}
                disabled={!restructureSubject.trim() || restructuring}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded-lg transition">
                {restructuring ? 'Membuat...' : 'Buat User Story'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-sm px-4 py-2 rounded-lg shadow-lg z-50 max-w-sm text-center">
          {toast}
        </div>
      )}

      {chatTask && (
        <TaskChatModal
          task={chatTask}
          onClose={() => setChatTask(null)}
          onAddToQueue={chatTask.taskType === 'incoming' ? async (bullets) => {
            const r = await fetch('/api/isl/sessions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                title: chatTask.title,
                bullets,
                opTaskId: chatTask.opTaskId ?? null,
                pushStatus: 'pending',
                estimatedMins: 60,
                taskStatus: 'in_progress',
                source: 'incoming',
              }),
            }).then(r => r.json()).catch(() => ({ ok: false }))
            setChatTask(null)
            showToast(r.ok ? `Added to Push Queue` : `Failed: ${r.error ?? 'error'}`)
          } : undefined}
        />
      )}

      {opTask && (
        <OpTaskModal
          wpId={opTask.id}
          opUrl={opUrl}
          onClose={() => setOpTask(null)}
        />
      )}
    </div>
  )
}
