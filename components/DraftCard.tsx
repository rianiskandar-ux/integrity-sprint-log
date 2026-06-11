'use client'

import { useState, useEffect } from 'react'
import { loadSettings } from '@/lib/op-config'
import { useI18n } from '@/lib/i18n'

interface Draft {
  id: string
  sessionId?: string
  title: string
  bullets: string[]
  estimatedMins: number
  startedAt: string
  updatedAt: string
  source: string
  status: 'pending' | 'pushed' | 'discarded'
  suggestedTaskId?: number
  suggestedStoryId?: number
}

interface CachedTask { id: number; subject: string; project: string }

interface Props {
  onPushed: () => void
}

const IDLE_THRESHOLD = 15

function getElapsed(startedAt: string) {
  const mins = Math.round((Date.now() - new Date(startedAt).getTime()) / 60000)
  const h = Math.floor(mins / 60), m = mins % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function getIdle(updatedAt: string) {
  return Math.round((Date.now() - new Date(updatedAt).getTime()) / 60000)
}

export default function DraftCard({ onPushed }: Props) {
  const { t } = useI18n()
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [open, setOpen] = useState(false)
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null)
  const [pushing, setPushing] = useState(false)
  const [pushed, setPushed] = useState(false)
  const [tasks, setTasks] = useState<CachedTask[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editBullets, setEditBullets] = useState<string[]>([])
  const [editMins, setEditMins] = useState(30)
  const [tick, setTick] = useState(0)

  // Poll for drafts
  useEffect(() => {
    const check = () => {
      fetch('/api/op/context').then(r => r.json()).then(d => {
        setDrafts(d.drafts ?? [])
      }).catch(() => {})
    }
    check()
    const iv = setInterval(check, 15000)
    return () => clearInterval(iv)
  }, [])

  // Tick for elapsed/idle display
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 30000)
    return () => clearInterval(iv)
  }, [])

  // When drafts change, default active to first
  useEffect(() => {
    if (drafts.length > 0 && !drafts.find(d => d.id === activeDraftId)) {
      setActiveDraftId(drafts[0].id)
    }
    if (drafts.length === 0) setActiveDraftId(null)
  }, [drafts])

  // Sync edit fields when active draft changes
  const activeDraft = drafts.find(d => d.id === activeDraftId) ?? null
  useEffect(() => {
    if (activeDraft) {
      setEditTitle(activeDraft.title)
      setEditBullets(activeDraft.bullets)
      setEditMins(Math.max(
        activeDraft.estimatedMins,
        Math.round((Date.now() - new Date(activeDraft.startedAt).getTime()) / 60000)
      ))
      setSelectedTaskId(activeDraft.suggestedTaskId ?? null)
    }
  }, [activeDraftId])

  // Load tasks when modal opens
  useEffect(() => {
    if (!open) return
    fetch('/api/op/cache').then(r => r.json()).then(d => {
      setTasks(d.myOpenTasks ?? [])
    }).catch(() => {})
  }, [open])

  async function doPush() {
    if (!activeDraft) return
    setPushing(true)
    const settings = loadSettings()
    const date = new Date().toISOString().split('T')[0]

    await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date, title: editTitle,
        time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB',
        bullets: editBullets.filter(Boolean),
      }),
    }).catch(() => {})

    if (selectedTaskId) {
      await fetch('/api/op/timelog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wpId: selectedTaskId, duration: editMins, date, title: editTitle, userSettings: settings }),
      }).catch(() => {})

      const comment = `[ISL] ${editTitle}\n\n${editBullets.filter(Boolean).map(b => `• ${b}`).join('\n')}\n\nDuration: ${editMins}m | Date: ${date}`
      await fetch('/api/op/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wpId: selectedTaskId, comment, userSettings: settings }),
      }).catch(() => {})
    }

    // Mark this specific draft as pushed
    await fetch(`/api/op/context?id=${activeDraft.id}`, { method: 'DELETE' }).catch(() => {})

    setPushing(false)
    setPushed(true)

    // Remove from local state
    const remaining = drafts.filter(d => d.id !== activeDraft.id)
    setDrafts(remaining)
    if (remaining.length > 0) {
      setActiveDraftId(remaining[0].id)
    } else {
      setOpen(false)
    }
    setTimeout(() => { setPushed(false); onPushed() }, 2000)
  }

  async function doDiscard(id: string) {
    await fetch(`/api/op/context?id=${id}`, { method: 'DELETE' }).catch(() => {})
    const remaining = drafts.filter(d => d.id !== id)
    setDrafts(remaining)
    if (remaining.length > 0) {
      setActiveDraftId(remaining[0].id)
    } else {
      setOpen(false)
    }
  }

  // Derived
  const pendingCount = drafts.length
  const idleDrafts = drafts.filter(d => getIdle(d.updatedAt) >= IDLE_THRESHOLD)
  const hasIdle = idleDrafts.length > 0
  const mostUrgent = hasIdle ? idleDrafts[0] : (drafts[0] ?? null)

  if (pendingCount === 0) {
    return (
      <div
        className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-700"
        title={t('draft.no_tooltip')}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600" />
        {t('draft.no_activity')}
      </div>
    )
  }

  const pillIdle = hasIdle
  const pillLabel = pendingCount > 1
    ? `${pendingCount} ${t('draft.n_activities')}`
    : mostUrgent
      ? pillIdle
        ? `⏸ ${getIdle(mostUrgent.updatedAt)}m idle`
        : `● ${getElapsed(mostUrgent.startedAt)}`
      : '●'
  const pillTitle = mostUrgent ? `${mostUrgent.title.slice(0, 22)}${mostUrgent.title.length > 22 ? '…' : ''}` : ''

  return (
    <>
      {/* Idle alert banner — only for oldest idle draft */}
      {hasIdle && (
        <div className="fixed top-0 left-0 right-0 z-[60] bg-amber-500 text-white text-xs font-semibold px-4 py-2 flex items-center justify-between shadow-lg">
          <span>
            ⏸ {getIdle(idleDrafts[0].updatedAt)} {t('draft.idle_minutes')} —{' '}
            <strong>{idleDrafts[0].title.slice(0, 40)}</strong> {t('draft.idle_alert')}
            {idleDrafts.length > 1 && <span className="ml-2 opacity-80">(+{idleDrafts.length - 1} {t('draft.others')})</span>}
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setActiveDraftId(idleDrafts[0].id); setOpen(true) }}
              className="bg-white text-amber-600 px-3 py-1 rounded-full text-xs font-bold hover:bg-amber-50 transition"
            >
              {t('draft.push_now')}
            </button>
            <span className="text-amber-200 text-xs">{t('draft.idle_hint')}</span>
          </div>
        </div>
      )}

      {/* Header pill */}
      <button
        onClick={() => setOpen(true)}
        className={`hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition ${
          pillIdle
            ? 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700 hover:bg-amber-100 animate-pulse'
            : 'bg-violet-50 dark:bg-violet-950 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800 hover:bg-violet-100 dark:hover:bg-violet-900 animate-pulse'
        }`}
        title={pillIdle ? t('draft.idle_tooltip') : t('draft.active_tooltip')}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${pillIdle ? 'bg-amber-500' : 'bg-violet-500'}`} />
        {pillLabel}
        {pillTitle && <span className="truncate max-w-[120px]">· {pillTitle}</span>}
        {pendingCount > 1 && (
          <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${pillIdle ? 'bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200' : 'bg-violet-200 dark:bg-violet-800 text-violet-700 dark:text-violet-300'}`}>
            {pendingCount}
          </span>
        )}
        {pendingCount === 1 && (
          <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${pillIdle ? 'bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200' : 'bg-violet-200 dark:bg-violet-800 text-violet-700 dark:text-violet-300'}`}>
            {pillIdle ? '!' : t('draft.send_btn').replace('🚀 ', '')}
          </span>
        )}
      </button>

      {/* Multi-draft modal */}
      {open && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
              <div>
                <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{t('draft.modal_title')}</h3>
                <p className="text-xs text-gray-400 mt-0.5">{t('draft.modal_subtitle')}</p>
              </div>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>

            {/* Draft tabs — only show if more than 1 */}
            {drafts.length > 1 && (
              <div className="px-4 pt-3 pb-0 flex gap-1.5 overflow-x-auto">
                {drafts.map((d, i) => {
                  const isActive = d.id === activeDraftId
                  const isIdle = getIdle(d.updatedAt) >= IDLE_THRESHOLD
                  return (
                    <button
                      key={d.id}
                      onClick={() => setActiveDraftId(d.id)}
                      className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                        isActive
                          ? 'bg-violet-50 dark:bg-violet-950 border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300'
                          : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'
                      }`}
                    >
                      {isIdle && <span className="text-amber-500">⏸</span>}
                      <span>{i + 1}.</span>
                      <span className="max-w-[100px] truncate">{d.title}</span>
                    </button>
                  )
                })}
              </div>
            )}

            {/* Active draft detail */}
            {activeDraft && (
              <div className="px-6 py-4 space-y-4 max-h-[58vh] overflow-y-auto">

                {/* Meta row */}
                <div className="flex items-center gap-3 text-[11px] text-gray-400">
                  <span>⏱ {getElapsed(activeDraft.startedAt)}</span>
                  {getIdle(activeDraft.updatedAt) >= IDLE_THRESHOLD && (
                    <span className="text-amber-500 font-semibold">⏸ idle {getIdle(activeDraft.updatedAt)}m</span>
                  )}
                  {drafts.length > 1 && (
                    <span className="ml-auto text-violet-500 font-semibold">
                      {drafts.indexOf(activeDraft) + 1} / {drafts.length}
                    </span>
                  )}
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide block mb-1.5">{t('draft.title_label')}</label>
                  <input
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-violet-400"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide block mb-1.5">{t('draft.bullets_label')}</label>
                  <div className="space-y-1.5">
                    {editBullets.map((b, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-gray-300 dark:text-gray-600 text-xs">–</span>
                        <input
                          value={b}
                          onChange={e => { const next = [...editBullets]; next[i] = e.target.value; setEditBullets(next) }}
                          className="flex-1 text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-violet-400"
                        />
                      </div>
                    ))}
                    <button onClick={() => setEditBullets([...editBullets, ''])} className="text-xs text-violet-500 hover:text-violet-600 mt-1">{t('draft.add_bullet')}</button>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('draft.duration_label')}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={editMins}
                      onChange={e => setEditMins(Number(e.target.value))}
                      className="w-20 text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-violet-400 text-center"
                    />
                    <span className="text-xs text-gray-400">{t('draft.minutes')}</span>
                    <span className="text-xs text-violet-500 font-semibold">({getElapsed(activeDraft.startedAt)} {t('draft.actual')})</span>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide block mb-1.5">{t('draft.link_task')}</label>
                  {tasks.length === 0 ? (
                    <p className="text-xs text-amber-500">{t('draft.cache_empty')}</p>
                  ) : (
                    <div className="space-y-1 max-h-36 overflow-y-auto">
                      <button
                        onClick={() => setSelectedTaskId(null)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-xs border transition ${!selectedTaskId ? 'bg-gray-100 dark:bg-gray-800 border-gray-400 font-semibold' : 'border-gray-100 dark:border-gray-800 text-gray-500 hover:border-gray-200'}`}
                      >
                        {t('draft.no_link')}
                      </button>
                      {tasks.slice(0, 8).map(tk => (
                        <button key={tk.id} onClick={() => setSelectedTaskId(tk.id)}
                          className={`w-full text-left px-3 py-2 rounded-lg text-xs border transition ${selectedTaskId === tk.id ? 'bg-violet-50 dark:bg-violet-950 border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300' : 'border-gray-100 dark:border-gray-800 hover:border-gray-200 text-gray-700 dark:text-gray-300'}`}>
                          <span className="font-mono text-gray-400 mr-2">#{tk.id}</span>
                          {tk.subject}
                          <span className="ml-2 text-[10px] text-gray-400">{tk.project}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 dark:border-gray-800">
              <button
                onClick={() => activeDraft && doDiscard(activeDraft.id)}
                className="text-xs text-gray-400 hover:text-red-500 transition"
              >
                {t('draft.discard')}
              </button>
              <div className="flex gap-2">
                {/* Navigate to next draft if multiple */}
                {drafts.length > 1 && activeDraft && (
                  <button
                    onClick={() => {
                      const idx = drafts.indexOf(activeDraft)
                      setActiveDraftId(drafts[(idx + 1) % drafts.length].id)
                    }}
                    className="px-3 py-2 text-xs font-semibold border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition"
                  >
                    {t('draft.later')} →
                  </button>
                )}
                {drafts.length === 1 && (
                  <button onClick={() => setOpen(false)} className="px-4 py-2 text-xs font-semibold border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition">
                    {t('draft.later')}
                  </button>
                )}
                <button
                  onClick={doPush}
                  disabled={pushing}
                  className="px-5 py-2 text-xs font-bold bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 transition"
                >
                  {pushing ? t('draft.sending') : t('draft.send_btn')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Success toast */}
      {pushed && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-violet-700 text-white text-sm px-4 py-2 rounded-lg shadow-lg z-50">
          {t('draft.success')}
          {drafts.length > 0 && <span className="ml-2 opacity-75">· {drafts.length} {t('draft.more_left')}</span>}
        </div>
      )}
    </>
  )
}
