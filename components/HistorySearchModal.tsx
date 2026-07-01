'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

interface SearchResult {
  type: 'session' | 'kb' | 'task_memory' | 'daily_log'
  id: string
  title: string
  snippet: string
  date: string
  rank: number
  meta?: Record<string, unknown>
}

const TYPE_LABEL: Record<string, string> = {
  session:     'Session',
  kb:          'KB',
  task_memory: 'Task',
  daily_log:   'Daily Log',
}
const TYPE_COLOR: Record<string, string> = {
  session:     'bg-blue-100 text-blue-700',
  kb:          'bg-purple-100 text-purple-700',
  task_memory: 'bg-green-100 text-green-700',
  daily_log:   'bg-orange-100 text-orange-700',
}

export default function HistorySearchModal({ onClose }: { onClose: () => void }) {
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setResults([]); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/isl/search?q=${encodeURIComponent(q)}&limit=12`)
      const data = await res.json()
      setResults(data.results ?? [])
    } catch { setResults([]) }
    finally { setLoading(false) }
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value
    setQuery(q)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => search(q), 300)
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
          <span className="text-gray-400 text-lg">🗂</span>
          <input
            ref={inputRef}
            value={query}
            onChange={handleChange}
            placeholder="Cari sessions, KB, task history…"
            className="flex-1 text-sm text-gray-800 placeholder-gray-400 outline-none"
          />
          {loading && <span className="text-xs text-gray-400 animate-pulse">searching…</span>}
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xs">ESC</button>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {results.length === 0 && query.trim().length >= 2 && !loading && (
            <p className="text-center text-sm text-gray-400 py-8">Tidak ada hasil untuk &ldquo;{query}&rdquo;</p>
          )}
          {results.length === 0 && query.trim().length < 2 && (
            <p className="text-center text-sm text-gray-400 py-8">Ketik minimal 2 karakter — cari di sessions, KB, task history</p>
          )}
          {results.map((r) => (
            <div key={r.id} className="px-4 py-3 hover:bg-gray-50 border-b border-gray-50 last:border-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${TYPE_COLOR[r.type] ?? 'bg-gray-100 text-gray-600'}`}>
                  {TYPE_LABEL[r.type] ?? r.type}
                </span>
                {r.meta?.opTaskId != null && (
                  <span className="text-[10px] text-gray-400">#{r.meta.opTaskId as number}</span>
                )}
                <span className="text-[10px] text-gray-400 ml-auto">{r.date}</span>
              </div>
              <p className="text-sm font-medium text-gray-800 leading-tight">{r.title}</p>
              {r.snippet && (
                <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{r.snippet}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
