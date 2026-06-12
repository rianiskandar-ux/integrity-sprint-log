'use client'

import { useState, useEffect } from 'react'

interface Section { worked: string[]; tasks: string[]; notes: string[] }
interface Entry {
  date: string; label: string; generated: string
  sections: Section; raw: string
}

function isEmpty(s: Section) {
  return s.worked.length === 0 && s.tasks.length === 0 && s.notes.length === 0
}

// Render a markdown-ish bullet line with basic bold/italic/link
function Line({ text }: { text: string }) {
  if (text.startsWith('### ')) return <p className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mt-3 mb-1">{text.slice(4)}</p>
  if (text.startsWith('**') && text.endsWith('**')) return <p className="text-xs font-bold text-gray-700 dark:text-gray-200">{text.slice(2, -2)}</p>
  if (text.startsWith('- **') || text.startsWith('- ')) {
    const content = text.slice(2)
    // bold task title: **title** rest
    const boldMatch = content.match(/^\*\*(.+?)\*\*(.*)$/)
    return (
      <li className="text-[11px] text-gray-600 dark:text-gray-300 leading-relaxed">
        {boldMatch
          ? <><strong className="text-gray-800 dark:text-gray-100">{boldMatch[1]}</strong>{boldMatch[2]}</>
          : content}
      </li>
    )
  }
  if (text.startsWith('  - ')) return <li className="ml-4 text-[11px] text-gray-500 dark:text-gray-400">{text.slice(4)}</li>
  return <p className="text-[11px] text-gray-600 dark:text-gray-300 leading-relaxed">{text}</p>
}

