'use client'

import { useState, useEffect } from 'react'
import type { CachedWorkPackage } from '@/lib/op-cache'
import ActivityTimeline, { ActivitySegment, bulletsToSegments, segmentsToBullets } from './ActivityTimeline'

interface Props {
  onClose: () => void
  onSaved?: () => void
}

export default function QuickLogModal({ onClose, onSaved }: Props) {
  const [title, setTitle]         = useState('')
  const [durationMins, setDuration] = useState(30)
  const [durationInput, setDurInput] = useState('30')
  const [opTaskId, setOpTaskId]   = useState<number | ''>('')
  const [date, setDate]           = useState(new Date().toISOString().slice(0, 10))
  const [tasks, setTasks]         = useState<CachedWorkPackage[]>([])
  const [segments, setSegments]   = useState<ActivitySegment[]>([{ duration: 30, note: '' }])
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [success, setSuccess]     = useState(false)

  useEffect(() => {
    fetch('/api/op/cache')
      .then(r => r.json())
      .then(d => {
        const open = (d.myOpenTasks ?? []) as CachedWorkPackage[]
        setTasks(open.filter(t => t.type === 'Task' || t.type === 'Bug'))
      })
      .catch(() => {})
  }, [])

  // Sync segments total when duration changes
  useEffect(() => {
    setSegments(prev => {
      if (prev.length === 1 && !prev[0].note.trim()) return [{ duration: durationMins, note: '' }]
      return prev
    })
  }, [durationMins])

  function handleDurChange(val: string) {
    setDurInput(val)
    const n = parseInt(val, 10)
    if (!isNaN(n) && n > 0) setDuration(n)
  }

  const DUR_PRESETS = [15, 30, 45, 60, 90, 120]

  const fmtDur = (m: number) => {
    if (m < 60) return `${m}m`
    const h = Math.floor(m / 60), min = m % 60
    return min > 0 ? `${h}h ${min}m` : `${h}h`
  }

  async function save() {
    if (!title.trim()) { setError('Title is required'); return }
    if (!durationMins || durationMins <= 0) { setError('Duration must be > 0 minutes'); return }
    setSaving(true); setError(null)

    const bullets = segmentsToBullets(segments)

    const r = await fetch('/api/op/quick-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title.trim(),
        durationMins,
        opTaskId: opTaskId !== '' ? Number(opTaskId) : null,
        date,
        note: bullets.length > 0 ? bullets.join('\n') : undefined,
      }),
    }).then(r => r.json()).catch(() => ({ ok: false, error: 'Network error' }))

    setSaving(false)
    if (r.ok) {
      setSuccess(true)
      window.dispatchEvent(new Event('isl:session-updated'))
      setTimeout(() => { onSaved?.(); onClose() }, 900)
    } else {
      setError(r.error ?? 'Failed to save')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h2 className="text-base font-black text-gray-900 dark:text-gray-100">✍️ Quick Log</h2>
            <p className="text-[11px] text-gray-400 mt-0.5">Log non-AI work — meetings, reviews, coordination</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition text-lg leading-none">×</button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto max-h-[72vh]">

          {/* Subject */}
          <div>
            <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Subject</label>
            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Sprint planning meeting, Code review #123, Client call"
              className="mt-1 w-full text-[12px] border border-violet-200 dark:border-violet-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && save()}
            />
          </div>

          {/* Activity Timeline */}
          <ActivityTimeline
            segments={segments}
            onChange={setSegments}
            totalMins={durationMins}
            taskTitle={title}
            accentColor="violet"
          />

          {/* Duration presets */}
          <div>
            <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Total Duration</label>
            <div className="flex gap-2 flex-wrap mt-1 mb-2">
              {DUR_PRESETS.map(p => (
                <button key={p} onClick={() => { setDuration(p); setDurInput(String(p)) }}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-full border transition ${
                    durationMins === p
                      ? 'bg-violet-600 text-white border-violet-600'
                      : 'text-gray-500 border-gray-200 dark:border-gray-700 hover:border-violet-300'
                  }`}>
                  {fmtDur(p)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number" min={1} max={480} value={durationInput}
                onChange={e => handleDurChange(e.target.value)}
                className="w-24 px-3 py-1.5 text-[11px] rounded-lg border border-violet-200 dark:border-violet-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-violet-400"
              />
              <span className="text-xs text-gray-400">minutes</span>
              {durationMins > 0 && <span className="text-xs font-bold text-violet-600">{fmtDur(durationMins)}</span>}
            </div>
          </div>

          {/* Date + OP Task row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Date</label>
              <input
                type="date" value={date} onChange={e => setDate(e.target.value)}
                className="mt-1 w-full px-3 py-1.5 text-[11px] rounded-lg border border-violet-200 dark:border-violet-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-violet-400"
              />
            </div>
            <div>
              <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">OP Task <span className="text-gray-300 font-normal normal-case">optional</span></label>
              {tasks.length > 0 ? (
                <select
                  value={opTaskId}
                  onChange={e => setOpTaskId(e.target.value === '' ? '' : Number(e.target.value))}
                  className="mt-1 w-full px-3 py-1.5 text-[11px] rounded-lg border border-violet-200 dark:border-violet-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-violet-400">
                  <option value="">— No task —</option>
                  {tasks.map(t => (
                    <option key={t.id} value={t.id}>#{t.id} {t.subject.slice(0, 40)}{t.subject.length > 40 ? '…' : ''}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="number" value={opTaskId}
                  onChange={e => setOpTaskId(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="Task ID"
                  className="mt-1 w-full px-3 py-1.5 text-[11px] rounded-lg border border-violet-200 dark:border-violet-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
                />
              )}
              {opTaskId !== '' && (
                <p className="text-[10px] text-violet-500 mt-0.5">Time entry → OP #{opTaskId}</p>
              )}
            </div>
          </div>

          {error && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950 px-3 py-2 rounded-lg">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center gap-3">
          <button onClick={onClose}
            className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
            Cancel
          </button>
          <button onClick={save} disabled={saving || success}
            className="flex-1 px-4 py-2.5 text-sm font-bold rounded-xl text-white transition disabled:opacity-60"
            style={{ background: success ? '#059669' : 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
            {success ? '✓ Logged!' : saving ? 'Saving…' : `✚ Save ${fmtDur(durationMins)}`}
          </button>
        </div>
      </div>
    </div>
  )
}
