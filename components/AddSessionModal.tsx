'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { loadSettings, WP_STATUSES } from '@/lib/op-config'
import type { CachedUserStory, CachedWorkPackage } from '@/lib/op-cache'

interface Props {
  date: string
  onClose: () => void
}

type WPMode = 'existing' | 'new' | 'none'

export default function AddSessionModal({ date, onClose }: Props) {
  const router = useRouter()
  const [title, setTitle]   = useState('')
  const [sessionStart] = useState(() => new Date())
  const [time, setTime] = useState(() => {
    const now = new Date()
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} WIB`
  })
  const [bullets, setBullets] = useState(['', '', ''])
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  // OP fields
  const [wpMode, setWpMode]               = useState<WPMode>('none')
  const [myTasks, setMyTasks]             = useState<CachedWorkPackage[]>([])
  const [userStories, setUserStories]     = useState<CachedUserStory[]>([])
  const [selectedTaskId, setSelectedTaskId]       = useState<number | null>(null)
  const [selectedStoryId, setSelectedStoryId]     = useState<number | null>(null)
  const [taskSearch, setTaskSearch]       = useState('')
  const [opResult, setOpResult]           = useState<{ taskId?: number; opUrl?: string } | null>(null)
  const [cacheEmpty, setCacheEmpty]       = useState(false)
  const [wpStatus, setWpStatus]           = useState<number | null>(null)
  const [percentDone, setPercentDone]     = useState<number | null>(null)
  const [duration, setDuration]           = useState('')

  useEffect(() => {
    titleRef.current?.focus()
    // auto-calculate duration when modal opens
    const interval = setInterval(() => {
      const mins = Math.round((new Date().getTime() - sessionStart.getTime()) / 60000)
      if (mins > 0) {
        const h = Math.floor(mins / 60), m = mins % 60
        setDuration(h > 0 ? `${h}h ${m > 0 ? m + 'm' : ''}`.trim() : `${m}m`)
      }
    }, 30000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load cache on mount
  useEffect(() => {
    fetch('/api/op/cache').then(r => r.json()).then(d => {
      setMyTasks(d.myOpenTasks ?? [])
      setUserStories(d.userStories ?? [])
      if (!d.lastSync) setCacheEmpty(true)
    }).catch(() => {})
  }, [])

  // Auto-suggest existing task when title changes
  useEffect(() => {
    if (!title || wpMode !== 'none') return
    const words = title.toLowerCase().split(/\s+/).filter(w => w.length > 3)
    const match = myTasks.find(t => words.some(w => t.subject.toLowerCase().includes(w)))
    if (match) setTaskSearch(match.subject)
  }, [title, myTasks, wpMode])

  function updateBullet(i: number, val: string) {
    setBullets(prev => {
      const next = [...prev]
      next[i] = val
      if (i === next.length - 1 && val.length > 0) next.push('')
      return next
    })
  }

  const filteredTasks = taskSearch
    ? myTasks.filter(t => t.subject.toLowerCase().includes(taskSearch.toLowerCase()))
    : myTasks

  async function save() {
    if (!title.trim()) { setError('Title wajib diisi'); return }
    setSaving(true)
    setError(null)

    const settings = loadSettings()
    const cleanBullets = bullets.filter(Boolean)

    // 1. Save to markdown
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, title: title.trim(), time, bullets: cleanBullets }),
    })
    const data = await res.json()
    if (!data.ok) {
      setError(data.error ?? 'Gagal menyimpan')
      setSaving(false)
      return
    }

    // 2. OP sync
    if (wpMode === 'existing' && selectedTaskId) {
      // Calculate actual session duration in minutes
      const actualMins = Math.max(1, Math.round((new Date().getTime() - sessionStart.getTime()) / 60000))
      // Log time entry to existing WP
      fetch('/api/op/timelog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wpId: selectedTaskId, duration: actualMins, date, title: title.trim(), userSettings: settings }),
      }).then(r => r.json()).then(d => {
        if (d.ok) setOpResult({ taskId: selectedTaskId, opUrl: d.opUrl })
      }).catch(() => {})
      // Update WP status + remaining work
      if (wpStatus !== null || percentDone !== null) {
        fetch('/api/op/wp-update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wpId: selectedTaskId, statusId: wpStatus, percentDone, spentTimeStr: time, userSettings: settings }),
        }).catch(() => {})
      }
      // Post activity comment to OP
      const commentLines = cleanBullets.length > 0 ? cleanBullets.map(b => `• ${b}`).join('\n') : ''
      const comment = `[ISL] Session: ${title.trim()}${commentLines ? '\n\n' + commentLines : ''}\n\nWaktu: ${time} | Tanggal: ${date}`
      fetch('/api/op/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wpId: selectedTaskId, comment, userSettings: settings }),
      }).catch(() => {})
    } else if (wpMode === 'new') {
      // Create new WP
      fetch('/api/op/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(), time, bullets: cleanBullets, date,
          userStoryId: selectedStoryId,
          userSettings: settings,
        }),
      }).then(r => r.json()).then(d => {
        if (d.ok) setOpResult({ taskId: d.taskId, opUrl: d.opUrl })
      }).catch(() => {})
    }

    router.refresh()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 dark:bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Add Session</h3>
          <span className="text-xs text-gray-400">{date}</span>
        </div>

        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">

          {/* Title + Time */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">Title *</label>
              <input ref={titleRef} value={title} onChange={e => setTitle(e.target.value)}
                placeholder="e.g. KYV Docker — SSL Fix"
                className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-indigo-400 placeholder-gray-400"
                onKeyDown={e => e.key === 'Enter' && save()} />
            </div>
            <div className="w-32">
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">Time</label>
              <input value={time} onChange={e => setTime(e.target.value)}
                className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
          </div>

          {/* Bullets */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">Bullets</label>
            <div className="space-y-2">
              {bullets.map((b, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-gray-300 dark:text-gray-600 text-xs">–</span>
                  <input value={b} onChange={e => updateBullet(i, e.target.value)}
                    placeholder={`Bullet ${i + 1}`}
                    className="flex-1 text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-indigo-400 placeholder-gray-400" />
                </div>
              ))}
            </div>
          </div>

          {/* OP Link */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">OpenProject</label>
            {cacheEmpty && (
              <p className="text-xs text-amber-500 mb-2">⚠ Cache kosong — sync dulu di Settings → Integrations</p>
            )}
            <div className="flex gap-2 mb-3">
              {(['none', 'existing', 'new'] as WPMode[]).map(m => (
                <button key={m} onClick={() => setWpMode(m)}
                  className={`flex-1 py-1.5 text-xs rounded-lg border transition font-medium ${wpMode === m
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'}`}>
                  {m === 'none' ? 'Skip' : m === 'existing' ? '🔗 Link existing' : '✨ Create new'}
                </button>
              ))}
            </div>

            {/* Link existing task */}
            {wpMode === 'existing' && (
              <div className="space-y-2">
                <input value={taskSearch} onChange={e => setTaskSearch(e.target.value)}
                  placeholder="Cari task…"
                  className="w-full text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-indigo-400 placeholder-gray-400" />
                <div className="max-h-36 overflow-y-auto space-y-1">
                  {filteredTasks.slice(0, 8).map(t => (
                    <button key={t.id} onClick={() => setSelectedTaskId(t.id === selectedTaskId ? null : t.id)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs border transition ${selectedTaskId === t.id
                        ? 'bg-indigo-50 dark:bg-indigo-950 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300'
                        : 'border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700 text-gray-700 dark:text-gray-300'}`}>
                      <span className="font-mono text-gray-400 mr-2">#{t.id}</span>
                      {t.subject}
                      <span className="ml-2 text-[10px] text-gray-400">{t.project}</span>
                    </button>
                  ))}
                  {filteredTasks.length === 0 && <p className="text-xs text-gray-400 py-2 text-center">Tidak ada task ditemukan</p>}
                </div>
              </div>
            )}

            {/* Create new — pick User Story */}
            {wpMode === 'new' && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500 dark:text-gray-400">Pilih User Story parent:</p>
                <div className="max-h-36 overflow-y-auto space-y-1">
                  {userStories.slice(0, 10).map(s => (
                    <button key={s.id} onClick={() => setSelectedStoryId(s.id === selectedStoryId ? null : s.id)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs border transition ${selectedStoryId === s.id
                        ? 'bg-emerald-50 dark:bg-emerald-950 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300'
                        : 'border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700 text-gray-700 dark:text-gray-300'}`}>
                      <span className="font-mono text-gray-400 mr-2">#{s.id}</span>
                      {s.subject}
                      <span className="ml-2 text-[10px] text-gray-400">{s.project}</span>
                    </button>
                  ))}
                  {userStories.length === 0 && <p className="text-xs text-gray-400 py-2 text-center">Cache kosong — sync di Settings</p>}
                </div>
                {!selectedStoryId && (
                  <p className="text-xs text-gray-400">Tidak pilih = auto-detect dari judul</p>
                )}
              </div>
            )}
          </div>

          {/* Duration indicator */}
          {duration && (
            <p className="text-[11px] text-gray-400">⏱ Session berjalan: <span className="font-semibold text-indigo-500">{duration}</span></p>
          )}

          {/* WP Status + % Complete (only when linked to existing) */}
          {wpMode === 'existing' && selectedTaskId && (
            <div className="space-y-3 pt-1 border-t border-gray-100 dark:border-gray-800">
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">Update Status Task</label>
                <div className="flex flex-wrap gap-1.5">
                  {WP_STATUSES.map(s => (
                    <button key={s.id} onClick={() => setWpStatus(wpStatus === s.opId ? null : s.opId)}
                      className={`px-2.5 py-1 text-xs rounded-lg border font-medium transition ${wpStatus === s.opId ? 'text-white' : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400'}`}
                      style={wpStatus === s.opId ? { background: s.color, borderColor: s.color } : {}}>
                      {s.label}
                    </button>
                  ))}
                  {wpStatus && <button onClick={() => setWpStatus(null)} className="text-[10px] text-gray-400 hover:text-red-400 px-1">✕ clear</button>}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">
                  % Complete {percentDone !== null ? <span className="text-indigo-500 font-bold">{percentDone}%</span> : <span className="text-gray-400">(auto dari estimasi)</span>}
                </label>
                <div className="flex gap-1.5">
                  {[0, 25, 50, 75, 100].map(p => (
                    <button key={p} onClick={() => setPercentDone(percentDone === p ? null : p)}
                      className={`flex-1 py-1 text-xs rounded-lg border font-semibold transition ${percentDone === p ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'}`}>
                      {p}%
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}
          {opResult && (
            <p className="text-xs text-emerald-600">✅ WP #{opResult.taskId} dibuat di OP</p>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          <div className="text-xs text-gray-400">
            {wpMode === 'existing' && selectedTaskId && `→ Log time ke #${selectedTaskId}`}
            {wpMode === 'new' && `→ Create task baru di OP`}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition">
              Cancel
            </button>
            <button onClick={save} disabled={saving}
              className="px-4 py-2 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition">
              {saving ? 'Saving…' : 'Save Session'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
