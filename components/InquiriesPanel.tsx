'use client'

import { useState, useEffect, useMemo } from 'react'
import type { InquiryItem } from '@/app/api/op/inquiries/route'
import TaskChatModal, { type TaskChatContext } from './TaskChatModal'
import OpTaskModal from './OpTaskModal'
import { Mail, CalendarDays, RefreshCw, Info, MessageCircle, ExternalLink, ArrowUpDown } from 'lucide-react'

const STATUS_DOT: Record<string, { color: string; dot: string }> = {
  new:         { color: 'text-gray-500',    dot: 'bg-gray-400' },
  'in progress': { color: 'text-blue-500',  dot: 'bg-blue-500' },
  'on hold':   { color: 'text-amber-500',   dot: 'bg-amber-500' },
  closed:      { color: 'text-emerald-600', dot: 'bg-emerald-500' },
  rejected:    { color: 'text-red-500',     dot: 'bg-red-400' },
}
function statusStyle(status: string) {
  return STATUS_DOT[status.toLowerCase()] ?? { color: 'text-gray-400', dot: 'bg-gray-300' }
}

function typeBadgeCls(type: string): string {
  const t = type.toLowerCase()
  if (t.includes('bug')) return 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-300 border border-red-200 dark:border-red-800'
  if (t.includes('task')) return 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
  return 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300 border border-gray-200 dark:border-gray-600'
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  return Math.floor(ms / (24 * 60 * 60 * 1000))
}

function ageBadgeCls(days: number | null): string {
  if (days === null) return 'bg-gray-100 dark:bg-gray-700 text-gray-400'
  if (days > 14) return 'bg-red-100 dark:bg-red-950/50 text-red-600 dark:text-red-300'
  if (days >= 7) return 'bg-amber-100 dark:bg-amber-950/50 text-amber-600 dark:text-amber-300'
  return 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-400'
}

