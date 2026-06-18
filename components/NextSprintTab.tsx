'use client'

import { useState, useEffect } from 'react'

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

  const storageKey = `next-sprint-staged-${currentSprintNo}`

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
    } catch { /* ignore */ }
    setLoading(false)
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
    const key = `ai-${idx}-${t.subject.slice(0, 20)}`
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
    showToast(`✅ ${ok}/${toPush.length} tasks added to Push Queue`)
    setSelected(new Set())
    window.dispatchEvent(new Event('isl:cache-refreshed'))
  }

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3500) }

  const nextItems    = staged.filter(s => s.bucket === 'next')
  const backlogItems = staged.filter(s => s.bucket === 'backlog')
  const selectedNext = nextItems.filter(s => selected.has(s.key))

  const isCarryStaged = (id: number) => staged.find(s => s.key === `carry-${id}`)
  const isAIStaged    = (idx: number, t: SuggestedTask) => staged.find(s => s.key === `ai-${idx}-${t.subject.slice(0, 20)}`)

  if (loading) return <div className="py-12 text-center text-gray-400 text-sm">Loading sprint data…</div>

  return (
    <div className="space-y-6 pb-10">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">🗂 Next Sprint Staging</h3>
          <p className="text-xs text-gray-400 mt-0.5">Sortir carry-over + AI suggestions → pilih yang masuk Next Sprint atau Backlog → Push ke Queue</p>
        </div>
        <button onClick={generateAI} disabled={generating}
          className="text-[10px] font-semibold px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition disabled:opacity-50">
          {generating ? '⏳ Generating…' : '✨ Load AI Suggestions'}
        </button>
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
                ✅ Next Sprint ({nextItems.length})
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
                    <p className="text-[9px] text-gray-400">{s.projectHint} · {Math.round(s.estimatedHours)}h · <span className="text-amber-500">{s.source === 'ai' ? '✨ AI' : '🔄 carry-over'}</span></p>
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
                {pushing ? '⏳ Pushing…' : `📤 Add ${selectedNext.length} to Push Queue`}
              </button>
            )}
          </div>

          {/* Backlog bucket */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-2xl p-4 min-h-[100px]">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-3">
              📦 Backlog ({backlogItems.length})
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
    </div>
  )
}
