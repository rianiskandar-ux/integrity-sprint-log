'use client'

import { useState, useEffect } from 'react'
import type { CachedWorkPackage } from '@/lib/op-cache'

interface Props {
  onClose: () => void
  onSaved?: () => void
}

export default function QuickLogModal({ onClose, onSaved }: Props) {
  const [title, setTitle]           = useState('')
  const [durationMins, setDuration] = useState(30)
  const [durationInput, setDurInput]= useState('30')
  const [opTaskId, setOpTaskId]     = useState<number | ''>('')
  const [note, setNote]             = useState('')
  const [date, setDate]             = useState(new Date().toISOString().slice(0, 10))
  const [tasks, setTasks]           = useState<CachedWorkPackage[]>([])
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [success, setSuccess]       = useState(false)

  useEffect(() => {
    fetch('/api/op/cache')
      .then(r => r.json())
      .then(d => {
        const open = (d.myOpenTasks ?? []) as CachedWorkPackage[]
        setTasks(open.filter(t => t.type === 'Task' || t.type === 'Bug'))
      })
      .catch(() => {})
  }, [])

  function handleDurChange(val: string) {
    setDurInput(val)
    const n = parseInt(val, 10)
    if (!isNaN(n) && n > 0) setDuration(n)
  }

  // Common presets
  const DUR_PRESETS = [15, 30, 45, 60, 90, 120]

  async function save() {
    if (!title.trim()) { setError('Title is required'); return }
    if (!durationMins || durationMins <= 0) { setError('Duration must be > 0 minutes'); return }
    setSaving(true); setError(null)

    const r = await fetch('/api/op/quick-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title.trim(),
        durationMins,
        opTaskId: opTaskId !== '' ? Number(opTaskId) : null,
        date,
        note: note.trim() || undefined,
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

  const fmtDur = (m: number) => {
    if (m < 60) return `${m}m`
    const h = Math.floor(m / 60), min = m % 60
    return min > 0 ? `${h}h ${min}m` : `${h}h`
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h2 className="text-base font-black text-gray-900 dark:text-gray-100">✍️ Quick Log</h2>
            <p className="text-[11px] text-gray-400 mt-0.5">Log non-AI work — meetings, reviews, coordination</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition text-lg leading-none">×</button>
        </div>

        <div className="px-5 py-4 space-y-4">

          {/* Title */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-1">What did you work on?</label>
            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Sprint planning meeting, Code review #123, Client call"
              className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && save()}
            />
          </div>

          {/* Duration */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-1">Duration</label>
            <div className="flex gap-2 flex-wrap mb-2">
              {DUR_PRESETS.map(p => (
                <button key={p} onClick={() => { setDuration(p); setDurInput(String(p)) }}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-full border transition ${
                    durationMins === p
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'text-gray-500 border-gray-200 dark:border-gray-700 hover:border-blue-300'
                  }`}>
                  {fmtDur(p)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={480}
                value={durationInput}
                onChange={e => handleDurChange(e.target.value)}
                className="w-24 px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-xs text-gray-400">minutes</span>
              {durationMins > 0 && <span className="text-xs font-bold text-blue-600">{fmtDur(durationMins)}</span>}
            </div>
          </div>

          {/* Date */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Link to OP task (optional) */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-1">
              Link to OP Task <span className="text-gray-300 dark:text-gray-600 normal-case font-normal">— optional</span>
            </label>
            {tasks.length > 0 ? (
              <select
                value={opTaskId}
                onChange={e => setOpTaskId(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">— No task link —</option>
                {tasks.map(t => (
                  <option key={t.id} value={t.id}>#{t.id} {t.subject.slice(0, 60)}{t.subject.length > 60 ? '…' : ''}</option>
                ))}
              </select>
            ) : (
              <input
                type="number"
                value={opTaskId}
                onChange={e => setOpTaskId(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="OP task ID (optional)"
                className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            )}
            {opTaskId !== '' && (
              <p className="text-[10px] text-blue-500 mt-1">Time entry will be posted to OP #{opTaskId}</p>
            )}
          </div>

          {/* Note (optional) */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-1">
              Note <span className="text-gray-300 dark:text-gray-600 normal-case font-normal">— optional</span>
            </label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              placeholder="Brief note about what was discussed or decided"
              className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {error && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950 px-3 py-2 rounded-lg">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex items-center gap-3">
          <button onClick={onClose}
            className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
            Cancel
          </button>
          <button onClick={save} disabled={saving || success}
            className="flex-1 px-4 py-2.5 text-sm font-bold rounded-xl text-white transition disabled:opacity-60"
            style={{ background: success ? '#059669' : 'linear-gradient(135deg, #1d3a5c, #2a5298)' }}>
            {success ? '✓ Logged!' : saving ? 'Saving…' : `Save ${fmtDur(durationMins)}`}
          </button>
        </div>
      </div>
    </div>
  )
}
