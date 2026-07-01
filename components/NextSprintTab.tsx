'use client'

import { useState, useEffect } from 'react'
import { Layers, Sparkles, MapPin, CheckCircle2, Send, Package, Loader2, Zap, RefreshCw } from 'lucide-react'
import SprintRecap, { type RecapTask } from './SprintRecap'
import OpTaskModal from './OpTaskModal'

interface SuggestedTask {
  subject: string
  type: string
  projectHint: string
  estimatedHours: number
  priority: 'high' | 'medium' | 'low'
  reason: string
}

interface CarryTask {
  id: number
  subject: string
  type: string
  project: string
  estimatedHours: number | null
  status: string
}

interface StagedItem {
  key: string
  subject: string
  type: string
  projectHint: string
  estimatedHours: number
  priority: string
  reason: string
  source: 'carryover' | 'ai'
  opTaskId?: number
  bucket: 'next' | 'backlog'
}

const PRIORITY_COLOR: Record<string, string> = {
  high:   'bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400',
  medium: 'bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400',
  low:    'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
}

export default function NextSprintTab({ currentSprintNo }: { currentSprintNo: number }) {
  const [carryOver,  setCarryOver]  = useState<CarryTask[]>([])
  const [aiTasks,    setAiTasks]    = useState<SuggestedTask[]>([])
  const [staged,     setStaged]     = useState<StagedItem[]>([])
  const [loading,    setLoading]    = useState(true)
  const [generating, setGenerating] = useState(false)
  const [pushing,    setPushing]    = useState(false)
  const [toast,      setToast]      = useState<string | null>(null)
  const [selected,   setSelected]   = useState<Set<string>>(new Set())
  const [inNext,     setInNext]     = useState<{ id: number; subject: string; status: string; type: string }[]>([])
  const [nextName,   setNextName]   = useState<string>('')
  const [nextRecap,  setNextRecap]  = useState<RecapTask[]>([])
  const [opUrl,      setOpUrl]      = useState('https://tokek.integrity-asia.com')
  const [opTaskId,   setOpTaskId]   = useState<number | null>(null)
  const [curSprint,  setCurSprint]  = useState<{ id: number; name: string } | null>(null)
  const [reverting,  setReverting]  = useState<number | null>(null)

  const storageKey = `next-sprint-staged-${currentSprintNo}`

  // Task yang SUDAH di next sprint (version OP) — dari cache, real
  useEffect(() => {
    function load() {
      fetch('/api/op/cache').then(r => r.json()).then(d => {
        if (d._opUrl) setOpUrl(d._opUrl)
        const sprints = (d.sprints ?? []) as { id: number; name: string; startDate: string; endDate: string; isCurrent: boolean }[]
        const cur = sprints.find(s => s.isCurrent)
        if (!cur) return
        setCurSprint({ id: cur.id, name: cur.name })
        const next = sprints
          .filter(s => (s.startDate ?? '') > (cur.endDate ?? ''))
          .sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''))[0]
        if (!next) return
        setNextName(next.name)
        const all = [...(d.myOpenTasks ?? []), ...(d.incomingTasks ?? [])] as { id: number; subject: string; status: string; type: string; sprintId: number | null }[]
        const seen = new Set<number>()
        const items = all.filter(t => t.sprintId === next.id && !seen.has(t.id) && seen.add(t.id))
          .map(t => ({ id: t.id, subject: t.subject, status: t.status, type: t.type }))
        setInNext(items)
      }).catch(() => {})
    }
    load()
    window.addEventListener('isl:cache-refreshed', load)
    return () => window.removeEventListener('isl:cache-refreshed', load)
  }, [])

  useEffect(() => {
    const saved = localStorage.getItem(storageKey)
    if (saved) {
      try { setStaged(JSON.parse(saved)) } catch { /* ignore */ }
    }
    loadPlan()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSprintNo])

  async function loadPlan() {
    setLoading(true)
    try {
      const d = await fetch('/api/op/sprint-plan').then(r => r.json())
      setCarryOver(d.carryOver ?? [])
      setNextRecap((d.nextTasks ?? []) as RecapTask[])
    } catch { /* ignore */ }
    setLoading(false)
  }

  // Revert a task already moved to next sprint: back to current sprint, or remove
  // from any sprint (back to backlog/Incoming as New).
  async function revertTask(taskId: number, target: 'current' | 'remove') {
    if (reverting) return
    setReverting(taskId)
    try {
      const body = target === 'current'
        ? { taskIds: [taskId], targetSprintId: curSprint?.id ?? null, defaultEstMins: 60 } // re-adds to active sprint → keep estimate invariant
        : { taskIds: [taskId], targetSprintId: null, statusId: 1 } // remove + set New (backlog needs no estimate)
      const r = await fetch('/api/op/sprint-move', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).then(res => res.json())
      if (r.results?.[0]?.ok) {
        setInNext(prev => prev.filter(x => x.id !== taskId))
        setNextRecap(prev => prev.filter(x => x.id !== taskId))
        setToast(target === 'current' ? `← Dibalikin ke ${curSprint?.name ?? 'current'}` : '✕ Dikeluarkan dari next sprint (jadi New)')
        setTimeout(() => setToast(null), 3500)
        await fetch('/api/op/cache', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {})
        window.dispatchEvent(new Event('isl:cache-refreshed'))
      } else {
        setToast(`⚠️ ${r.results?.[0]?.error ?? 'Gagal revert'}`); setTimeout(() => setToast(null), 4000)
      }
    } catch (e) { setToast(`⚠️ ${String(e)}`); setTimeout(() => setToast(null), 4000) }
    finally { setReverting(null) }
  }

  // Batch status change from the recap (New / In Progress / Hold / Close) → syncs to OP.
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
    setToast(`${ok}/${ids.length} sync OP${offline ? ` · ${offline} lokal (OP offline)` : ''}`); setTimeout(() => setToast(null), 3500)
    await fetch('/api/op/cache', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {})
    window.dispatchEvent(new Event('isl:cache-refreshed'))
    loadPlan()
  }

  const [filling, setFilling] = useState(false)
  // Fill empty estimates for TASK-type next-sprint tasks only (Feature/Epic/US skipped).
  async function fillEmptyEstimates() {
    if (filling) return
    const targets = nextRecap.filter(t => t.type === 'Task' && (t.estimatedHours == null))
    if (!targets.length) { setToast('Semua task sudah ada estimasi'); setTimeout(() => setToast(null), 2500); return }
    setFilling(true)
    let ok = 0
    for (const t of targets) {
      try {
        const r = await fetch('/api/op/wp-update', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wpId: t.id, estimatedMins: 60 }),
        }).then(res => res.json())
        if (!r.error) ok++
      } catch { /* skip */ }
    }
    setToast(`${ok}/${targets.length} task diisi estimasi 1h`)
    setTimeout(() => setToast(null), 3500)
    loadPlan()
    setFilling(false)
  }

  async function generateAI() {
    setGenerating(true)
    try {
      const d = await fetch('/api/op/sprint-plan/ai').then(r => r.json())
      setAiTasks(d.aiSuggestedTasks ?? [])
    } catch { /* ignore */ }
    setGenerating(false)
  }

  function saveStaged(next: StagedItem[]) {
    setStaged(next)
    localStorage.setItem(storageKey, JSON.stringify(next))
  }

  function stageItem(item: StagedItem) {
    if (staged.find(s => s.key === item.key)) return
    saveStaged([...staged, item])
  }

  function stageCarry(t: CarryTask, bucket: 'next' | 'backlog') {
    const key = `carry-${t.id}`
    const existing = staged.find(s => s.key === key)
    if (existing) {
      saveStaged(staged.map(s => s.key === key ? { ...s, bucket } : s))
    } else {
      stageItem({
        key,
        subject: t.subject,
        type: t.type,
        projectHint: t.project,
        estimatedHours: t.estimatedHours ?? 1,
        priority: 'medium',
        reason: 'Carry-over from current sprint',
        source: 'carryover',
        opTaskId: t.id,
        bucket,
      })
    }
  }

  function stageAI(t: SuggestedTask, idx: number, bucket: 'next' | 'backlog') {
    // Stable content-based key — index collides after Load-AI regenerates suggestions.
    const key = `ai-${t.subject}`
    const existing = staged.find(s => s.key === key)
    if (existing) {
      saveStaged(staged.map(s => s.key === key ? { ...s, bucket } : s))
    } else {
      stageItem({ key, ...t, source: 'ai', bucket })
    }
  }

  function removeStaged(key: string) {
    saveStaged(staged.filter(s => s.key !== key))
    setSelected(prev => { const n = new Set(prev); n.delete(key); return n })
  }

  function moveBucket(key: string, bucket: 'next' | 'backlog') {
    saveStaged(staged.map(s => s.key === key ? { ...s, bucket } : s))
  }

  function toggleSelect(key: string) {
    setSelected(prev => {
      const n = new Set(prev)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    })
  }

  async function pushSelected() {
    const toPush = staged.filter(s => s.bucket === 'next' && selected.has(s.key))
    if (!toPush.length) return
    setPushing(true)
    let ok = 0
    for (const item of toPush) {
      const r = await fetch('/api/isl/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: item.subject,
          bullets: [item.reason, `Type: ${item.type}`, `Project: ${item.projectHint}`].filter(Boolean),
          opTaskId: item.opTaskId ?? null,
          pushStatus: 'pending',
          estimatedMins: Math.round(item.estimatedHours * 60),
          taskStatus: 'new',
          source: item.source === 'carryover' ? 'incoming' : 'general',
        }),
      }).then(r => r.json()).catch(() => ({ ok: false }))
      if (r.ok) ok++
    }
    setPushing(false)
    showToast(`${ok}/${toPush.length} tasks added to Push Queue`)
    setSelected(new Set())
    window.dispatchEvent(new Event('isl:cache-refreshed'))
  }

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3500) }

  const nextItems    = staged.filter(s => s.bucket === 'next')
  const backlogItems = staged.filter(s => s.bucket === 'backlog')
  const selectedNext = nextItems.filter(s => selected.has(s.key))

  const isCarryStaged = (id: number) => staged.find(s => s.key === `carry-${id}`)
  const isAIStaged    = (_idx: number, t: SuggestedTask) => staged.find(s => s.key === `ai-${t.subject}`)

  if (loading) return <div className="py-12 text-center text-gray-400 text-sm">Loading sprint data…</div>

  return (
    <div className="space-y-6 pb-10">

      {/* Recap menyeluruh task yang sudah masuk next sprint (OP-style, semua status + totals) */}
      {nextRecap.length > 0 && (
        <div className="space-y-1.5">
          <SprintRecap
            title={`${nextName || 'Next Sprint'} · next`}
            subtitle="Task yang sudah masuk next sprint — klik untuk lihat/edit di OP"
            tasks={nextRecap}
            opUrl={opUrl}
            onTaskClick={(t) => setOpTaskId(t.id)}
            onBatchStatus={batchStatus}
          />
          {nextRecap.some(t => t.type === 'Task' && t.estimatedHours == null) && (
            <button onClick={fillEmptyEstimates} disabled={filling}
              className="w-full py-1.5 text-[10px] font-semibold text-violet-600 border border-dashed border-violet-200 dark:border-violet-800 rounded-lg hover:bg-violet-50 dark:hover:bg-violet-950/30 transition disabled:opacity-50">
              {filling ? <Loader2 size={10} className="animate-spin" /> : <><Zap size={10} /> Isi estimasi kosong ({nextRecap.filter(t => t.type === 'Task' && t.estimatedHours == null).length} Task × 1h) — Feature/Epic dilewati</>}
            </button>
          )}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100 flex items-center gap-1.5"><Layers size={16} /> Next Sprint Staging</h3>
          <p className="text-xs text-gray-400 mt-0.5">Sortir carry-over + AI suggestions → pilih yang masuk Next Sprint atau Backlog → Push ke Queue</p>
        </div>
        <button onClick={generateAI} disabled={generating}
          className="text-[10px] font-semibold px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition disabled:opacity-50">
          {generating ? <Loader2 size={10} className="animate-spin" /> : <><Sparkles size={10} /> Load AI Suggestions</>}
        </button>
      </div>

      {/* Sudah di Next Sprint (version OP, real) */}
      <div className="rounded-xl border border-purple-200 dark:border-purple-800/50 bg-purple-50/40 dark:bg-purple-950/20 p-4">
        <p className="text-[11px] font-bold text-purple-700 dark:text-purple-300 mb-2">
          <span className="flex items-center gap-1"><MapPin size={10} /> Sudah di {nextName || 'Next Sprint'} (version OP) — {inNext.length}</span>
        </p>
        {inNext.length === 0 ? (
          <p className="text-[10px] text-purple-400/70 dark:text-purple-500/60">
            Belum ada task yang dipindah. Oper dari Incoming/Push Queue pakai tombol “→ {nextName || 'Next Sprint'}”.
          </p>
        ) : (
          <div className="space-y-1.5">
            {inNext.map(t => (
              <div key={t.id} className="flex items-center gap-2 text-[11px] bg-white dark:bg-gray-800 rounded-lg px-2.5 py-1.5 border border-purple-100 dark:border-purple-900/40">
                <span className="font-mono font-bold text-purple-500">#{t.id}</span>
                <span className="flex-1 truncate text-gray-700 dark:text-gray-200">{t.subject}</span>
                <span className="text-[9px] text-gray-400 hidden sm:inline">{t.type} · {t.status}</span>
                <button onClick={() => revertTask(t.id, 'current')} disabled={reverting === t.id}
                  title={`Balikin ke ${curSprint?.name ?? 'current sprint'}`}
                  className="text-[9px] font-semibold text-blue-600 border border-blue-200 dark:border-blue-800 rounded px-1.5 py-0.5 hover:bg-blue-50 dark:hover:bg-blue-950 disabled:opacity-40">
                  ← current
                </button>
                <button onClick={() => revertTask(t.id, 'remove')} disabled={reverting === t.id}
                  title="Keluarkan dari sprint (jadi New / backlog)"
                  className="text-[9px] font-semibold text-gray-500 border border-gray-200 dark:border-gray-700 rounded px-1.5 py-0.5 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40">
                  ✕ keluar
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

        {/* Left: Source (unstaged) */}
        <div className="space-y-4">
          {/* Carry-over */}
          {carryOver.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">
                Carry-over ({carryOver.length})
              </p>
              <div className="space-y-1.5">
                {carryOver.map(t => {
                  const s = isCarryStaged(t.id)
                  return (
                    <div key={t.id} className={`rounded-xl border px-3 py-2.5 transition ${s ? 'opacity-40 border-gray-100 dark:border-gray-800' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-semibold text-gray-800 dark:text-gray-100 leading-snug">
                            <span className="text-indigo-500 font-mono mr-1">#{t.id}</span>{t.subject}
                          </p>
                          <p className="text-[10px] text-gray-400 mt-0.5">{t.project} · {t.type} · {t.status}</p>
                        </div>
                        {!s && (
                          <div className="flex gap-1 flex-shrink-0">
                            <button onClick={() => stageCarry(t, 'next')}
                              className="text-[9px] px-2 py-1 bg-indigo-500 hover:bg-indigo-600 text-white rounded font-semibold">
                              → Next
                            </button>
                            <button onClick={() => stageCarry(t, 'backlog')}
                              className="text-[9px] px-2 py-1 bg-gray-200 hover:bg-gray-300 text-gray-600 rounded font-semibold">
                              Backlog
                            </button>
                          </div>
                        )}
                        {s && <span className="text-[9px] text-gray-400 flex-shrink-0">{s.bucket === 'next' ? '→ Next ✓' : 'Backlog ✓'}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* AI Suggestions */}
          {aiTasks.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">
                AI Suggestions ({aiTasks.length})
              </p>
              <div className="space-y-1.5">
                {aiTasks.map((t, idx) => {
                  const s = isAIStaged(idx, t)
                  return (
                    <div key={idx} className={`rounded-xl border px-3 py-2.5 transition ${s ? 'opacity-40 border-gray-100 dark:border-gray-800' : 'border-amber-100 dark:border-amber-900 bg-amber-50/30 dark:bg-amber-950/10'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full ${PRIORITY_COLOR[t.priority]}`}>{t.priority}</span>
                            <span className="text-[9px] text-gray-400">{t.type} · {t.projectHint}</span>
                          </div>
                          <p className="text-[11px] font-semibold text-gray-800 dark:text-gray-100 leading-snug">{t.subject}</p>
                          <p className="text-[10px] text-gray-400 mt-0.5 italic">{t.reason}</p>
                        </div>
                        {!s && (
                          <div className="flex gap-1 flex-shrink-0">
                            <button onClick={() => stageAI(t, idx, 'next')}
                              className="text-[9px] px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded font-semibold">
                              → Next
                            </button>
                            <button onClick={() => stageAI(t, idx, 'backlog')}
                              className="text-[9px] px-2 py-1 bg-gray-200 hover:bg-gray-300 text-gray-600 rounded font-semibold">
                              Backlog
                            </button>
                          </div>
                        )}
                        {s && <span className="text-[9px] text-gray-400 flex-shrink-0">{s.bucket === 'next' ? '→ Next ✓' : 'Backlog ✓'}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {aiTasks.length === 0 && carryOver.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">Klik "Load AI Suggestions" untuk mulai</p>
          )}
        </div>

        {/* Right: Staged buckets */}
        <div className="space-y-4">

          {/* Next Sprint bucket */}
          <div className="border-2 border-indigo-100 dark:border-indigo-900 rounded-2xl p-4 min-h-[160px]">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wide">
                <span className="flex items-center gap-1"><CheckCircle2 size={10} /> Next Sprint ({nextItems.length})</span>
              </p>
              {nextItems.length > 0 && (
                <label className="flex items-center gap-1 text-[9px] text-gray-400 cursor-pointer">
                  <input type="checkbox"
                    checked={nextItems.every(s => selected.has(s.key))}
                    onChange={e => {
                      if (e.target.checked) setSelected(prev => { const n = new Set(prev); nextItems.forEach(s => n.add(s.key)); return n })
                      else setSelected(prev => { const n = new Set(prev); nextItems.forEach(s => n.delete(s.key)); return n })
                    }}
                    className="rounded"
                  />
                  Select all
                </label>
              )}
            </div>
            {nextItems.length === 0 && (
              <p className="text-[10px] text-gray-300 dark:text-gray-600 text-center py-6">Belum ada — klik "→ Next" di kiri</p>
            )}
            <div className="space-y-1.5">
              {nextItems.map(s => (
                <div key={s.key} className="flex items-start gap-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 px-2.5 py-2">
                  <input type="checkbox" checked={selected.has(s.key)} onChange={() => toggleSelect(s.key)}
                    className="mt-0.5 rounded flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold text-gray-800 dark:text-gray-100 leading-snug">{s.subject}</p>
                    <p className="text-[9px] text-gray-400">{s.projectHint} · {Math.round(s.estimatedHours)}h · <span className="inline-flex items-center gap-0.5 text-amber-500">{s.source === 'ai' ? <><Sparkles size={8} /> AI</> : <><RefreshCw size={8} /> carry-over</>}</span></p>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => moveBucket(s.key, 'backlog')} className="text-[9px] text-gray-300 hover:text-gray-500">↓</button>
                    <button onClick={() => removeStaged(s.key)} className="text-[9px] text-gray-300 hover:text-red-400">✕</button>
                  </div>
                </div>
              ))}
            </div>

            {selectedNext.length > 0 && (
              <button onClick={pushSelected} disabled={pushing}
                className="mt-3 w-full py-2 text-[11px] font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition disabled:opacity-50">
                {pushing ? <Loader2 size={10} className="animate-spin" /> : <><Send size={10} /> Add {selectedNext.length} to Push Queue</>}
              </button>
            )}
          </div>

          {/* Backlog bucket */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-2xl p-4 min-h-[100px]">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-3">
              <span className="flex items-center gap-1"><Package size={10} /> Backlog ({backlogItems.length})</span>
            </p>
            {backlogItems.length === 0 && (
              <p className="text-[10px] text-gray-300 dark:text-gray-600 text-center py-4">Kosong</p>
            )}
            <div className="space-y-1.5">
              {backlogItems.map(s => (
                <div key={s.key} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-gray-100 dark:border-gray-700">
                  <p className="flex-1 text-[10px] text-gray-500 dark:text-gray-400 truncate">{s.subject}</p>
                  <button onClick={() => moveBucket(s.key, 'next')} className="text-[9px] text-gray-300 hover:text-indigo-500">↑ Next</button>
                  <button onClick={() => removeStaged(s.key)} className="text-[9px] text-gray-300 hover:text-red-400">✕</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-sm px-4 py-2 rounded-lg shadow-lg z-50">
          {toast}
        </div>
      )}

      {opTaskId && (
        <OpTaskModal wpId={opTaskId} opUrl={opUrl} onClose={() => setOpTaskId(null)} onSaved={() => loadPlan()} />
      )}
    </div>
  )
}