function NoteBlock({ text }: { text: string }) {
  const lines = text.split('\n')
  const header = lines[0]
  const body = lines.slice(1)
  // header format: "### Task Title — HH.MM WIB"
  const match = header.match(/^###?\s*(.+?)\s*[—–-]\s*(.+)$/)
  return (
    <div className="border border-gray-100 dark:border-gray-800 rounded-lg px-3 py-2.5 space-y-1.5">
      {match ? (
        <div className="flex items-start justify-between gap-2">
          <p className="text-[11px] font-bold text-gray-700 dark:text-gray-200 leading-snug">{match[1]}</p>
          <span className="text-[9px] text-gray-400 flex-shrink-0 mt-0.5">{match[2]}</span>
        </div>
      ) : (
        <p className="text-[11px] font-bold text-gray-700 dark:text-gray-200">{header.replace(/^#+\s*/, '')}</p>
      )}
      {body.length > 0 && (
        <ul className="space-y-0.5 list-none">
          {body.filter(l => l.trim()).map((l, i) => <Line key={i} text={l} />)}
        </ul>
      )}
    </div>
  )
}

function EntryCard({ entry, expanded, onToggle }: { entry: Entry; expanded: boolean; onToggle: () => void }) {
  const { sections } = entry
  const empty = isEmpty(sections)
  const today = new Date().toISOString().slice(0, 10)
  const isToday = entry.date === today

  return (
    <div className={`border rounded-xl overflow-hidden transition ${
      isToday
        ? 'border-violet-200 dark:border-violet-800 bg-violet-50/30 dark:bg-violet-950/10'
        : 'border-gray-100 dark:border-gray-800'
    }`}>
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50/60 dark:hover:bg-gray-800/40 transition"
      >
        <span className="text-sm flex-shrink-0">{isToday ? '📍' : '📅'}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-bold ${isToday ? 'text-violet-700 dark:text-violet-300' : 'text-gray-700 dark:text-gray-200'}`}>
              {entry.label}
            </span>
            {isToday && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900 text-violet-600 dark:text-violet-300">TODAY</span>}
          </div>
          {entry.generated && (
            <p className="text-[10px] text-gray-400 mt-0.5">⏱ {entry.generated}</p>
          )}
        </div>
        {/* Summary pills */}
        <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
          {sections.worked.length > 0 && (
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950 text-emerald-600">
              ✅ {sections.worked.filter(l => l.startsWith('- ') || l.startsWith('**')).length || sections.worked.length} task
            </span>
          )}
          {sections.notes.length > 0 && (
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950 text-blue-500">
              📝 {sections.notes.length} note
            </span>
          )}
          {empty && <span className="text-[9px] text-gray-300 dark:text-gray-600">kosong</span>}
        </div>
        <span className="text-gray-300 dark:text-gray-600 text-xs flex-shrink-0">{expanded ? '▼' : '▶'}</span>
      </button>

      {/* Body */}
      {expanded && !empty && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-100 dark:border-gray-800 pt-3">
          {/* Worked today */}
          {sections.worked.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide mb-2">✅ Dikerjakan</p>
              <ul className="space-y-0.5 list-none">
                {sections.worked.map((l, i) => <Line key={i} text={l} />)}
              </ul>
            </div>
          )}

          {/* Open tasks */}
          {sections.tasks.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wide mb-2">📋 Open Tasks</p>
              <ul className="space-y-0.5 list-none">
                {sections.tasks.map((l, i) => <Line key={i} text={l} />)}
              </ul>
            </div>
          )}

          {/* Technical notes */}
          {sections.notes.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wide mb-2">🛠 Technical Notes</p>
              <div className="space-y-2">
                {sections.notes.map((note, i) => <NoteBlock key={i} text={note} />)}
              </div>
            </div>
          )}
        </div>
      )}

      {expanded && empty && (
        <div className="px-4 pb-4 pt-3 border-t border-gray-100 dark:border-gray-800">
          <p className="text-xs text-gray-400 text-center py-4">Tidak ada aktivitas tercatat hari ini.</p>
        </div>
      )}
    </div>
  )
}

export default function DailyLogView() {
  const [entries, setEntries]     = useState<Entry[]>([])
  const [loading, setLoading]     = useState(true)
  const [expanded, setExpanded]   = useState<Set<string>>(new Set())
  const [showAll, setShowAll]     = useState(false)
  const [total, setTotal]         = useState(0)

  useEffect(() => {
    load()
  }, [showAll])

  async function load() {
    setLoading(true)
    try {
      const r = await fetch(`/api/daily-log?limit=${showAll ? 60 : 14}`).then(r => r.json())
      setEntries(r.entries ?? [])
      setTotal(r.total ?? 0)
      // Auto-expand today and yesterday
      const today = new Date().toISOString().slice(0, 10)
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
      setExpanded(new Set([today, yesterday]))
    } catch {}
    setLoading(false)
  }

  function toggleEntry(date: string) {
    setExpanded(prev => {
      const s = new Set(prev)
      s.has(date) ? s.delete(date) : s.add(date)
      return s
    })
  }

  // Weekly grouping
  function getWeekKey(date: string) {
    const d = new Date(date + 'T12:00:00')
    const day = d.getDay()
    const monday = new Date(d)
    monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
    return monday.toISOString().slice(0, 10)
  }

  const weekGroups = new Map<string, Entry[]>()
  for (const e of entries) {
    const wk = getWeekKey(e.date)
    if (!weekGroups.has(wk)) weekGroups.set(wk, [])
    weekGroups.get(wk)!.push(e)
  }

  function weekLabel(mondayDate: string) {
    const d = new Date(mondayDate + 'T12:00:00')
    const end = new Date(d); end.setDate(d.getDate() + 4)
    const fmt = (x: Date) => x.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
    return `${fmt(d)} – ${fmt(end)}`
  }

  if (loading) return (
    <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Memuat daily log…</div>
  )

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">📓 Daily Log</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Auto-generated wrap-up harian · {total} hari tercatat
          </p>
        </div>
        <button onClick={load}
          className="text-[10px] text-gray-400 hover:text-gray-600 transition border border-gray-200 dark:border-gray-700 px-2.5 py-1.5 rounded-lg flex-shrink-0">
          ↻ Refresh
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="text-center text-gray-400 py-16 space-y-2">
          <p className="text-2xl">📭</p>
          <p className="text-sm">Belum ada daily log.</p>
          <p className="text-xs text-gray-300 dark:text-gray-600">
            Log dibuat otomatis via Stop hook setiap kamu selesai sesi kerja.
          </p>
        </div>
      ) : (
        <>
          {Array.from(weekGroups.entries()).map(([weekStart, weekEntries]) => (
            <div key={weekStart} className="space-y-2">
              {/* Week header */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                  📅 {weekLabel(weekStart)}
                </span>
                <div className="flex-1 h-px bg-gray-100 dark:bg-gray-800" />
                <span className="text-[9px] text-gray-300 dark:text-gray-600">
                  {weekEntries.reduce((n, e) => n + (isEmpty(e.sections) ? 0 : 1), 0)}/{weekEntries.length} hari aktif
                </span>
              </div>
              {weekEntries.map(entry => (
                <EntryCard
                  key={entry.date}
                  entry={entry}
                  expanded={expanded.has(entry.date)}
                  onToggle={() => toggleEntry(entry.date)}
                />
              ))}
            </div>
          ))}

          {!showAll && total > 14 && (
            <button
              onClick={() => setShowAll(true)}
              className="w-full py-2.5 text-[11px] font-semibold text-indigo-500 border border-dashed border-indigo-200 dark:border-indigo-800 rounded-xl hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition">
              Tampilkan semua {total} hari →
            </button>
          )}
        </>
      )}
    </div>
  )
}
