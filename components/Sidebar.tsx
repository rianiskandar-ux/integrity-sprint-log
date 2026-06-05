'use client'

import { useState, useEffect } from 'react'
import { format, startOfWeek, parseISO } from 'date-fns'
import { loadAppConfig } from '@/lib/op-config'

const NAV = [
  { id: 'daily',  label: 'Daily',  icon: '📅', key: 'D' },
  { id: 'sprint', label: 'Sprint', icon: '🏃', key: 'S' },
  { id: 'month',  label: 'Month',  icon: '📆', key: 'M' },
  { id: 'skills', label: 'Skills', icon: '🎯', key: 'L' },
]

interface Props {
  open: boolean
  view: string
  today: string
  selectedDate: string
  dates: string[]
  hasSession: (d: string) => boolean
  onNavigate: (p: Record<string, string>) => void
  onToggle: () => void
}

export default function Sidebar({ open, view, today, selectedDate, dates, hasSession, onNavigate, onToggle }: Props) {
  const [appName, setAppName] = useState('Integrity Sprint Log')
  const [appLogo, setAppLogo] = useState('🚀')
  useEffect(() => {
    const c = loadAppConfig()
    setAppName(c.appName)
    setAppLogo(c.appLogo)
  }, [])

  const weeks: Record<string, string[]> = {}
  for (const d of dates) {
    const wk = format(startOfWeek(parseISO(d), { weekStartsOn: 1 }), 'yyyy-MM-dd')
    if (!weeks[wk]) weeks[wk] = []
    weeks[wk].push(d)
  }
  const weekKeys = Object.keys(weeks).sort().reverse()
  const todayWeek = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const [openWeeks, setOpenWeeks] = useState<Record<string, boolean>>({ [todayWeek]: true })

  return (
    <aside className={`flex flex-col h-full bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 transition-all duration-200 overflow-hidden flex-shrink-0 ${open ? 'w-52' : 'w-12'}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-gray-100 dark:border-gray-800 min-h-[48px]">
        {open && (
          <span className="text-sm font-bold text-gray-800 dark:text-gray-100 tracking-tight flex items-center gap-1.5">
            <span>{appLogo}</span>
            <span className="truncate">{appName}</span>
          </span>
        )}
        <button
          onClick={onToggle}
          className="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition ml-auto"
        >
          {open ? '◀' : '▶'}
        </button>
      </div>

      {/* Nav */}
      <nav className="border-b border-gray-100 dark:border-gray-800">
        {NAV.map((tab) => {
          const active = view === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => onNavigate({ view: tab.id, ...(tab.id === 'daily' ? { date: selectedDate } : {}) })}
              title={open ? undefined : `${tab.label} (${tab.key})`}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide transition border-l-2
                ${active
                  ? 'text-indigo-600 dark:text-indigo-400 border-indigo-500 bg-indigo-50 dark:bg-indigo-950'
                  : 'text-gray-500 dark:text-gray-400 border-transparent hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
            >
              <span className="text-base leading-none flex-shrink-0">{tab.icon}</span>
              {open && (
                <span className="flex-1 text-left">{tab.label}</span>
              )}
              {open && (
                <kbd className={`text-[9px] px-1 rounded border ${active ? 'border-indigo-200 dark:border-indigo-800 text-indigo-400' : 'border-gray-200 dark:border-gray-700 text-gray-300 dark:text-gray-600'}`}>
                  {tab.key}
                </kbd>
              )}
            </button>
          )
        })}
      </nav>

      {/* Date history */}
      {open && (
        <div className="flex-1 overflow-y-auto text-xs">
          {weekKeys.map((wk) => {
            const label = wk === todayWeek ? 'This week' : `Week of ${format(parseISO(wk), 'd MMM')}`
            const isOpen = openWeeks[wk] ?? false
            return (
              <div key={wk}>
                <button
                  onClick={() => setOpenWeeks((p) => ({ ...p, [wk]: !p[wk] }))}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
                >
                  <span>{label}</span>
                  <span className={`transition-transform duration-150 ${isOpen ? '' : '-rotate-90'}`}>▾</span>
                </button>
                {isOpen && weeks[wk].map((d) => {
                  const isToday = d === today
                  const isSelected = d === selectedDate
                  const hasSess = hasSession(d)
                  return (
                    <button
                      key={d}
                      onClick={() => onNavigate({ view: 'daily', date: d })}
                      className={`w-full flex items-center gap-2 px-4 py-1.5 text-left transition
                        ${isSelected ? 'bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-semibold' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'}
                        ${isToday ? 'font-bold' : ''}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${hasSess ? 'bg-emerald-400' : 'bg-gray-200 dark:bg-gray-700'}`} />
                      <span>{format(parseISO(d), 'EEE d MMM')}</span>
                      {isToday && (
                        <span className="ml-auto text-[9px] bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-400 px-1 rounded font-bold">TODAY</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      {/* Keyboard hint at bottom */}
      {open && (
        <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-800 text-[10px] text-gray-300 dark:text-gray-700">
          j/k ← → navigate · ⌘K search
        </div>
      )}
    </aside>
  )
}
