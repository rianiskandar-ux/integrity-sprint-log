'use client'

import { useState, useTransition, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { SprintDay, Session } from '@/lib/parser'
import type { Project } from '@/lib/projects'
import Sidebar from './Sidebar'
import DailyView from './DailyView'
import SprintView from './SprintView'
import MonthView from './MonthView'
import SkillsView from './SkillsView'
import SearchModal from './SearchModal'
import AddSessionModal from './AddSessionModal'
import ActivityHeatmap from './ActivityHeatmap'
import SettingsModal from './SettingsModal'
import HelpModal from './HelpModal'
import ConfirmModal from './ConfirmModal'
import SetupWizard from './SetupWizard'
import SprintBanner from './SprintBanner'
import AutoLogView from './AutoLogView'
import AutoLogIndicator from './AutoLogIndicator'
import EnvModeBadge from './EnvModeBadge'
import IncomingTasksPanel from './IncomingTasksPanel'
import StaleBacklogView from './StaleBacklogView'
import SprintPlanView from './SprintPlanView'
import PushQueueView from './PushQueueView'
import ISLDashboard from './ISLDashboard'
import FlowModal from './FlowModal'
import ChatBubble from './ChatBubble'
import SprintReportModal from './SprintReportModal'
import FeedbackModal from './FeedbackModal'
import TaskChatModal, { type TaskChatContext } from './TaskChatModal'
import { loadSettings, saveSettings, loadAppConfig } from '@/lib/op-config'
import { useI18n, LANG_OPTIONS } from '@/lib/i18n'

interface Props {
  view: string
  today: string
  selectedDate: string
  dates: string[]
  dayData: SprintDay | null
  allDays: SprintDay[]
  projects: Project[]
  projectSprints: Record<string, Record<number, Array<Session & { date: string }>>>
  sprintMeta: Record<number, { start: number; end: number; dates: string[]; sessions: number }>
  currentSprintNo: number
  viewSprintNo: number
  monthMap: Record<string, SprintDay[]>
  allTopics: Array<Session & { date: string }>
}

type OPStatus = 'ok' | 'error' | 'unconfigured' | 'checking' | null

export default function AppShell({
  view, today, selectedDate, dates, dayData, allDays,
  projects, projectSprints, sprintMeta, currentSprintNo, viewSprintNo,
  monthMap, allTopics,
}: Props) {
  const router = useRouter()
  const { lang, setLang, t } = useI18n()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [isPulling, startPull] = useTransition()
  const [toast, setToast] = useState<string | null>(null)
  const [darkMode, setDarkMode] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [opStatus, setOpStatus] = useState<OPStatus>(null)
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [confirmPull, setConfirmPull] = useState(false)
  const [userName, setUserName] = useState('')
  const [nextReviewDate, setNextReviewDate] = useState<string | null>(null)
  const [showSetup, setShowSetup] = useState(false)
  const [wrapupOpen, setWrapupOpen] = useState(false)
  const [wrapupText, setWrapupText] = useState('')
  const [wrapupLoading, setWrapupLoading] = useState(false)
  const [flowOpen, setFlowOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [opSprintName, setOpSprintName] = useState<string | null>(null)
  const [globalTaskChat, setGlobalTaskChat] = useState<TaskChatContext | null>(null)
  const [addPrefill, setAddPrefill] = useState<{ title?: string; opTaskId?: number | null } | null>(null)

  // Listen for task chat open events from ChatBubble shortcuts
  useEffect(() => {
    const handler = (e: Event) => {
      const ctx = (e as CustomEvent).detail as TaskChatContext
      if (ctx) setGlobalTaskChat(ctx)
    }
    window.addEventListener('isl:open-task-chat', handler)
    return () => window.removeEventListener('isl:open-task-chat', handler)
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail as { title?: string; opTaskId?: number | null }
      setAddPrefill(d)
      setAddOpen(true)
    }
    window.addEventListener('isl:start-session', handler)
    return () => window.removeEventListener('isl:start-session', handler)
  }, [])

  useEffect(() => {
    fetch('/api/op/cache')
      .then(r => r.json())
      .then(d => {
        const cur = (d.sprints ?? []).find((s: { isCurrent: boolean }) => s.isCurrent)
        if (cur) setOpSprintName(cur.name)
      })
      .catch(() => {})

    // Auto-sync cache on startup if enabled
    fetch('/api/op/mode').then(r => r.json()).then(d => {
      if (d.autoSync) {
        fetch('/api/op/cache', { method: 'POST' }).catch(() => {})
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const s = loadSettings()
    setUserName(s.userName.split(' ')[0])
    // Migration: skip wizard if user has already configured a non-default identity
    if (!s.setupDone && s.userId === 8 && !s.opApiToken && s.userName === 'Rian Iskandar') {
      // Only show wizard for fresh/default config
      setShowSetup(true)
    } else if (!s.setupDone) {
      // Existing user — silently mark done
      saveSettings({ ...s, setupDone: true })
    }
  }, [])

  useEffect(() => {
    fetch('/api/calendar/events?days=20')
      .then(r => r.json())
      .then(d => { if (d.connected && d.events?.length) setNextReviewDate(d.events[0].start) })
      .catch(() => {})
  }, [])

  // Dark mode — init once from localStorage, apply directly to avoid flash
  useEffect(() => {
    const saved = localStorage.getItem('darkMode')
    const dark = saved !== null ? saved === 'true' : window.matchMedia('(prefers-color-scheme: dark)').matches
    document.documentElement.classList.toggle('dark', dark)
    setDarkMode(dark)
  }, [])

  // Dynamic page title
  useEffect(() => {
    const viewLabel = { daily: '📅', sprint: '🏃', month: '📆', skills: '🎯' }[view] ?? ''
    const dateLabel = view === 'daily'
      ? new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })
      : view.charAt(0).toUpperCase() + view.slice(1)
    const name = loadAppConfig ? loadAppConfig().appName : 'Integrity Sprint Log'
    document.title = `${viewLabel} ${dateLabel} · ${name}`
  }, [view, selectedDate])

  // Tab badge — pending counts from OP cache + ISL sessions
  const [tabBadgeTotal, setTabBadgeTotal] = useState(0)
  useEffect(() => {
    async function fetchCounts() {
      try {
        const [cacheRes, islRes] = await Promise.all([
          fetch('/api/op/cache').then(r => r.json()).catch(() => ({})),
          fetch('/api/isl/sessions?status=pending').then(r => r.json()).catch(() => ({})),
        ])
        const queueCount = Array.isArray(cacheRes.pushQueue) ? cacheRes.pushQueue.length : 0
        const incomingCount = Array.isArray(cacheRes.incoming) ? cacheRes.incoming.length : 0
        const islPending = Array.isArray(islRes.sessions) ? islRes.sessions.length : (typeof islRes.total === 'number' ? islRes.total : 0)
        setTabBadgeTotal(queueCount + incomingCount + islPending)
      } catch { /* ignore */ }
    }
    fetchCounts()
    const handler = () => fetchCounts()
    window.addEventListener('isl:cache-refreshed', handler)
    window.addEventListener('isl:session-updated', handler)
    return () => {
      window.removeEventListener('isl:cache-refreshed', handler)
      window.removeEventListener('isl:session-updated', handler)
    }
  }, [])

  useEffect(() => {
    const appName = 'ISL Dashboard'
    document.title = tabBadgeTotal > 0 ? `(${tabBadgeTotal}) ${appName}` : appName
  }, [tabBadgeTotal])

  // Check OP status once on mount
  useEffect(() => {
    setOpStatus('checking')
    fetch('/api/status').then((r) => r.json()).then((d) => {
      setOpStatus(d.op.status)
    }).catch(() => setOpStatus('error'))
  }, [])

  // Auto-sync OP cache on mount if stale (> 5 min) — scoped to current user
  useEffect(() => {
    fetch('/api/op/cache')
      .then(r => r.json())
      .then(d => {
        const lastSync = d.lastSync ? new Date(d.lastSync).getTime() : 0
        const stale = Date.now() - lastSync > 5 * 60 * 1000
        if (stale) {
          const s = loadSettings()
          fetch('/api/op/cache', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: s.userId,
              userName: s.userName,
              projects: s.watchedProjects?.length ? s.watchedProjects : undefined,
            }),
          }).catch(() => {})
        }
      })
      .catch(() => {})
  }, [])

  // Auto-generate today on load
  useEffect(() => {
    if (view === 'daily' && selectedDate === today) {
      fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: today, force: false }),
      }).then((r) => r.json()).then((d) => {
        if (d.ok && (d.workPackages > 0 || d.openTasks > 0)) router.refresh()
      }).catch(() => {})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  const navigate = useCallback((params: Record<string, string>) => {
    const q = new URLSearchParams(params).toString()
    router.push(`/?${q}`)
    setMobileNav(false)
  }, [router])

  async function doPullOP() {
    setConfirmPull(false)
    startPull(async () => {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedDate }),
      })
      const data = await res.json()
      if (data.ok) {
        showToast(`✓ Pulled — ${data.workPackages} tasks, ${data.openTasks} open`)
        router.refresh()
      } else {
        showToast('⚠ Pull failed — check OP config')
      }
    })
  }

  function toggleDark() {
    const next = !darkMode
    setDarkMode(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('darkMode', String(next))
  }

  async function doWrapup() {
    if (!dayData?.sessions.length) { showToast(t('wrapup.no_activity')); return }
    setWrapupLoading(true)
    setWrapupOpen(true)
    setWrapupText('')
    try {
      const res = await fetch('/api/wrapup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessions: dayData.sessions, date: selectedDate }),
      })
      const d = await res.json()
      if (d.ok) setWrapupText(d.summary)
      else setWrapupText('⚠ ' + (d.error ?? t('wrapup.error_generate')))
    } catch {
      setWrapupText('⚠ ' + t('wrapup.error_connection'))
    } finally {
      setWrapupLoading(false)
    }
  }

  // Date navigation
  const dateIdx = dates.indexOf(selectedDate)
  const prevDate = dateIdx < dates.length - 1 ? dates[dateIdx + 1] : null
  const nextDate = dateIdx > 0 ? dates[dateIdx - 1] : null

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(true); return }
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); setAddOpen(true); return }
      if (e.key === 'Escape') { setSearchOpen(false); setAddOpen(false); setSettingsOpen(false); setHelpOpen(false); return }
      if (e.key === ',') { setSettingsOpen(true); return }
      if (e.key === '?') { setHelpOpen(true); return }
      if (searchOpen || addOpen) return

      if (e.key === 'j' || e.key === 'ArrowRight') { if (nextDate) navigate({ view: 'daily', date: nextDate }) }
      else if (e.key === 'k' || e.key === 'ArrowLeft') { if (prevDate) navigate({ view: 'daily', date: prevDate }) }
      else if (e.key === 'd') navigate({ view: 'daily', date: selectedDate })
      else if (e.key === 's') navigate({ view: 'sprint' })
      else if (e.key === 'm') navigate({ view: 'month' })
      else if (e.key === 'l') navigate({ view: 'skills' })
      else if (e.key === 't') navigate({ view: 'daily', date: today })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dates, selectedDate, today, view, navigate, searchOpen, addOpen, nextDate, prevDate])

  const hasSession = (d: string) => allDays.some((day) => day.date === d && day.sessions.length > 0)

  // Stats
  const totalSessions = allDays.reduce((n, d) => n + d.sessions.length, 0)
  const activeDays = allDays.filter((d) => d.sessions.length > 0).length
  let streak = 0
  for (const d of [...dates].sort().reverse()) {
    if (hasSession(d)) streak++
    else break
  }

  const opDot = {
    ok: 'bg-emerald-400',
    error: 'bg-red-400',
    unconfigured: 'bg-gray-300',
    checking: 'bg-yellow-400 animate-pulse',
  }[opStatus ?? 'checking'] ?? 'bg-gray-300'

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-950 font-sans">
      {/* Mobile overlay */}
      {mobileNav && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setMobileNav(false)} />
      )}

      {/* Sidebar */}
      <div className={`fixed inset-y-0 left-0 z-50 lg:relative lg:flex lg:z-auto transition-transform duration-200 ${mobileNav ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <Sidebar
          open={sidebarOpen}
          view={view}
          today={today}
          selectedDate={selectedDate}
          dates={dates}
          hasSession={hasSession}
          onNavigate={navigate}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
          onFeedback={() => setFeedbackOpen(true)}
        />
      </div>

      {/* Main */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Top bar */}
        <div className="sticky top-0 z-10 flex items-center gap-2 flex-wrap px-4 lg:px-6 py-2.5 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 shadow-sm">
          {/* Mobile hamburger */}
          <button className="lg:hidden p-1.5 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 mr-1" onClick={() => setMobileNav(true)}>☰</button>

          {/* Date nav (daily view) */}
          {view === 'daily' && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => prevDate && navigate({ view: 'daily', date: prevDate })}
                disabled={!prevDate}
                className="p-1.5 rounded text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 transition"
                title="Previous day (k)"
              >
                ‹
              </button>
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 mx-1">
                {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
              </span>
              <button
                onClick={() => nextDate && navigate({ view: 'daily', date: nextDate })}
                disabled={!nextDate}
                className="p-1.5 rounded text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 transition"
                title="Next day (j)"
              >
                ›
              </button>
            </div>
          )}

          {view !== 'daily' && (() => {
            const VIEW_LABELS: Record<string, string> = {
              sprint: 'Sprint', month: 'Month', skills: 'Skills',
              isldash: 'ISL Dashboard', incoming: 'Incoming', pushqueue: 'Push Queue',
              autolog: 'Auto Log', sprintplan: 'Sprint Plan', backlog: 'Backlog', oldtasks: 'Backlog',
            }
            return <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{VIEW_LABELS[view] ?? view}</span>
          })()}

          {/* Daily actions */}
          {view === 'daily' && (
            <>
              <button
                onClick={() => opStatus === 'ok' ? setConfirmPull(true) : setSettingsOpen(true)}
                disabled={isPulling}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition disabled:opacity-50 ${opStatus === 'ok' ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-700 hover:bg-gray-200'}`}
                title={opStatus === 'ok' ? t('header.op_connected') : t('header.op_disconnected')}
              >
                {isPulling ? t('common.loading') : `↻ ${t('header.pull_op')}`}
              </button>
              <button onClick={doWrapup} disabled={wrapupLoading} className="px-3 py-1.5 rounded-md text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition" title={t('nav.wrapup')}>
                {wrapupLoading ? t('wrapup.generating') : `✓ ${lang === 'id' ? 'Ringkasan' : 'Summary'}`}
              </button>
              <button onClick={() => setAddOpen(true)} className="px-3 py-1.5 rounded-md text-xs font-semibold border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition" title={t('session.add_title')}>
                {t('header.add_session')}
              </button>
              {selectedDate !== today && (
                <a href={`/?view=daily&date=${today}`} className="px-3 py-1.5 rounded-md text-xs font-semibold border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition">{lang === 'id' ? 'Hari Ini' : 'Today'}</a>
              )}
            </>
          )}

          {/* Right side — clean SaaS */}
          <div className="ml-auto flex items-center gap-1.5">

            {/* Streak — only if active */}
            {streak > 1 && (
              <span className="hidden md:flex items-center text-[11px] bg-orange-50 dark:bg-orange-950 text-orange-500 px-2 py-1 rounded-full font-semibold gap-1">
                🔥 {streak}
              </span>
            )}

            {/* Sprint pill */}
            {currentSprintNo && (
              <button
                onClick={() => navigate({ view: 'sprint' })}
                className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900 transition"
                title={t('header.sprint_tooltip')}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {opSprintName ?? `Sprint ${currentSprintNo}`}
                {nextReviewDate && (
                  <span className="text-emerald-500 dark:text-emerald-400 font-normal hidden lg:inline">
                    · {new Date(nextReviewDate + (nextReviewDate.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                  </span>
                )}
              </button>
            )}

            {/* ENV badge */}
            <EnvModeBadge />

            {/* Divider */}
            <span className="w-px h-5 bg-gray-200 dark:bg-gray-700 hidden md:block" />

            {/* Search */}
            <button onClick={() => setSearchOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800 transition"
              title="Search (⌘K)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <kbd className="hidden sm:inline text-[9px] bg-gray-100 dark:bg-gray-700 px-1 rounded font-mono">⌘K</kbd>
            </button>

            {/* Dark mode */}
            <button onClick={toggleDark}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
              title="Toggle dark mode">
              {darkMode
                ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
                : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              }
            </button>

            {/* Help + Flow — grouped as icon */}
            <button onClick={() => setHelpOpen(true)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
              title="Help">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>
              </svg>
            </button>

            {/* Language flag — single button, cycles between id/en */}
            <button
              onClick={() => setLang(lang === 'id' ? 'en' : 'id')}
              className="p-1.5 rounded-lg text-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition leading-none"
              title={lang === 'id' ? 'Switch to English' : 'Ganti ke Bahasa Indonesia'}>
              {lang === 'id' ? '🇮🇩' : '🇬🇧'}
            </button>

            {/* OP status dot */}
            <button
              onClick={() => { setOpStatus('checking'); fetch('/api/status').then(r=>r.json()).then(d=>setOpStatus(d.op.status)).catch(()=>setOpStatus('error')) }}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
              title={`OpenProject: ${opStatus ?? 'unknown'}`}>
              <span className={`w-2 h-2 rounded-full ${opDot}`} />
              <span className="text-[10px] font-medium text-gray-400 hidden lg:inline">OP</span>
            </button>

            {/* User avatar */}
            <button
              onClick={() => setSettingsOpen(true)}
              className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition"
              title="Settings">
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                {(userName || 'U').charAt(0).toUpperCase()}
              </div>
              <span className="text-xs font-medium text-gray-600 dark:text-gray-300 hidden lg:inline">{userName || 'Settings'}</span>
            </button>
          </div>
        </div>

        {/* Offline / OP error banner */}
        {opStatus === 'error' && (
          <div className="sticky top-0 z-10 flex items-center gap-2 px-4 lg:px-6 py-2 bg-amber-50 dark:bg-amber-950 border-b border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs font-medium">
            <span>⚠</span>
            <span>OpenProject unreachable — working offline</span>
          </div>
        )}

        {/* Sprint end reminder banner */}
        <SprintBanner
          currentSprintNo={currentSprintNo}
          sprintEndDate={sprintMeta[currentSprintNo]?.end}
        />

        {/* Activity heatmap (expandable) */}
        {showHeatmap && (
          <div className="px-4 lg:px-6 pt-4">
            <ActivityHeatmap
              allDays={allDays}
              onDateClick={(date) => navigate({ view: 'daily', date })}
            />
          </div>
        )}

        {/* View content */}
        <main className={`flex-1 p-4 lg:p-6 ${view === 'isldash' ? 'overflow-hidden flex flex-col' : 'overflow-y-auto'}`}>
          {view === 'daily' && <DailyView dayData={dayData} projects={projects} isToday={selectedDate === today} onAddSession={() => setAddOpen(true)} />}
          {view === 'sprint' && (
            <SprintView
              projectSprints={projectSprints}
              sprintMeta={sprintMeta}
              currentSprintNo={currentSprintNo}
              viewSprintNo={viewSprintNo}
              projects={projects}
              onNavigate={navigate}
            />
          )}
          {view === 'month' && <MonthView monthMap={monthMap} projects={projects} />}
          {view === 'skills' && <SkillsView allTopics={allTopics} />}
          {view === 'autolog' && <AutoLogView />}
          {view === 'incoming' && <IncomingTasksPanel />}
          {view === 'isldash'   && <div className="flex-1 min-h-0 overflow-hidden"><ISLDashboard onNavigate={v => navigate({ view: v })} onReport={() => setReportOpen(true)} /></div>}
          {view === 'oldtasks'  && <StaleBacklogView onToast={msg => { setToast(msg); setTimeout(() => setToast(null), 3000) }} />}
          {view === 'backlog'   && <StaleBacklogView onToast={msg => { setToast(msg); setTimeout(() => setToast(null), 3000) }} />}
          {view === 'sprintplan' && <SprintPlanView />}
          {view === 'pushqueue'  && <PushQueueView />}
        </main>
      </div>

      {/* Modals */}
      {searchOpen && <SearchModal allTopics={allTopics} onClose={() => setSearchOpen(false)} onNavigate={navigate} />}
      {addOpen && <AddSessionModal date={selectedDate} onClose={() => { setAddOpen(false); setAddPrefill(null) }} prefillTitle={addPrefill?.title} prefillOpTaskId={addPrefill?.opTaskId} />}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} onSaved={() => { setUserName(loadSettings().userName.split(' ')[0]) }} />
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      {flowOpen && <FlowModal onClose={() => setFlowOpen(false)} />}
      {reportOpen && <SprintReportModal onClose={() => setReportOpen(false)} />}
      {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
      {globalTaskChat && <TaskChatModal task={globalTaskChat} onClose={() => setGlobalTaskChat(null)} />}
      <ChatBubble />
      {showSetup && <SetupWizard onDone={() => { setShowSetup(false); setUserName(loadSettings().userName.split(' ')[0]) }} />}
      {confirmPull && (
        <ConfirmModal
          title={lang === 'id' ? 'Refresh data dari OpenProject?' : 'Refresh data from OpenProject?'}
          description={lang === 'id' ? `Ambil task & aktivitas terbaru dari OP untuk tanggal ${selectedDate}.` : `Pull latest tasks & activities from OP for ${selectedDate}.`}
          whatHappens={lang === 'id' ? 'Data OpenProject di halaman ini akan diperbarui dengan yang terbaru dari server OP. Data yang sudah ada akan ditimpa. Catatan aktivitas kamu tidak akan terpengaruh.' : 'OpenProject data on this page will be updated with the latest from the OP server. Existing data will be overwritten. Your activity notes will not be affected.'}
          confirmLabel={lang === 'id' ? 'Ya, Refresh Sekarang' : 'Yes, Refresh Now'}
          onConfirm={doPullOP}
          onCancel={() => setConfirmPull(false)}
        />
      )}

      {/* Wrapup Modal */}
      {wrapupOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setWrapupOpen(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">{t('wrapup.title')}</h3>
              <button onClick={() => setWrapupOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none">×</button>
            </div>
            {wrapupLoading ? (
              <div className="flex items-center gap-3 py-8 justify-center text-gray-400">
                <span className="animate-spin text-xl">⏳</span>
                <span className="text-sm">{t('wrapup.generating')}</span>
              </div>
            ) : (
              <>
                <p className="text-xs text-gray-400 mb-2">{t('wrapup.edit_hint')}</p>
                <textarea
                  value={wrapupText}
                  onChange={e => setWrapupText(e.target.value)}
                  rows={8}
                  className="w-full bg-gray-50 dark:bg-gray-800 rounded-lg p-4 text-sm text-gray-700 dark:text-gray-300 leading-relaxed resize-none outline-none focus:ring-2 focus:ring-indigo-400 border border-gray-200 dark:border-gray-700"
                />
                <div className="flex justify-between items-center mt-4">
                  <button onClick={doWrapup} className="text-xs text-gray-400 hover:text-indigo-500 transition">{t('common.generate_again')}</button>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { navigator.clipboard.writeText(wrapupText); showToast(t('common.copied')) }}
                      className="px-4 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition"
                    >
                      Copy
                    </button>
                    <button onClick={() => setWrapupOpen(false)} className="px-4 py-2 text-xs font-semibold border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition">
                      {t('common.close')}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm px-4 py-2 rounded-lg shadow-lg z-50 animate-[fade-in_0.15s_ease-out]">
          {toast}
        </div>
      )}
    </div>
  )
}
