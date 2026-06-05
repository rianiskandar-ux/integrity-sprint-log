'use client'

import { useState, useEffect, useRef } from 'react'
import { format, parseISO } from 'date-fns'
import type { Session } from '@/lib/parser'
import { tagSessionToProject, getProjectById } from '@/lib/projects'

interface Props {
  allTopics: Array<Session & { date: string }>
  onClose: () => void
  onNavigate: (p: Record<string, string>) => void
}

export default function SearchModal({ allTopics, onClose, onNavigate }: Props) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const results = query.trim().length < 2 ? [] : allTopics.filter((t) => {
    const q = query.toLowerCase()
    return (
      t.title.toLowerCase().includes(q) ||
      t.bullets.some((b) => b.toLowerCase().includes(q))
    )
  }).slice(0, 12)

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
            placeholder="Search sessions, topics, keywords…"
            className="flex-1 text-sm bg-transparent outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400"
          />
          <kbd className="text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {query.trim().length < 2 && (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              Ketik minimal 2 karakter untuk search
            </div>
          )}
          {query.trim().length >= 2 && results.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              Tidak ada hasil untuk &ldquo;{query}&rdquo;
            </div>
          )}
          {results.map((t, i) => {
            const proj = getProjectById(tagSessionToProject(t.title, t.bullets.join(' ')))
            const matchBullet = t.bullets.find((b) => b.toLowerCase().includes(query.toLowerCase()))
            return (
              <button
                key={i}
                onClick={() => { onNavigate({ view: 'daily', date: t.date }); onClose() }}
                className="w-full flex items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition text-left border-b border-gray-50 dark:border-gray-800 last:border-0"
              >
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-sm flex-shrink-0 mt-0.5"
                  style={{ background: proj.color }}
                >
                  {proj.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">{t.title}</p>
                  {matchBullet && (
                    <p className="text-[11px] text-gray-400 mt-0.5 truncate">{matchBullet}</p>
                  )}
                </div>
                <span className="text-[10px] text-gray-400 flex-shrink-0 mt-0.5">
                  {format(parseISO(t.date), 'dd MMM')}
                </span>
              </button>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-800 flex items-center gap-4 text-[10px] text-gray-400">
          <span><kbd className="bg-gray-100 dark:bg-gray-800 px-1 rounded">↵</kbd> open</span>
          <span><kbd className="bg-gray-100 dark:bg-gray-800 px-1 rounded">ESC</kbd> close</span>
          <span className="ml-auto">{results.length > 0 ? `${results.length} results` : ''}</span>
        </div>
      </div>
    </div>
  )
}
