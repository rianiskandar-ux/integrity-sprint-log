'use client'

import { useState } from 'react'

export interface ActivitySegment { duration: number; note: string }

export function bulletsToSegments(bullets: string[], totalMins: number): ActivitySegment[] {
  if (!bullets.length) return [{ duration: totalMins, note: '' }]
  const perSlot = Math.max(1, Math.round(totalMins / bullets.length))
  return bullets.map((note, i) => {
    const used = perSlot * i
    const d = i === bullets.length - 1 ? Math.max(1, totalMins - used) : perSlot
    return { duration: d, note }
  })
}

export function segmentsToBullets(segs: ActivitySegment[]): string[] {
  return segs.filter(s => s.note.trim()).map(s => `[${s.duration}m] ${s.note.trim()}`)
}

export default function ActivityTimeline({
  segments, onChange, totalMins, taskTitle, accentColor = 'violet',
}: {
  segments: ActivitySegment[]
  onChange: (segs: ActivitySegment[]) => void
  totalMins: number
  taskTitle?: string
  accentColor?: 'violet' | 'teal'
}) {
  const [suggesting, setSuggesting] = useState(false)

  async function suggestSegments() {
    setSuggesting(true)
    try {
      const prompt = `You are a work log assistant. Given a task title and estimated duration, suggest 3-4 realistic activity timeline segments showing how the work was likely broken up.

Task: "${taskTitle ?? 'Work session'}"
Total estimated time: ${totalMins} minutes

Reply with ONLY a JSON array, no explanation:
[{"duration": 15, "note": "..."}, {"duration": 30, "note": "..."}, ...]

Rules:
- durations must sum to exactly ${totalMins}
- notes must be in English, concise (max 10 words), action-oriented
- reflect realistic phases for this type of task`

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          taskContext: { id: 'suggest', title: taskTitle ?? '', taskType: 'new' },
        }),
      })
      if (!res.ok) return
      const reader = res.body!.getReader()
      const dec = new TextDecoder()
      let full = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        full += dec.decode(value, { stream: true })
      }
      const match = full.match(/\[[\s\S]*\]/)
      if (match) {
        const parsed = JSON.parse(match[0]) as { duration: number; note: string }[]
        if (Array.isArray(parsed) && parsed.length > 0) {
          onChange(parsed.map(s => ({ duration: Math.max(1, Number(s.duration)), note: String(s.note) })))
        }
      }
    } catch { /* ignore */ }
    setSuggesting(false)
  }

  const usedMins = segments.reduce((s, x) => s + x.duration, 0)
  const over = usedMins > totalMins
  const pct  = Math.min(100, Math.round(usedMins / Math.max(1, totalMins) * 100))

  const accent = accentColor === 'teal' ? {
    border: 'border-teal-100 dark:border-teal-800',
    ring:   'focus:ring-teal-300',
    bar:    over ? 'bg-red-400' : 'bg-teal-400',
    add:    'text-teal-500 hover:text-teal-700',
  } : {
    border: 'border-violet-100 dark:border-violet-800',
    ring:   'focus:ring-violet-300',
    bar:    over ? 'bg-red-400' : 'bg-violet-400',
    add:    'text-violet-500 hover:text-violet-700',
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Activity Timeline</label>
        <div className="flex items-center gap-2">
          <button type="button" onClick={suggestSegments} disabled={suggesting}
            className="text-[9px] font-semibold text-amber-500 hover:text-amber-700 disabled:opacity-50">
            {suggesting ? '⏳ Suggesting…' : '✨ Suggest'}
          </button>
          <button type="button"
            onClick={() => onChange([...segments, { duration: Math.max(1, totalMins - usedMins), note: '' }])}
            className={`text-[9px] font-semibold ${accent.add}`}>
            + Add segment
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-0.5">
        <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${accent.bar}`} style={{ width: `${pct}%` }} />
        </div>
        <div className={`text-[9px] font-semibold ${over ? 'text-red-500' : 'text-gray-400'}`}>
          {usedMins}m / {totalMins}m {over ? `(+${usedMins - totalMins}m over)` : `(${totalMins - usedMins}m remaining)`}
        </div>
      </div>

      {/* Segments */}
      <div className="space-y-1.5">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="text-[9px] text-gray-400 font-mono flex-shrink-0 w-4 text-right">{i + 1}.</span>
            <input
              type="number" min={1} value={seg.duration}
              onChange={e => onChange(segments.map((x, j) => j === i ? { ...x, duration: Math.max(1, Number(e.target.value)) } : x))}
              className={`w-14 text-[11px] border ${accent.border} rounded px-1.5 py-1 bg-white dark:bg-gray-900 text-center focus:outline-none focus:ring-1 ${accent.ring} text-indigo-600 font-semibold`}
            />
            <span className="text-[9px] text-gray-400 flex-shrink-0">min</span>
            <input
              value={seg.note}
              onChange={e => onChange(segments.map((x, j) => j === i ? { ...x, note: e.target.value } : x))}
              placeholder={`What was done in this ${seg.duration}m…`}
              className={`flex-1 text-[11px] border ${accent.border} rounded px-2 py-1 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 ${accent.ring}`}
            />
            <button type="button" onClick={() => onChange(segments.filter((_, j) => j !== i))}
              className="text-[10px] text-gray-300 hover:text-red-400 px-0.5 flex-shrink-0">✕</button>
          </div>
        ))}
        {segments.length === 0 && (
          <p className="text-[10px] text-gray-300 italic">No segments — click &ldquo;+ Add segment&rdquo; to log activity</p>
        )}
      </div>
    </div>
  )
}
