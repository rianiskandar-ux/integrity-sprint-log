'use client'

import { useState, useEffect } from 'react'
import { loadSettings } from '@/lib/op-config'

interface Draft {
  title: string
  bullets: string[]
  estimatedMins: number
  startedAt: string
  updatedAt: string
  source: string
  suggestedTaskId?: number
  suggestedStoryId?: number
}

interface CachedTask { id: number; subject: string; project: string }
interface CachedStory { id: number; subject: string; project: string }

interface Props {
  onPushed: () => void
}

export default function DraftCard({ onPushed }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [open, setOpen] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [pushed, setPushed] = useState(false)
  const [tasks, setTasks] = useState<CachedTask[]>([])
  const [stories, setStories] = useState<CachedStory[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const [selectedStoryId, setSelectedStoryId] = useState<number | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editBullets, setEditBullets] = useState<string[]>([])
  const [editMins, setEditMins] = useState(30)
  const [elapsed, setElapsed] = useState('')
  const [idleMinutes, setIdleMinutes] = useState<number>(0)
  const IDLE_THRESHOLD = 15 // minutes

  // Poll for draft every 15s
  useEffect(() => {
    const check = () => {
      fetch('/api/op/context').then(r => r.json()).then(d => {
        if (d.draft) {
          setDraft(d.draft)
          setEditTitle(d.draft.title)
          setEditBullets(d.draft.bullets)
          setEditMins(d.draft.estimatedMins)
          setSelectedTaskId(d.draft.suggestedTaskId ?? null)
          setSelectedStoryId(d.draft.suggestedStoryId ?? null)
        } else {
          setDraft(null)
        }
      }).catch(() => {})
    }
    check()
    const iv = setInterval(check, 15000)
    return () => clearInterval(iv)
  }, [])

  // Elapsed time + idle detection
  useEffect(() => {
    if (!draft) return
    const update = () => {
      const startMins = Math.round((Date.now() - new Date(draft.startedAt).getTime()) / 60000)
      const h = Math.floor(startMins / 60), m = startMins % 60
      setElapsed(h > 0 ? `${h}h ${m}m` : `${m}m`)
      setEditMins(startMins > 0 ? startMins : draft.estimatedMins)

      // Idle = time since last hook update (updatedAt)
      const idle = Math.round((Date.now() - new Date(draft.updatedAt).getTime()) / 60000)
      setIdleMinutes(idle)
    }
    update()
    const iv = setInterval(update, 30000)
    return () => clearInterval(iv)
  }, [draft])

  // Load cache when modal opens
  useEffect(() => {
    if (!open) return
    fetch('/api/op/cache').then(r => r.json()).then(d => {
      setTasks(d.myOpenTasks ?? [])
      setStories(d.userStories ?? [])
    }).catch(() => {})
  }, [open])

  async function doPush() {
    if (!draft) return
    setPushing(true)
    const settings = loadSettings()
    const date = new Date().toISOString().split('T')[0]

    // 1. Save session to markdown
    await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, title: editTitle, time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB', bullets: editBullets.filter(Boolean) }),
    }).catch(() => {})

    // 2. Timelog to OP
    if (selectedTaskId) {
      await fetch('/api/op/timelog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wpId: selectedTaskId, duration: editMins, date, title: editTitle, userSettings: settings }),
      }).catch(() => {})

      // 3. Activity comment
      const comment = `[ISL] ${editTitle}\n\n${editBullets.filter(Boolean).map(b => `• ${b}`).join('\n')}\n\nWaktu: ${editMins}m | Tanggal: ${date}`
      await fetch('/api/op/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wpId: selectedTaskId, comment, userSettings: settings }),
      }).catch(() => {})
    } else if (selectedStoryId) {
      // Create new task under story
      await fetch('/api/op/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editTitle, bullets: editBullets.filter(Boolean), date, time: `${editMins}m`, userStoryId: selectedStoryId, userSettings: settings }),
      }).catch(() => {})
    }

    // 4. Mark draft as pushed
    await fetch('/api/op/context', { method: 'DELETE' }).catch(() => {})

    setPushing(false)
    setPushed(true)
    setOpen(false)
    setDraft(null)
    setTimeout(() => { setPushed(false); onPushed() }, 2000)
  }

  const isIdle = draft ? idleMinutes >= IDLE_THRESHOLD : false

  // Always show indicator
  if (!draft) {
    return (
      <div
        className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-700"
        title="Smart Auto — belum ada sesi aktif hari ini"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600" />
        No session
      </div>
    )
  }

  return (
    <>
      {/* Idle alert banner — shown above header when idle */}
      {isIdle && (
        <div className="fixed top-0 left-0 right-0 z-[60] bg-amber-500 text-white text-xs font-semibold px-4 py-2 flex items-center justify-between shadow-lg">
          <span>
            ⏸ Chat idle {idleMinutes} menit — <strong>{editTitle.slice(0, 40)}</strong> belum dipush ke OP
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setOpen(true)}
              className="bg-white text-amber-600 px-3 py-1 rounded-full text-xs font-bold hover:bg-amber-50 transition"
            >
              Push sekarang
            </button>
            <span className="text-amber-200 text-xs">atau lanjut chat untuk update otomatis</span>
          </div>
        </div>
      )}

      {/* Header pill */}
      <button
        onClick={() => setOpen(true)}
        className={`hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition ${
          isIdle
            ? 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700 hover:bg-amber-100 animate-pulse'
            : 'bg-violet-50 dark:bg-violet-950 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800 hover:bg-violet-100 dark:hover:bg-violet-900 animate-pulse'
        }`}
        title={isIdle ? `Idle ${idleMinutes}m — klik untuk push` : 'Draft aktif — klik untuk review & push'}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${isIdle ? 'bg-amber-500' : 'bg-violet-500'}`} />
        {isIdle ? `⏸ Idle ${idleMinutes}m` : `● ${elapsed || `~${editMins}m`}`}
        <span className="truncate max-w-[120px]">· {editTitle.slice(0, 20)}{editTitle.length > 20 ? '…' : ''}</span>
        <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${isIdle ? 'bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200' : 'bg-violet-200 dark:bg-violet-800 text-violet-700 dark:text-violet-300'}`}>
          {isIdle ? '!' : 'Push'}
        </span>
      </button>

      {/* Push modal */}
      {open && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
              <div>
                <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Review & Push ke OP</h3>
                <p className="text-xs text-gray-400 mt-0.5">Cek dan push session ke OpenProject</p>
              </div>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>

            <div className="px-6 py-4 space-y-4 max-h-[65vh] overflow-y-auto">

              {/* Title */}
              <div>
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide block mb-1.5">Judul Session</label>
                <input
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-violet-400"
                />
              </div>

              {/* Bullets */}
              <div>
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide block mb-1.5">Activity Bullets</label>
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
                  <button onClick={() => setEditBullets([...editBullets, ''])} className="text-xs text-violet-500 hover:text-violet-600 mt-1">+ Tambah bullet</button>
                </div>
              </div>

              {/* Duration */}
              <div className="flex items-center gap-3">
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Durasi</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={editMins}
                    onChange={e => setEditMins(Number(e.target.value))}
                    className="w-20 text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-violet-400 text-center"
                  />
                  <span className="text-xs text-gray-400">menit</span>
                  {elapsed && <span className="text-xs text-violet-500 font-semibold">({elapsed} aktual)</span>}
                </div>
              </div>

              {/* Link to task */}
              <div>
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide block mb-1.5">Link ke Task OP</label>
                {tasks.length === 0 ? (
                  <p className="text-xs text-amber-500">⚠ Cache kosong — sync di Settings → Integrations dulu</p>
                ) : (
                  <div className="space-y-1 max-h-36 overflow-y-auto">
                    <button
                      onClick={() => { setSelectedTaskId(null); setSelectedStoryId(null) }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs border transition ${!selectedTaskId && !selectedStoryId ? 'bg-gray-100 dark:bg-gray-800 border-gray-400 font-semibold' : 'border-gray-100 dark:border-gray-800 text-gray-500 hover:border-gray-200'}`}
                    >
                      Tidak link ke task (hanya simpan lokal)
                    </button>
                    {tasks.slice(0, 8).map(t => (
                      <button key={t.id} onClick={() => { setSelectedTaskId(t.id); setSelectedStoryId(null) }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-xs border transition ${selectedTaskId === t.id ? 'bg-violet-50 dark:bg-violet-950 border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300' : 'border-gray-100 dark:border-gray-800 hover:border-gray-200 text-gray-700 dark:text-gray-300'}`}>
                        <span className="font-mono text-gray-400 mr-2">#{t.id}</span>
                        {t.subject}
                        <span className="ml-2 text-[10px] text-gray-400">{t.project}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 dark:border-gray-800">
              <button
                onClick={() => { fetch('/api/op/context', { method: 'DELETE' }); setDraft(null); setOpen(false) }}
                className="text-xs text-gray-400 hover:text-red-500 transition"
              >
                Buang draft
              </button>
              <div className="flex gap-2">
                <button onClick={() => setOpen(false)} className="px-4 py-2 text-xs font-semibold border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition">
                  Nanti
                </button>
                <button
                  onClick={doPush}
                  disabled={pushing}
                  className="px-5 py-2 text-xs font-bold bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 transition"
                >
                  {pushing ? 'Pushing…' : '🚀 Push ke OP'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Success toast */}
      {pushed && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-violet-700 text-white text-sm px-4 py-2 rounded-lg shadow-lg z-50">
          ✅ Pushed ke OP!
        </div>
      )}
    </>
  )
}
