'use client'

import { useState, useEffect } from 'react'
import { format, startOfWeek, parseISO } from 'date-fns'
import { loadAppConfig } from '@/lib/op-config'
import { useI18n } from '@/lib/i18n'
import {
  Activity, CalendarDays, Target, LayoutDashboard,
  MessageSquarePlus, Brain, Inbox, Send, Mail,
  ClipboardList, Bot, BookOpen, Archive,
  Settings, Lock, MessageCircle, BarChart3,
  ChevronLeft, ChevronRight, ChevronDown,
} from 'lucide-react'

// Launcher Admin Console — PIN-gated terminal + Quick Fix, lives in the
// separate launcher-dashboard app (localhost:9000 / launcher.test via nginx).
// Opened in a new tab (not embedded — cross-origin WS from an iframe is
// fragile) with a quick reachability probe so it still works on machines
// where the launcher.test nginx vhost/DNS isn't set up.
function openAdminConsole() {
  const primary = 'http://launcher.test/admin'
  const fallback = 'http://localhost:9000/admin'
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 800)
  fetch(primary, { mode: 'no-cors', signal: controller.signal })
    .then(() => window.open(primary, '_blank', 'noopener'))
    .catch(() => window.open(fallback, '_blank', 'noopener'))
    .finally(() => clearTimeout(timeout))
}

