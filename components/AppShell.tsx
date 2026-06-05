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
import DraftCard from './DraftCard'
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
  const { lang, setLang } = useI18n()
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
    const cfg = loadSettings()
    const name = loadAppConfig ? loadAppConfig().appName : 'Integrity Sprint Log'
    document.title = `${viewLabel} ${dateLabel} · ${name}`
  }, [view, selectedDate])

  // Check OP status once on mount
  useEffect(() => {
    setOpStatus('checking')
    fetch('/api/status').then((r) => r.json()).then((d) => {
      setOpStatus(d.op.status)
    }).catch(() => setOpStatus('error'))
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
    if (!dayData?.sessions.length) { showToast('Belum ada sesi hari ini'); return }
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
      else setWrapupText('⚠ ' + (d.error ?? 'Gagal generate wrapup'))
    } catch {
      setWrapupText('⚠ Tidak bisa generate — cek koneksi.')
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

          {view !== 'daily' && (
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 capitalize">{view}</span>
          )}

          {/* Daily actions */}
          {view === 'daily' && (
            <>
              {opStatus === 'ok' && (
                <button onClick={() => setConfirmPull(true)} disabled={isPulling} className="px-3 py-1.5 rounded-md text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition">
                  {isPulling ? 'Pulling…' : '↻ Pull OP'}
                </button>
              )}
              <button onClick={doWrapup} disabled={wrapupLoading} className="px-3 py-1.5 rounded-md text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition">
                {wrapupLoading ? 'Generating…' : '✓ Wrapup'}
              </button>
              <button onClick={() => setAddOpen(true)} className="px-3 py-1.5 rounded-md text-xs font-semibold border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition" title="Add session (⌘N)">
                + Session
              </button>
              {selectedDate !== today && (
                <a href={`/?view=daily&date=${today}`} className="px-3 py-1.5 rounded-md text-xs font-semibold border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition">Today</a>
              )}
            </>
          )}

          {/* Right side */}
          <div className="ml-auto flex items-center gap-2">
            {/* OP status */}
            <button
              onClick={() => { setOpStatus('checking'); fetch('/api/status').then(r=>r.json()).then(d=>setOpStatus(d.op.status)).catch(()=>setOpStatus('error')) }}
              className="hidden md:flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition"
              title={`OpenProject: ${opStatus ?? 'unknown'}`}
            >
              <span className={`w-2 h-2 rounded-full ${opDot}`} />
              <span className="hidden lg:inline">OP</span>
            </button>

            {/* Stats pills */}
            <div className="hidden md:flex items-center gap-1.5">
              <button onClick={() => setShowHeatmap(!showHeatmap)} className="text-[11px] bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 px-2.5 py-1 rounded-full font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition" title="Total sessions">
                {totalSessions} sessions
              </button>
              <span className="text-[11px] bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 px-2.5 py-1 rounded-full font-medium" title={`${activeDays} hari aktif — hari dengan minimal 1 session`}>
                {activeDays}d aktif
              </span>
              {streak > 1 && (
                <span className="text-[11px] bg-orange-50 dark:bg-orange-950 text-orange-600 dark:text-orange-400 px-2.5 py-1 rounded-full font-semibold" title={`Streak: ${streak} hari berturut-turut tanpa skip session. Jangan sampai putus!`}>
                  🔥 {streak} streak
                </span>
              )}
            </div>

            {/* Draft card — auto-populated from Claude hook */}
            <DraftCard onPushed={() => router.refresh()} />

            {/* Sprint indicator */}
            <button
              onClick={() => navigate({ view: 'sprint' })}
              className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900 transition"
              title="Sprint aktif — klik untuk lihat Sprint view"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              S{currentSprintNo} running
              {nextReviewDate && (
                <span className="text-emerald-500 dark:text-emerald-400 font-normal">
                  · Review {new Date(nextReviewDate + (nextReviewDate.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                </span>
              )}
            </button>

            {/* Language switcher */}
            <div className="hidden md:flex items-center rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              {LANG_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setLang(opt.value)}
                  className={`px-2 py-1.5 text-sm transition ${lang === opt.value ? 'bg-indigo-600 text-white' : 'text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                  title={opt.label}
                >
                  {opt.flag}
                </button>
              ))}
            </div>

            {/* Search */}
            <button onClick={() => setSearchOpen(true)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 transition bg-white dark:bg-gray-800">
              🔍 <kbd className="hidden sm:inline text-[10px] bg-gray-100 dark:bg-gray-700 px-1 rounded">⌘K</kbd>
            </button>

            {/* Help */}
            <button onClick={() => setHelpOpen(true)} className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition text-sm" title="Panduan (?)">
              ❓
            </button>

            {/* Dark mode */}
            <button onClick={toggleDark} className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition text-sm" title="Toggle dark mode">
              {darkMode ? '☀️' : '🌙'}
            </button>

            {/* Settings */}
            <button
              onClick={() => setSettingsOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 transition bg-white dark:bg-gray-800"
              title="Settings"
            >
              ⚙️ {userName || 'Settings'}
            </button>
          </div>
        </div>

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
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
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
        </main>
      </div>

      {/* Modals */}
      {searchOpen && <SearchModal allTopics={allTopics} onClose={() => setSearchOpen(false)} onNavigate={navigate} />}
      {addOpen && <AddSessionModal date={selectedDate} onClose={() => setAddOpen(false)} />}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} onSaved={() => { setUserName(loadSettings().userName.split(' ')[0]) }} />
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      {showSetup && <SetupWizard onDone={() => { setShowSetup(false); setUserName(loadSettings().userName.split(' ')[0]) }} />}
      {confirmPull && (
        <ConfirmModal
          title="Pull data dari OpenProject?"
          description={`Ambil task & activity terbaru dari OP untuk tanggal ${selectedDate}.`}
          whatHappens="Bagian OpenProject Done dan Open Tasks di halaman ini akan diperbarui dengan data terbaru dari server OP. Data yang sudah ada akan ditimpa. Sesi Claude kamu tidak akan terpengaruh."
          confirmLabel="Ya, Pull Sekarang"
          onConfirm={doPullOP}
          onCancel={() => setConfirmPull(false)}
        />
      )}

      {/* Wrapup Modal */}
      {wrapupOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setWrapupOpen(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">✓ Daily Wrapup</h3>
              <button onClick={() => setWrapupOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none">×</button>
            </div>
            {wrapupLoading ? (
              <div className="flex items-center gap-3 py-8 justify-center text-gray-400">
                <span className="animate-spin text-xl">⏳</span>
                <span className="text-sm">Generating ringkasan…</span>
              </div>
            ) : (
              <>
                <p className="text-xs text-gray-400 mb-2">Edit sebelum copy jika perlu:</p>
                <textarea
                  value={wrapupText}
                  onChange={e => setWrapupText(e.target.value)}
                  rows={8}
                  className="w-full bg-gray-50 dark:bg-gray-800 rounded-lg p-4 text-sm text-gray-700 dark:text-gray-300 leading-relaxed resize-none outline-none focus:ring-2 focus:ring-indigo-400 border border-gray-200 dark:border-gray-700"
                />
                <div className="flex justify-between items-center mt-4">
                  <button onClick={doWrapup} className="text-xs text-gray-400 hover:text-indigo-500 transition">↺ Generate ulang</button>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { navigator.clipboard.writeText(wrapupText); showToast('✓ Copied!') }}
                      className="px-4 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition"
                    >
                      Copy
                    </button>
                    <button onClick={() => setWrapupOpen(false)} className="px-4 py-2 text-xs font-semibold border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition">
                      Tutup
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
