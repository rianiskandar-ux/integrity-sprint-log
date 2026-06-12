'use client'

import { useState, useEffect } from 'react'
import { format, startOfWeek, parseISO } from 'date-fns'
import { loadAppConfig } from '@/lib/op-config'
import { useI18n } from '@/lib/i18n'

const VIEW_ITEMS = [
  { id: 'daily',  key: 'nav.daily'  as const, icon: '📅', shortcut: 'D' },
  { id: 'sprint', key: 'nav.sprint' as const, icon: '🏃', shortcut: 'S' },
  { id: 'month',  key: 'nav.month'  as const, icon: '📆', shortcut: 'M' },
  { id: 'skills', key: 'nav.skills' as const, icon: '🎯', shortcut: 'L' },
]

const ISL_ITEMS = [
  { id: 'incoming',  key: 'nav.incoming'  as const, icon: '📥', shortcut: 'I', color: 'text-blue-500'   },
  { id: 'pushqueue', key: 'nav.pushqueue' as const, icon: '📤', shortcut: 'Q', color: 'text-amber-500'  },
  { id: 'autolog',   key: 'nav.autolog'   as const, icon: '🤖', shortcut: 'A', color: 'text-emerald-500' },
  { id: 'dailylog',  key: 'nav.dailylog'  as const, icon: '📓', shortcut: 'G', color: 'text-violet-500'  },
  { id: 'backlog',   key: 'nav.backlog'   as const, icon: '🗃', shortcut: 'B', color: 'text-orange-500'  },
]

const ISL_VIEWS = new Set(['isldash', 'incoming', 'pushqueue', 'autolog', 'dailylog', 'backlog'])

interface Props {
  open: boolean
  view: string
  today: string
  selectedDate: string
  dates: string[]
  hasSession: (d: string) => boolean
  onNavigate: (p: Record<string, string>) => void
  onToggle: () => void
  onFeedback?: () => void
}

