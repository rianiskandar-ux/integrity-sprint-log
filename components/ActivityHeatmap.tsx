'use client'

import { useMemo } from 'react'
import type { SprintDay } from '@/lib/parser'

interface Props {
  allDays: SprintDay[]
  onDateClick: (date: string) => void
}

export default function ActivityHeatmap({ allDays, onDateClick }: Props) {
  const sessionMap = useMemo(() => {
    const m: Record<string, number> = {}
    for (const d of allDays) m[d.date] = d.sessions.length
    return m
  }, [allDays])

  // Build 52 weeks of cells ending today
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const end = new Date(today)
  // Align to Sunday
  end.setDate(end.getDate() + (6 - end.getDay()))

  const weeks: string[][] = []
  const cur = new Date(end)
  cur.setDate(cur.getDate() - 52 * 7 + 1)
  // Align to Sunday
  cur.setDate(cur.getDate() - cur.getDay())

  while (cur <= end) {
    const week: string[] = []
    for (let d = 0; d < 7; d++) {
      week.push(cur.toISOString().slice(0, 10))
      cur.setDate(cur.getDate() + 1)
    }
    weeks.push(week)
  }

  function cellColor(date: string): string {
    const count = sessionMap[date] ?? 0
    const isToday = date === today.toISOString().slice(0, 10)
    const isFuture = date > today.toISOString().slice(0, 10)
    if (isFuture) return 'bg-transparent'
    if (count === 0) return 'bg-gray-100 dark:bg-gray-800'
    if (count === 1) return 'bg-indigo-200 dark:bg-indigo-900'
    if (count === 2) return 'bg-indigo-400 dark:bg-indigo-700'
    if (count === 3) return 'bg-indigo-500 dark:bg-indigo-600'
    return 'bg-indigo-700 dark:bg-indigo-400'
  }

  const months: { label: string; col: number }[] = []
  weeks.forEach((week, i) => {
    const d = new Date(week[0])
    if (d.getDate() <= 7) {
      months.push({ label: d.toLocaleString('en-US', { month: 'short' }), col: i })
    }
  })

  const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Activity · Last 52 Weeks</p>
        <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
          <span>Less</span>
          {['bg-gray-100 dark:bg-gray-800', 'bg-indigo-200 dark:bg-indigo-900', 'bg-indigo-400 dark:bg-indigo-700', 'bg-indigo-700 dark:bg-indigo-400'].map((c, i) => (
            <span key={i} className={`w-3 h-3 rounded-sm ${c}`} />
          ))}
          <span>More</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="relative">
          {/* Month labels */}
          <div className="flex ml-8 mb-1 gap-[3px]">
            {weeks.map((_, i) => {
              const m = months.find((m) => m.col === i)
              return (
                <div key={i} className="w-3 flex-shrink-0 text-[9px] text-gray-400 truncate">
                  {m ? m.label : ''}
                </div>
              )
            })}
          </div>

          <div className="flex gap-[3px]">
            {/* Day labels */}
            <div className="flex flex-col gap-[3px] mr-1 flex-shrink-0">
              {DAY_LABELS.map((d, i) => (
                <div key={d} className="h-3 flex items-center">
                  {i % 2 === 1 && <span className="text-[9px] text-gray-400 w-7">{d}</span>}
                  {i % 2 !== 1 && <span className="w-7" />}
                </div>
              ))}
            </div>

            {/* Grid */}
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-[3px] flex-shrink-0">
                {week.map((date) => {
                  const count = sessionMap[date] ?? 0
                  const isFuture = date > today.toISOString().slice(0, 10)
                  return (
                    <button
                      key={date}
                      onClick={() => !isFuture && onDateClick(date)}
                      title={`${date}${count ? ` · ${count} session${count > 1 ? 's' : ''}` : ''}`}
                      disabled={isFuture}
                      className={`w-3 h-3 rounded-sm transition-transform hover:scale-125 ${cellColor(date)} ${!isFuture ? 'cursor-pointer' : 'cursor-default'}`}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
