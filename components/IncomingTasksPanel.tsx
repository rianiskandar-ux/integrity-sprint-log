'use client'

import { useState, useEffect } from 'react'
import type { CachedWorkPackage } from '@/lib/op-cache'
import { useI18n } from '@/lib/i18n'
import TaskChatModal, { type TaskChatContext } from './TaskChatModal'

const ISL_STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  new:         { label: 'New',         color: 'text-gray-500',   dot: 'bg-gray-400' },
  in_progress: { label: 'In Progress', color: 'text-blue-500',   dot: 'bg-blue-500' },
  on_hold:     { label: 'On Hold',     color: 'text-amber-500',  dot: 'bg-amber-500' },
  done:        { label: 'Done',        color: 'text-emerald-600',dot: 'bg-emerald-500' },
  rejected:    { label: 'Rejected',    color: 'text-red-500',    dot: 'bg-red-400' },
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
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

  useEffect(() => {
    fetch('/api/op/cache')
      .then(r => r.json())
      .then(d => {
        setTasks(d.incomingTasks ?? [])
        if (d._opUrl) setOpUrl(d._opUrl)
        setLoading(false)
      })
      .catch(() => setLoading(false))
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
      showToast(r.synced ? `✅ Status → OP #${task.id}` : `✅ Status disimpan (OP offline)`)
      // Notify SprintBanner + other components to refresh
      window.dispatchEvent(new Event('isl:cache-refreshed'))
    } else {
      showToast(`❌ ${t('incoming.failed_update')}: ${r.error ?? 'unknown'}`)
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
      const d = await fetch('/api/op/cache').then(r => r.json())
      setTasks(d.incomingTasks ?? [])
      window.dispatchEvent(new Event('isl:cache-refreshed'))
    } catch {}
    setLoading(false)
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
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
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">📥 Tiket Masuk</h2>
          <p className="text-xs text-gray-400 mt-0.5">Task dari tim lain yang di-assign ke kamu di OP — disinkron otomatis</p>
        </div>
        {tasks.length > 0 && (
          <div className="text-right text-xs text-gray-400">
            <div className="font-semibold text-gray-700 dark:text-gray-200">{tasks.length} tiket total</div>
            <div>{tasks.filter(t => t.islStatus !== 'done' && t.islStatus !== 'rejected').length} masih open</div>
          </div>
        )}
      </div>

      {/* Sync notice */}
      <div className="text-[11px] text-gray-400 bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700 rounded-lg px-3 py-2">
        ℹ️ Tiket Masuk = task yang <strong>di-assign ke kamu</strong> di OP tapi <strong>dibuat oleh orang lain</strong>. Status yang kamu ubah di sini akan langsung sync ke OP.
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
          <div className="text-3xl mb-3">📭</div>
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
            return (
              <div key={task.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 hover:border-gray-300 dark:hover:border-gray-600 transition">
                <div className="flex items-start gap-3">
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
                        <span className="text-[10px] text-indigo-400 bg-indigo-50 dark:bg-indigo-950 px-1.5 py-0.5 rounded">
                          🏃 {task.sprintName}
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
                      <span>✏️ Dibuat: <strong className="text-gray-600 dark:text-gray-300">{task.createdBy ?? '—'}</strong></span>
                      <span>📅 {formatDate(task.createdAt)}</span>
                      {task.updatedAt && task.updatedAt !== task.createdAt && (
                        <span>🔄 Update: {formatDate(task.updatedAt)}</span>
                      )}
                    </div>
                  </div>

                  {/* Status quick-set */}
                  <div className="flex-shrink-0 flex flex-col gap-1.5 min-w-[88px]">
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent('isl:start-session', { detail: { title: task.subject, opTaskId: task.id } }))}
                      className="px-2 py-1 text-[10px] font-semibold text-emerald-700 border border-emerald-200 dark:border-emerald-800 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-950 transition">
                      ▶ Mulai Kerja
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
                      className="px-2 py-1 text-[10px] font-semibold text-indigo-600 border border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950 transition">
                      💬 Diskusi
                    </button>
                    {task.islStatus !== 'in_progress' && task.islStatus !== 'done' && (
                      <button
                        onClick={() => updateStatus(task, 'in_progress')}
                        disabled={updatingId === task.id}
                        className="px-2 py-1 text-[10px] font-semibold text-blue-600 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950 disabled:opacity-50 transition">
                        ▶ Mulai
                      </button>
                    )}
                    {task.islStatus === 'in_progress' && (
                      <button
                        onClick={() => updateStatus(task, 'on_hold')}
                        disabled={updatingId === task.id}
                        className="px-2 py-1 text-[10px] font-semibold text-amber-600 border border-amber-200 dark:border-amber-800 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-950 disabled:opacity-50 transition">
                        ⏸ Hold
                      </button>
                    )}
                    {task.islStatus === 'on_hold' && (
                      <button
                        onClick={() => updateStatus(task, 'in_progress')}
                        disabled={updatingId === task.id}
                        className="px-2 py-1 text-[10px] font-semibold text-blue-600 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950 disabled:opacity-50 transition">
                        ▶ Lanjut
                      </button>
                    )}
                    {task.islStatus !== 'done' && (
                      <button
                        onClick={() => updateStatus(task, 'done')}
                        disabled={updatingId === task.id}
                        className="px-2 py-1 text-[10px] font-semibold text-emerald-600 border border-emerald-200 dark:border-emerald-800 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-950 disabled:opacity-50 transition">
                        {updatingId === task.id ? '…' : '✅ Done'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-sm px-4 py-2 rounded-lg shadow-lg z-50 max-w-sm text-center">
          {toast}
        </div>
      )}

      {chatTask && (
        <TaskChatModal task={chatTask} onClose={() => setChatTask(null)} />
      )}
    </div>
  )
}