const ISL_VIEWS = new Set(['isldash', 'chats', 'dailyhub', 'incoming', 'inquiries', 'pushqueue', 'scorecard', 'autolog', 'dailylog', 'backlog'])
const LOG_VIEWS = new Set(['autolog', 'dailylog', 'backlog'])

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
  const [logExpanded, setLogExpanded]     = useState(() => LOG_VIEWS.has(view))

  useEffect(() => {
    const c = loadAppConfig()
    setAppName(c.appName)
    setAppLogo(c.appLogo)
  }, [])

  useEffect(() => {
    if (LOG_VIEWS.has(view)) setLogExpanded(true)
  }, [view])

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
  const isLogActive = LOG_VIEWS.has(view)

  function NavItem({
    id, icon, label, shortcut, color, badge, indent = 0,
  }: {
    id: string; icon: React.ReactNode; label: string; shortcut: string
    color?: string; badge?: number; indent?: number
  }) {
    const active = view === id
    const indentCls = indent === 1 ? (open ? 'pl-6 pr-3' : 'px-3') : indent === 2 ? (open ? 'pl-9 pr-3' : 'px-3') : (open ? 'px-3' : 'px-3')
    return (
      <button
        onClick={() => onNavigate({ view: id })}
        title={open ? undefined : `${label} (${shortcut})`}
        className={`w-full flex items-center gap-2 py-1.5 transition border-l-2
          ${indentCls}
          ${active
            ? `${color ?? 'text-white'} border-current bg-white/15`
            : 'text-blue-100/70 border-transparent hover:bg-white/10 hover:text-white'
          }`}>
        <span className={`flex-shrink-0 relative ${active && color ? color : ''}`}>
          {icon}
          {!open && badge && badge > 0 ? (
            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-amber-400 text-white text-[8px] font-bold rounded-full flex items-center justify-center leading-none">
              {badge > 9 ? '9+' : badge}
            </span>
          ) : null}
        </span>
        {open && (
          <>
            <span className={`flex-1 text-left text-[11px] font-semibold uppercase tracking-wide ${active && color ? color : ''}`}>
              {label}
            </span>
            {badge && badge > 0 ? (
              <span className="flex-shrink-0 text-[9px] font-bold bg-amber-400 text-white px-1.5 py-0.5 rounded-full leading-none">
                {badge}
              </span>
            ) : null}
            <kbd className={`text-[9px] px-1 rounded border flex-shrink-0 ${
              active ? 'border-current opacity-50' : 'border-white/10 text-white/20'
            }`}>{shortcut}</kbd>
          </>
        )}
      </button>
    )
  }

  function GroupHeader({ label, active }: { label: string; active?: boolean }) {
    if (!open) return null
    return (
      <div className={`px-3 pt-3 pb-0.5 text-[9px] font-bold uppercase tracking-widest ${
        active ? 'text-blue-200/70' : 'text-blue-200/30'
      }`}>
        {label}
      </div>
    )
  }

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
          {open ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>

      <nav className="overflow-y-auto flex-1" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>

        {/* ── SPRINT group ── */}
        <GroupHeader label="Sprint" active={['sprint', 'month', 'skills'].includes(view)} />
        <NavItem id="sprint" icon={<Activity size={14} />}     label={t('nav.sprint')}  shortcut="S" />
        <NavItem id="month"  icon={<CalendarDays size={14} />} label={t('nav.month')}   shortcut="M" indent={1} />
        <NavItem id="skills" icon={<Target size={14} />}       label={t('nav.skills')}  shortcut="L" indent={1} />

        {/* ── DASHBOARD group ── */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }} className="mt-1">
          <GroupHeader label="Dashboard" active={isISLActive} />

          {/* Dashboard header button */}
          <button
            onClick={() => onNavigate({ view: 'isldash' })}
            title={open ? undefined : 'Dashboard (H)'}
            className={`w-full flex items-center gap-2.5 px-3 py-2 transition border-l-2
              ${view === 'isldash'
                ? 'border-violet-400 bg-white/15 text-white'
                : isISLActive
                  ? 'border-violet-400/30 text-blue-100/70 hover:bg-white/10 hover:text-white'
                  : 'border-transparent text-blue-100/70 hover:bg-white/10 hover:text-white'
              }`}>
            {open ? (
              <>
                <span className="flex-shrink-0"><LayoutDashboard size={14} /></span>
                <span className={`text-xs font-semibold uppercase tracking-wide flex-1 text-left ${
                  view === 'isldash' ? 'text-white' : isISLActive ? 'text-violet-300' : ''
                }`}>Dashboard</span>
                <kbd className={`text-[9px] px-1 rounded border ${
                  view === 'isldash' ? 'border-violet-400/40 text-violet-300' : 'border-white/10 text-white/20'
                }`}>H</kbd>
              </>
            ) : (
              <span className="mx-auto"><LayoutDashboard size={14} /></span>
            )}
          </button>

          {/* Sub-items */}
          <NavItem id="chats"     icon={<MessageSquarePlus size={14} />} label="Create new"         shortcut="C" color="text-sky-400"     indent={1} />
          <NavItem id="dailyhub"  icon={<Brain size={14} />}            label={t('nav.dailyhub')}  shortcut="H" color="text-indigo-400" indent={1} />
          <NavItem id="incoming"  icon={<Inbox size={14} />}            label={t('nav.incoming')}  shortcut="I" color="text-blue-400"   indent={1} badge={incomingCount} />
          <NavItem id="inquiries" icon={<Mail size={14} />}             label={t('nav.inquiries')} shortcut="U" color="text-sky-400"    indent={1} />
          <NavItem id="pushqueue" icon={<Send size={14} />}             label={t('nav.pushqueue')} shortcut="Q" color="text-amber-400"  indent={1} badge={queueCount} />
          <NavItem id="scorecard" icon={<BarChart3 size={14} />}        label="Scorecard"          shortcut="R" color="text-cyan-400"   indent={1} />

          {/* Log expandable group */}
          <div>
            <button
              onClick={() => {
                if (!isLogActive) {
                  setLogExpanded(v => !v)
                  if (!logExpanded) onNavigate({ view: 'autolog' })
                } else {
                  setLogExpanded(v => !v)
                }
              }}
              title={open ? undefined : 'Log (A)'}
              className={`w-full flex items-center gap-2 py-1.5 transition border-l-2
                ${open ? 'pl-6 pr-3' : 'px-3'}
                ${isLogActive
                  ? 'text-emerald-400 border-emerald-400 bg-white/15'
                  : 'text-blue-100/70 border-transparent hover:bg-white/10 hover:text-white'
                }`}>
              <span className={`flex-shrink-0 ${isLogActive ? 'text-emerald-400' : ''}`}><ClipboardList size={14} /></span>
              {open && (
                <>
                  <span className={`flex-1 text-left text-[11px] font-semibold uppercase tracking-wide ${isLogActive ? 'text-emerald-400' : ''}`}>
                    Log
                  </span>
                  <ChevronRight size={10} className={`transition-transform ${logExpanded ? 'rotate-90' : ''} ${isLogActive ? 'text-emerald-400/60' : 'text-white/20'}`} />
                  <kbd className={`text-[9px] px-1 rounded border ml-1 ${
                    isLogActive ? 'border-emerald-400/40 text-emerald-400/60' : 'border-white/10 text-white/20'
                  }`}>A</kbd>
                </>
              )}
            </button>

            {/* Log sub-items */}
            {(logExpanded || !open) && (
              <>
                <NavItem id="autolog"  icon={<Bot size={14} />}      label="Auto Log"          shortcut="A" color="text-emerald-400" indent={2} />
                <NavItem id="dailylog" icon={<BookOpen size={14} />} label={t('nav.dailylog')} shortcut="G" color="text-violet-400"  indent={2} />
                <NavItem id="backlog"  icon={<Archive size={14} />}  label={t('nav.backlog')}  shortcut="B" color="text-orange-400"  indent={2} />
              </>
            )}
          </div>
        </div>

        {/* Date history */}
        {open && (
          <div className="text-xs mt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            {weekKeys.map((wk) => {
              const label  = wk === todayWeek ? 'This week' : `Week of ${format(parseISO(wk), 'd MMM')}`
              const isOpen = openWeeks[wk] ?? false
              return (
                <div key={wk}>
                  <button
                    onClick={() => setOpenWeeks(p => ({ ...p, [wk]: !p[wk] }))}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-blue-200/40 hover:bg-white/10 hover:text-blue-200/70 transition">
                    <span>{label}</span>
                    <ChevronDown size={12} className={`transition-transform duration-150 ${isOpen ? '' : '-rotate-90'}`} />
                  </button>
                  {isOpen && weeks[wk].map(d => {
                    const isToday    = d === today
                    const isSelected = d === selectedDate
                    return (
                      <button key={d}
                        onClick={() => onNavigate({ view: 'dailyhub', date: d })}
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
      </nav>

      {/* Bottom — Settings / Admin Console / Feedback */}
      <div className={`${open ? 'px-3 py-2' : 'px-2 py-2'} space-y-0.5`} style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <a
          href="/settings"
          title="Settings"
          className="flex items-center gap-2 text-blue-100/50 hover:text-white transition rounded px-1 py-1 hover:bg-white/10"
        >
          <Settings size={14} />
          {open && <span className="text-[10px]">Settings</span>}
        </a>
        <button
          onClick={openAdminConsole}
          title="Admin Console (PIN-gated terminal + Quick Fix, opens in new tab)"
          className="w-full flex items-center gap-2 text-blue-100/50 hover:text-white transition rounded px-1 py-1 hover:bg-white/10"
        >
          <Lock size={14} />
          {open && <span className="text-[10px]">Admin Console</span>}
        </button>
        {onFeedback && (
          <button
            onClick={onFeedback}
            title="Give Feedback"
            className="w-full flex items-center gap-2 text-blue-100/50 hover:text-white transition rounded px-1 py-1 hover:bg-white/10"
          >
            <MessageCircle size={14} />
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