export default function InquiriesPanel() {
  const [items, setItems]     = useState<InquiryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [opUrl, setOpUrl]     = useState('https://tokek.integrity-asia.com')
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)
  const [filter, setFilter]   = useState<'all' | 'mine'>('all')
  const [sortNewest, setSortNewest] = useState(false) // default: oldest-touched first
  const [toast, setToast]     = useState<string | null>(null)
  const [chatTask, setChatTask] = useState<TaskChatContext | null>(null)
  const [opTask, setOpTask]   = useState<{ id: number; subject: string } | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  async function load() {
    try {
      const r = await fetch('/api/op/inquiries')
      const d = await r.json()
      if (d.ok) {
        setItems(d.items ?? [])
        setCurrentUserId(d.currentUserId ?? null)
      }
    } catch { /* offline — keep last known list */ }
  }

  useEffect(() => {
    fetch('/api/op/cache')
      .then(r => r.json())
      .then(d => { if (d._opUrl) setOpUrl(d._opUrl) })
      .catch(() => {})
    load().finally(() => setLoading(false))
  }, [])

  async function refresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const shown = useMemo(() => {
    const list = filter === 'mine'
      ? items.filter(i => currentUserId !== null && i.assigneeId === currentUserId)
      : items
    return [...list].sort((a, b) => {
      const av = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
      const bv = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
      return sortNewest ? bv - av : av - bv
    })
  }, [items, filter, currentUserId, sortNewest])

  const mineCount = currentUserId !== null ? items.filter(i => i.assigneeId === currentUserId).length : 0

  if (loading) return (
    <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Memuat inquiries…</div>
  )

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Mail size={16} /> Inquiries
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">Tickets created by others across the team — mirrors OP saved view #112</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            disabled={refreshing}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition">
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
          <a
            href={`${opUrl}/work_packages?query_id=112`}
            target="_blank" rel="noopener"
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-indigo-600 border border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950 transition">
            <ExternalLink size={12} /> Buka di OP
          </a>
        </div>
      </div>

      {/* Info notice */}
      <div className="text-[11px] text-gray-400 bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700 rounded-lg px-3 py-2 flex items-start gap-1.5">
        <Info size={11} className="flex-shrink-0 mt-0.5" />
        <span>Pure read-only mirror — ISL tidak menambah filter apa pun. Aksi (Detail/Chat) hanya tersedia untuk tiket yang assignee-nya kamu.</span>
      </div>

      {/* Filter + sort */}
      {items.length > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-2 border-b border-gray-200 dark:border-gray-700">
          <div className="flex gap-2">
            {(['all', 'mine'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-2 text-xs font-semibold border-b-2 transition -mb-px ${
                  filter === f
                    ? 'border-violet-500 text-violet-600 dark:text-violet-400'
                    : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}>
                {f === 'all' ? `Semua (${items.length})` : `Punya saya (${mineCount})`}
              </button>
            ))}
          </div>
          <button
            onClick={() => setSortNewest(v => !v)}
            className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 pb-2 transition">
            <ArrowUpDown size={10} />
            {sortNewest ? 'terbaru disentuh' : 'terlama disentuh'}
          </button>
        </div>
      )}

      {/* Empty state */}
      {items.length === 0 ? (
        <div className="text-center text-gray-400 text-sm py-12">
          <div className="flex justify-center mb-3"><Mail size={40} className="text-gray-300 dark:text-gray-600" /></div>
          <p>Tidak ada inquiries.</p>
          <p className="text-xs mt-1 text-gray-300 dark:text-gray-600">Query OP #112 sedang kosong, atau belum sempat di-refresh.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map(item => {
            const st = statusStyle(item.status)
            const days = daysSince(item.updatedAt)
            const isMine = currentUserId !== null && item.assigneeId === currentUserId
            return (
              <div key={item.id} className="rounded-xl border p-4 transition bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">

                    {/* Row 1: type + project + status + sprint */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${typeBadgeCls(item.type)}`}>
                        {item.type || 'Type'}
                      </span>
                      <span className="text-[10px] font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-full">
                        {item.project || '—'}
                      </span>
                      <span className="flex items-center gap-1 text-[10px] font-semibold">
                        <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                        <span className={st.color}>{item.status || 'Unknown'}</span>
                      </span>
                      {item.sprintName ? (
                        <span className="flex items-center gap-0.5 text-[10px] text-indigo-400 bg-indigo-50 dark:bg-indigo-950 px-1.5 py-0.5 rounded">
                          <CalendarDays size={9} />{item.sprintName}
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-400 bg-gray-50 dark:bg-gray-800 px-1.5 py-0.5 rounded">No version</span>
                      )}
                    </div>

                    {/* Row 2: id + subject */}
                    <div className="flex items-baseline gap-2 mt-1.5 flex-wrap">
                      <a href={`${opUrl}/work_packages/${item.id}`} target="_blank" rel="noopener"
                        className="flex-shrink-0 text-sm font-bold text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 font-mono">
                        #{item.id}
                      </a>
                      <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 leading-snug">{item.subject}</p>
                    </div>

                    {/* Row 3: from -> to, dates, age */}
                    <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-400 flex-wrap">
                      <span>dari: <strong className="text-gray-600 dark:text-gray-300">{item.createdBy ?? '—'}</strong> → <strong className="text-gray-600 dark:text-gray-300">{item.assignee}</strong></span>
                      <span className="flex items-center gap-1"><CalendarDays size={9} />{formatDate(item.createdAt)}</span>
                      {days !== null && (
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${ageBadgeCls(days)}`}>
                          {days}d
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex-shrink-0 flex flex-col gap-1.5 min-w-[88px]">
                    {isMine ? (
                      <>
                        <button
                          onClick={() => setOpTask({ id: item.id, subject: item.subject })}
                          className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition">
                          <Info size={10} /> Detail
                        </button>
                        <button
                          onClick={() => setChatTask({
                            id: `inquiry-${item.id}`,
                            title: item.subject,
                            taskType: 'incoming',
                            opTaskId: item.id,
                            sprintName: item.sprintName ?? null,
                            status: item.status,
                          })}
                          className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-indigo-600 border border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950 transition">
                          <MessageCircle size={10} /> Chat
                        </button>
                      </>
                    ) : (
                      <a
                        href={`${opUrl}/work_packages/${item.id}`}
                        target="_blank" rel="noopener"
                        className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition">
                        <ExternalLink size={10} /> Buka di OP
                      </a>
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
        <TaskChatModal
          task={chatTask}
          onClose={() => setChatTask(null)}
          onAddToQueue={async (bullets) => {
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
                source: 'inquiry',
              }),
            }).then(r => r.json()).catch(() => ({ ok: false }))
            setChatTask(null)
            showToast(r.ok ? 'Added to Push Queue' : `Failed: ${r.error ?? 'error'}`)
          }}
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