export default function Sidebar({ open, view, today, selectedDate, dates, hasSession, onNavigate, onToggle, onFeedback }: Props) {
  const { t } = useI18n()
  const [appName, setAppName] = useState('Integrity Sprint Log')
  const [appLogo, setAppLogo] = useState('🚀')
  const [incomingCount, setIncomingCount] = useState(0)
  const [queueCount, setQueueCount]       = useState(0)

  useEffect(() => {
    const c = loadAppConfig()
    setAppName(c.appName)
    setAppLogo(c.appLogo)
  }, [])

  useEffect(() => {
    function fetchCounts() {
      fetch('/api/op/cache').then(r => r.json()).then(d => {
        setIncomingCount((d.incomingTasks ?? []).filter((t: { islStatus?: string }) => t.islStatus !== 'done' && t.islStatus !== 'rejected').length)
      }).catch(() => {})
      fetch('/api/isl/sessions?status=pending').then(r => r.json()).then(d => {
        setQueueCount(d.total ?? 0)
      }).catch(() => {})
    }
    fetchCounts()
    window.addEventListener('isl:cache-refreshed', fetchCounts)
    window.addEventListener('isl:session-updated', fetchCounts)
    return () => {
      window.removeEventListener('isl:cache-refreshed', fetchCounts)
      window.removeEventListener('isl:session-updated', fetchCounts)
    }
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

  const isISLActive = ISL_VIEWS.has(view)

  const badge: Record<string, number> = { incoming: incomingCount, pushqueue: queueCount }

  return (
    <aside
      style={{ background: '#1d3a5c' }}
      className={`flex flex-col h-full transition-all duration-200 overflow-hidden flex-shrink-0 ${open ? 'w-52' : 'w-12'}`}>

      {/* Logo */}
      <div className="flex items-center justify-between px-3 py-3 min-h-[48px]" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        {open && (
          <span className="text-sm font-bold text-white tracking-tight flex items-center gap-1.5">
            <span>{appLogo}</span>
            <span className="truncate">{appName}</span>
          </span>
        )}
        <button onClick={onToggle}
          className="p-1 rounded text-blue-200/50 hover:text-white hover:bg-white/10 transition ml-auto">
          {open ? '◀' : '▶'}
        </button>
      </div>

      <nav style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>

        {/* VIEW section */}
        {open && (
          <div className="px-3 pt-3 pb-1 text-[9px] font-bold uppercase tracking-widest text-blue-200/40">
            View
          </div>
        )}
        {VIEW_ITEMS.map(tab => {
          const active = view === tab.id
          const label  = t(tab.key)
          return (
            <button key={tab.id}
              onClick={() => onNavigate({ view: tab.id, ...(tab.id === 'daily' ? { date: selectedDate } : {}) })}
              title={open ? undefined : `${label} (${tab.shortcut})`}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold uppercase tracking-wide transition border-l-2
                ${active
                  ? 'text-white border-white bg-white/15'
                  : 'text-blue-100/70 border-transparent hover:bg-white/10 hover:text-white'
                }`}>
              <span className="text-base leading-none flex-shrink-0">{tab.icon}</span>
              {open && <span className="flex-1 text-left">{label}</span>}
              {open && (
                <kbd className={`text-[9px] px-1 rounded border ${active ? 'border-white/30 text-white/60' : 'border-white/10 text-white/20'}`}>
                  {tab.shortcut}
                </kbd>
              )}
            </button>
          )
        })}

        {/* ISL section — label is the dashboard entry */}
        <div className="mt-1">
          <button
            onClick={() => onNavigate({ view: 'isldash' })}
            title={open ? undefined : 'ISL Dashboard (H)'}
            className={`w-full flex items-center gap-2.5 px-3 py-2 transition border-l-2
              ${view === 'isldash'
                ? 'border-violet-400 bg-white/15'
                : isISLActive
                  ? 'border-violet-400/40 hover:bg-white/10'
                  : 'border-transparent hover:bg-white/10'
              }`}>
            {open ? (
              <>
                <span className="text-base leading-none flex-shrink-0">🏠</span>
                <span className={`text-xs font-semibold uppercase tracking-wide flex-1 text-left ${
                  view === 'isldash' ? 'text-white' : isISLActive ? 'text-violet-300' : 'text-blue-100/70'
                }`}>
                  Dashboard
                </span>
                <kbd className={`text-[9px] px-1 rounded border ${
                  view === 'isldash'
                    ? 'border-violet-400/40 text-violet-300'
                    : 'border-white/10 text-white/20'
                }`}>H</kbd>
              </>
            ) : (
              <span className="text-base leading-none mx-auto">🏠</span>
            )}
          </button>

          {/* ISL sub-items */}
          {ISL_ITEMS.map(tab => {
            const active = view === tab.id
            const label  = t(tab.key)
            const count  = badge[tab.id] ?? 0
            return (
              <button key={tab.id}
                onClick={() => onNavigate({ view: tab.id })}
                title={open ? undefined : `${label} (${tab.shortcut})`}
                className={`w-full flex items-center gap-2 transition border-l-2
                  ${open ? 'pl-6 pr-3 py-1.5' : 'px-3 py-2'}
                  ${active
                    ? `${tab.color} border-current bg-white/15`
                    : 'text-blue-100/70 border-transparent hover:bg-white/10 hover:text-white'
                  }`}>
                <span className={`text-sm leading-none flex-shrink-0 relative ${active ? tab.color : ''}`}>
                  {tab.icon}
                  {!open && count > 0 && (
                    <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-amber-400 text-white text-[8px] font-bold rounded-full flex items-center justify-center leading-none">
                      {count > 9 ? '9+' : count}
                    </span>
                  )}
                </span>
                {open && (
                  <>
                    <span className={`flex-1 text-left text-[11px] font-semibold uppercase tracking-wide ${active ? tab.color : ''}`}>
                      {label}
                    </span>
                    {count > 0 && (
                      <span className="flex-shrink-0 text-[9px] font-bold bg-amber-400 text-white px-1.5 py-0.5 rounded-full leading-none">
                        {count}
                      </span>
                    )}
                    <kbd className={`text-[9px] px-1 rounded border flex-shrink-0 ${
                      active ? 'border-current opacity-50' : 'border-white/10 text-white/20'
                    }`}>
                      {tab.shortcut}
                    </kbd>
                  </>
                )}
              </button>
            )
          })}
        </div>
      </nav>

      {/* Date history */}
      {open && (
        <div className="flex-1 overflow-y-auto text-xs">
          {weekKeys.map((wk) => {
            const label  = wk === todayWeek ? 'This week' : `Week of ${format(parseISO(wk), 'd MMM')}`
            const isOpen = openWeeks[wk] ?? false
            return (
              <div key={wk}>
                <button
                  onClick={() => setOpenWeeks(p => ({ ...p, [wk]: !p[wk] }))}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-blue-200/40 hover:bg-white/10 hover:text-blue-200/70 transition">
                  <span>{label}</span>
                  <span className={`transition-transform duration-150 ${isOpen ? '' : '-rotate-90'}`}>▾</span>
                </button>
                {isOpen && weeks[wk].map(d => {
                  const isToday    = d === today
                  const isSelected = d === selectedDate
                  return (
                    <button key={d}
                      onClick={() => onNavigate({ view: 'daily', date: d })}
                      className={`w-full flex items-center gap-2 px-4 py-1.5 text-left transition
                        ${isSelected ? 'bg-white/15 text-white font-semibold' : 'text-blue-100/60 hover:bg-white/10 hover:text-white'}
                        ${isToday ? 'font-bold' : ''}`}>
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${hasSession(d) ? 'bg-emerald-400' : 'bg-white/20'}`} />
                      <span>{format(parseISO(d), 'EEE d MMM')}</span>
                      {isToday && (
                        <span className="ml-auto text-[9px] bg-white/20 text-white px-1 rounded font-bold">TODAY</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      <div className={`${open ? 'px-3 py-2' : 'px-2 py-2'} space-y-0.5`} style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <a
          href="/settings"
          title="Settings"
          className="flex items-center gap-2 text-blue-100/50 hover:text-white transition rounded px-1 py-1 hover:bg-white/10"
        >
          <span className="text-sm">⚙️</span>
          {open && <span className="text-[10px]">Settings</span>}
        </a>
        {onFeedback && (
          <button
            onClick={onFeedback}
            title="Give Feedback"
            className="w-full flex items-center gap-2 text-blue-100/50 hover:text-white transition rounded px-1 py-1 hover:bg-white/10"
          >
            <span className="text-sm">💬</span>
            {open && <span className="text-[10px]">Feedback</span>}
          </button>
        )}
      </div>

      {open && (
        <div className="px-3 py-2 text-[10px] text-blue-200/25">
          j/k ← → navigate · ⌘K search
        </div>
      )}
    </aside>
  )
}
