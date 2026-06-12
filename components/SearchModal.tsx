'use client'

import { useState, useEffect, useRef } from 'react'
import { format, parseISO } from 'date-fns'
import type { Session } from '@/lib/parser'
import { tagSessionToProject, getProjectById } from '@/lib/projects'
import { useI18n } from '@/lib/i18n'

interface Props {
  allTopics: Array<Session & { date: string }>
  onClose: () => void
  onNavigate: (p: Record<string, string>) => void
}

interface OPResult {
  id: number
  subject: string
  type: string
  status: string
  project: string
  href: string
  assignee?: string | null
  sprintName?: string | null
  islStatus?: string
  description?: string
}

export default function SearchModal({ allTopics, onClose, onNavigate }: Props) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [opResults, setOpResults] = useState<OPResult[]>([])
  const [opLoading, setOpLoading] = useState(false)
  const [opUrl, setOpUrl] = useState<string>('https://tokek.integrity-asia.com')
  const [selectedTask, setSelectedTask] = useState<OPResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    fetch('/api/op/cache').then(r => r.json()).then(d => { if (d._opUrl) setOpUrl(d._opUrl) }).catch(() => {})
  }, [])

  // Local ISL search
  const localResults = query.trim().length < 2 ? [] : allTopics.filter((topic) => {
    const q = query.toLowerCase()
    return topic.title.toLowerCase().includes(q) || topic.bullets.some((b) => b.toLowerCase().includes(q))
  }).slice(0, 6)

  // OP live search (debounced 400ms)
  useEffect(() => {
    if (query.trim().length < 2) { setOpResults([]); return }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setOpLoading(true)
      try {
        const res = await fetch(`/api/op/search?q=${encodeURIComponent(query.trim())}`)
        const d = await res.json()
        setOpResults(d.results ?? [])
      } catch { setOpResults([]) }
      finally { setOpLoading(false) }
    }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  const hasResults = localResults.length > 0 || opResults.length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4">
      <div className="absolute inset-0 bg-black/50 dark:bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden animate-[slide-up_0.2s_ease-out]">

        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <span className="text-gray-400">🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari tiket OP atau aktivitas ISL…"
            className="flex-1 text-sm bg-transparent outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400"
          />
          {opLoading && <span className="text-[10px] text-gray-400 animate-pulse">OP…</span>}
          <kbd className="text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[28rem] overflow-y-auto">
          {query.trim().length < 2 && (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              Ketik minimal 2 karakter untuk cari tiket OP atau log ISL
            </div>
          )}

          {query.trim().length >= 2 && !hasResults && !opLoading && (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              {t('search.no_results')} &ldquo;{query}&rdquo;
            </div>
          )}

          {/* OP results */}
          {opResults.length > 0 && (
            <>
              <div className="px-4 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">
                OpenProject · {opResults.length} tiket
              </div>

              {/* Task detail popup */}
              {selectedTask && (
                <div className="mx-4 my-2 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 rounded-xl p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-mono text-[11px] font-bold text-indigo-500">#{selectedTask.id}</span>
                        <span className="text-[10px] text-gray-500 bg-white dark:bg-gray-800 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700">{selectedTask.type}</span>
                        <span className="text-[10px] text-gray-500 bg-white dark:bg-gray-800 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700">{selectedTask.status}</span>
                        {selectedTask.sprintName && (
                          <span className="text-[10px] text-violet-600 bg-violet-50 dark:bg-violet-950 px-1.5 py-0.5 rounded">🗓 {selectedTask.sprintName}</span>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 leading-snug">{selectedTask.subject}</p>
                    </div>
                    <button onClick={() => setSelectedTask(null)} className="text-gray-400 hover:text-gray-600 flex-shrink-0 text-sm">✕</button>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-gray-500">
                    <div><span className="font-semibold text-gray-600 dark:text-gray-300">Project</span><br />{selectedTask.project}</div>
                    {selectedTask.assignee && <div><span className="font-semibold text-gray-600 dark:text-gray-300">Assignee</span><br />{selectedTask.assignee}</div>}
                  </div>
                  {selectedTask.description && (
                    <p className="text-[11px] text-gray-500 italic border-t border-indigo-100 dark:border-indigo-900 pt-2 line-clamp-3">{selectedTask.description}</p>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    <a href={`${opUrl}/work_packages/${selectedTask.id}`} target="_blank" rel="noopener"
                      onClick={onClose}
                      className="px-3 py-1.5 text-[10px] font-bold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition">
                      Buka di OP ↗
                    </a>
                    <button
                      onClick={() => { navigator.clipboard.writeText(`!ticket:${selectedTask.id}`); }}
                      className="px-3 py-1.5 text-[10px] font-semibold border border-indigo-200 dark:border-indigo-700 text-indigo-600 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950 transition">
                      Copy !ticket:{selectedTask.id}
                    </button>
                  </div>
                </div>
              )}

              {opResults.map((wp) => (
                <button
                  key={wp.id}
                  onClick={() => setSelectedTask(selectedTask?.id === wp.id ? null : wp)}
                  className={`w-full flex items-start gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition text-left border-b border-gray-50 dark:border-gray-800 last:border-0 ${selectedTask?.id === wp.id ? 'bg-indigo-50 dark:bg-indigo-950/30' : ''}`}
                >
                  <span className="font-mono text-[11px] text-gray-400 flex-shrink-0 mt-0.5 w-10 text-right">#{wp.id}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">{wp.subject}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] text-gray-400">{wp.project}</span>
                      <span className="text-gray-300 dark:text-gray-600">·</span>
                      <span className="text-[10px] text-gray-400">{wp.type}</span>
                      <span className="text-gray-300 dark:text-gray-600">·</span>
                      <span className="text-[10px] text-gray-400">{wp.status}</span>
                    </div>
                  </div>
                  <span className="text-[10px] text-indigo-400 flex-shrink-0 mt-0.5">{selectedTask?.id === wp.id ? '▲' : '▼'}</span>
                </button>
              ))}
            </>
          )}

          {/* ISL local results */}
          {localResults.length > 0 && (
            <>
              <div className="px-4 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">
                Log ISL · {localResults.length} aktivitas
              </div>
              {localResults.map((topic, i) => {
                const proj = getProjectById(tagSessionToProject(topic.title, topic.bullets.join(' ')))
                const matchBullet = topic.bullets.find((b) => b.toLowerCase().includes(query.toLowerCase()))
                return (
                  <button
                    key={i}
                    onClick={() => { onNavigate({ view: 'daily', date: topic.date }); onClose() }}
                    className="w-full flex items-start gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition text-left border-b border-gray-50 dark:border-gray-800 last:border-0"
                  >
                    <div
                      className="w-6 h-6 rounded-md flex items-center justify-center text-white text-xs flex-shrink-0 mt-0.5"
                      style={{ background: proj.color }}
                    >
                      {proj.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">{topic.title}</p>
                      {matchBullet && <p className="text-[11px] text-gray-400 mt-0.5 truncate">{matchBullet}</p>}
                    </div>
                    <span className="text-[10px] text-gray-400 flex-shrink-0 mt-0.5">
                      {format(parseISO(topic.date), 'dd MMM')}
                    </span>
                  </button>
                )
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-800 flex items-center gap-4 text-[10px] text-gray-400">
          <span>Klik tiket OP untuk detail · klik lagi untuk tutup</span>
          <span className="ml-auto"><kbd className="bg-gray-100 dark:bg-gray-800 px-1 rounded">ESC</kbd> tutup</span>
        </div>
      </div>
    </div>
  )
}
