'use client'

import { useState, useEffect } from 'react'
import { format, differenceInDays, parseISO, startOfDay } from 'date-fns'
import type { Session } from '@/lib/parser'
import type { Project } from '@/lib/projects'
import type { CalendarEvent } from '@/app/api/calendar/events/route'
import { useI18n } from '@/lib/i18n'
import SprintPlanView from './SprintPlanView'

interface Props {
  projectSprints: Record<string, Record<number, Array<Session & { date: string }>>>
  sprintMeta: Record<number, { start: number; end: number; dates: string[]; sessions: number }>
  currentSprintNo: number
  viewSprintNo: number
  projects: Project[]
  onNavigate: (p: Record<string, string>) => void
}

// ─── Overview tab ────────────────────────────────────────────────────────────

interface OverviewData {
  sprint: { id: number; name: string; startDate: string; endDate: string; isCurrent: boolean } | null
  allSprints: { id: number; name: string; isCurrent: boolean }[]
  isl: {
    sessionCount: number
    totalRealMins: number
    totalEstMins: number
    topTopics: { word: string; count: number }[]
    projectFreq: Record<string, number>
    recentSessions: { id: string; date: string; title: string; mins: number; opTaskId: number | null; pushStatus: string }[]
  }
  op: { total: number; done: number; pct: number; totalEst: number; totalSpent: number; openCount: number }
  daysLeft: number | null
}

function fmtH(mins: number) {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60), m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function fmtHours(h: number) {
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60)
  return mm > 0 ? `${hh}h ${mm}m` : `${hh}h`
}

interface AiSuggestItem {
  subject: string; type: string; projectHint: string
  estimatedHours: number; priority: 'high' | 'medium' | 'low'; reason: string
}

function OverviewTab({ data, loading }: { data: OverviewData | null; loading: boolean }) {
  const [aiSummary, setAiSummary]       = useState<string | null>(null)
  const [aiSuggests, setAiSuggests]     = useState<AiSuggestItem[]>([])
  const [aiLoading, setAiLoading]       = useState(false)
  const [aiDone, setAiDone]             = useState(false)
  const [aiNotConfigured, setAiNotConf] = useState(false)

  async function generateAI() {
    setAiLoading(true)
    setAiNotConf(false)
    try {
      const d = await fetch('/api/op/sprint-plan').then(r => r.json())
      if (d.aiConfigured === false) { setAiNotConf(true); setAiDone(true); setAiLoading(false); return }
      if (d.aiSummary)        setAiSummary(d.aiSummary)
      if (d.aiSuggestedTasks?.length) setAiSuggests(d.aiSuggestedTasks)
      setAiDone(true)
    } catch {}
    setAiLoading(false)
  }

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400 text-sm">Loading overview…</div>
  if (!data) return <div className="text-sm text-red-400 py-10 text-center">Failed to load overview.</div>

  const { isl, op, daysLeft } = data

  const opPct = op.pct ?? 0
  const islEff = isl.totalEstMins > 0 ? Math.round(isl.totalRealMins / isl.totalEstMins * 100) : null

  return (
    <div className="space-y-5">
      {/* Top stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Days left */}
        <div className="rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Days Left</span>
          <span className={`text-3xl font-bold ${daysLeft !== null && daysLeft <= 3 ? 'text-red-500' : 'text-gray-900 dark:text-gray-100'}`}>
            {daysLeft !== null ? daysLeft : '—'}
          </span>
          <span className="text-[10px] text-gray-400">in sprint</span>
        </div>

        {/* OP progress */}
        <div className="rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">OP Progress</span>
          <span className="text-3xl font-bold text-gray-900 dark:text-gray-100">{opPct}%</span>
          <span className="text-[10px] text-gray-400">{op.done}/{op.total} tasks done</span>
          <div className="mt-1 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${opPct}%` }} />
          </div>
        </div>

        {/* ISL sessions */}
        <div className="rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Work Log</span>
          <span className="text-3xl font-bold text-gray-900 dark:text-gray-100">{isl.sessionCount}</span>
          <span className="text-[10px] text-gray-400">sessions · {fmtH(isl.totalRealMins)} actual</span>
        </div>

        {/* Time efficiency */}
        <div className="rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Time Est</span>
          <span className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            {isl.totalEstMins > 0 ? fmtH(isl.totalEstMins) : '—'}
          </span>
          <span className="text-[10px] text-gray-400">
            {islEff !== null ? `${islEff}% of estimate` : 'no estimate'}
          </span>
        </div>
      </div>

      {/* OP time row */}
      {(op.totalEst > 0 || op.totalSpent > 0) && (
        <div className="rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">OpenProject Hours</p>
          <div className="flex items-center gap-6 flex-wrap">
            <div>
              <span className="text-xl font-bold text-gray-900 dark:text-gray-100">{fmtHours(op.totalSpent)}</span>
              <span className="text-xs text-gray-400 ml-1">spent</span>
            </div>
            <div>
              <span className="text-xl font-bold text-gray-500 dark:text-gray-400">{fmtHours(op.totalEst)}</span>
              <span className="text-xs text-gray-400 ml-1">estimated</span>
            </div>
            <div className="flex-1 min-w-[120px]">
              <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${op.totalSpent > op.totalEst ? 'bg-red-400' : 'bg-blue-400'}`}
                  style={{ width: `${Math.min(100, op.totalEst > 0 ? Math.round(op.totalSpent / op.totalEst * 100) : 0)}%` }}
                />
              </div>
              {op.totalEst > 0 && (
                <p className="text-[10px] text-gray-400 mt-0.5">
                  {Math.round(op.totalSpent / op.totalEst * 100)}% of estimate
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Top topics */}
        {isl.topTopics.length > 0 && (
          <div className="rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Top Topics</p>
            <div className="flex flex-wrap gap-1.5">
              {isl.topTopics.map(({ word, count }) => (
                <span key={word} className="text-xs bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-800 px-2 py-0.5 rounded-full font-medium">
                  {word} <span className="opacity-60 font-normal">×{count}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Projects */}
        {Object.keys(isl.projectFreq).length > 0 && (
          <div className="rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">By Project</p>
            <div className="space-y-1.5">
              {Object.entries(isl.projectFreq)
                .sort((a, b) => b[1] - a[1])
                .map(([proj, cnt]) => (
                  <div key={proj} className="flex items-center gap-2">
                    <span className="text-xs text-gray-700 dark:text-gray-300 flex-1 truncate">{proj}</span>
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{cnt}</span>
                    <div className="w-16 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-violet-400 rounded-full"
                        style={{ width: `${Math.round(cnt / isl.sessionCount * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Recent sessions */}
      {isl.recentSessions.length > 0 && (
        <div className="rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Recent Sessions</p>
          <div className="space-y-2">
            {isl.recentSessions.map(s => (
              <div key={s.id} className="flex items-center gap-3 py-1.5 border-b border-gray-50 dark:border-gray-700 last:border-0">
                <span className="text-[10px] text-gray-400 tabular-nums w-20 flex-shrink-0">{s.date}</span>
                <span className="text-xs text-gray-800 dark:text-gray-200 flex-1 truncate">{s.title}</span>
                <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 flex-shrink-0">{fmtH(s.mins)}</span>
                {s.pushStatus === 'pushed' && (
                  <span className="text-[9px] bg-emerald-100 dark:bg-emerald-900 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded-full font-bold flex-shrink-0">✓ OP</span>
                )}
                {s.pushStatus === 'pending' && (
                  <span className="text-[9px] bg-amber-100 dark:bg-amber-900 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded-full font-bold flex-shrink-0">queue</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Summary */}
      <div className="rounded-xl border border-indigo-100 dark:border-indigo-900 bg-white dark:bg-gray-800 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 mb-0.5">AI Sprint Summary</p>
            <p className="text-xs text-gray-400">Retrospective + task suggestions for next sprint</p>
          </div>
          {!aiDone && (
            <button onClick={generateAI} disabled={aiLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 transition">
              {aiLoading
                ? <><span className="w-3 h-3 border border-t-transparent border-white rounded-full animate-spin" /> Generating…</>
                : '✨ Generate'}
            </button>
          )}
          {aiDone && (
            <button onClick={generateAI} disabled={aiLoading}
              className="text-[10px] text-gray-400 hover:text-gray-600 transition">
              {aiLoading ? 'Regenerating…' : '↺ Regenerate'}
            </button>
          )}
        </div>

        {!aiDone && !aiLoading && (
          <p className="text-xs text-gray-400 italic">Click Generate to get AI retrospective and task suggestions based on this sprint&apos;s data.</p>
        )}

        {aiNotConfigured && (
          <div className="p-3 bg-amber-50 dark:bg-amber-950/40 rounded-lg border border-amber-200 dark:border-amber-800">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">ANTHROPIC_API_KEY belum di-set</p>
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
              Tambahkan <code className="font-mono bg-amber-100 dark:bg-amber-900 px-1 rounded">ANTHROPIC_API_KEY=sk-ant-...</code> ke file <code className="font-mono bg-amber-100 dark:bg-amber-900 px-1 rounded">.env.local</code> lalu rebuild.
            </p>
          </div>
        )}

        {aiSummary && (
          <div className="mb-4 p-3 bg-indigo-50 dark:bg-indigo-950/40 rounded-lg border border-indigo-100 dark:border-indigo-800">
            <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 mb-1.5">Retrospective</p>
            <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{aiSummary}</p>
          </div>
        )}

        {aiSuggests.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Suggested for Next Sprint</p>
            <div className="space-y-2">
              {aiSuggests.map((s, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0 ${
                    s.priority === 'high' ? 'bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-400'
                    : s.priority === 'medium' ? 'bg-amber-100 text-amber-600 dark:bg-amber-900 dark:text-amber-400'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                  }`}>{s.priority.toUpperCase()}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">{s.subject}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{s.projectHint} · {s.type} · ~{s.estimatedHours}h</p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 italic">{s.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── OP Sprint Agenda Banner (Sprint Plan tab) ───────────────────────────────

function OpAgendaBanner({ reviewEvent, agendaOpen, setAgendaOpen, t }: {
  reviewEvent: CalendarEvent | null
  agendaOpen: boolean
  setAgendaOpen: (v: boolean) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: (k: any) => string
}) {
  const [planData, setPlanData] = useState<{
    currentSprint: { name: string; startDate: string; endDate: string } | null
    carryOver: { id: number; subject: string; status: string; type: string; project: string; estimatedHours: number | null }[]
    doneTasks: { id: number; subject: string; type: string; project: string }[]
  } | null>(null)

  useEffect(() => {
    fetch('/api/op/sprint-plan').then(r => r.json()).then(d => setPlanData(d)).catch(() => {})
  }, [])

  if (!reviewEvent || !planData) return null
  const eventDate = parseISO(reviewEvent.start.substring(0, 10))
  const daysUntil = differenceInDays(eventDate, startOfDay(new Date()))
  if (daysUntil < 0 || daysUntil > 7) return null
  const isToday    = daysUntil === 0
  const isTomorrow = daysUntil === 1

  // Group tasks by project
  const byProject: Record<string, typeof planData.carryOver> = {}
  for (const t of [...planData.carryOver, ...planData.doneTasks.map(d => ({ ...d, status: 'Closed', estimatedHours: null }))]) {
    const proj = t.project || 'Other'
    if (!byProject[proj]) byProject[proj] = []
    byProject[proj].push(t)
  }

  const copyText = `Sprint Review ${planData.currentSprint?.name ?? ''} — Sprint Plan\n\n` +
    Object.entries(byProject).map(([proj, tasks]) =>
      `${proj} (${tasks.length} tasks)\n` + tasks.slice(0, 5).map(t => `  - #${t.id} ${t.subject} [${t.status}]`).join('\n')
    ).join('\n\n')

  return (
    <div className={`mb-5 rounded-xl border p-4 ${isToday ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800' : isTomorrow ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800' : 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800'}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2.5">
          <span className="text-lg">{isToday ? '🔴' : isTomorrow ? '🟡' : '📅'}</span>
          <div>
            <p className={`text-xs font-bold ${isToday ? 'text-red-700 dark:text-red-300' : isTomorrow ? 'text-amber-700 dark:text-amber-300' : 'text-blue-700 dark:text-blue-300'}`}>
              {isToday ? t('sprint.review_today') : isTomorrow ? t('sprint.review_tomorrow') : `Sprint Review ${daysUntil} ${t('sprint.review_days')}`}
            </p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              {reviewEvent.summary} · {format(eventDate, 'd MMM yyyy')} · OP Tasks
            </p>
          </div>
        </div>
        <button
          onClick={() => setAgendaOpen(!agendaOpen)}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg transition bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50"
        >
          {agendaOpen ? t('sprint.close_agenda') : t('sprint.view_agenda')}
        </button>
      </div>

      {agendaOpen && (
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {planData.currentSprint?.name ?? 'Current Sprint'} — OP Task Summary
            </p>
            <div className="flex gap-2 text-[10px] text-gray-400">
              <span className="bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded font-semibold">{planData.carryOver.length} open</span>
              <span className="bg-emerald-100 dark:bg-emerald-900 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded font-semibold">{planData.doneTasks.length} done</span>
            </div>
          </div>
          <div className="space-y-2">
            {Object.entries(byProject).map(([proj, tasks]) => (
              <div key={proj}>
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">{proj} <span className="font-normal text-gray-400">({tasks.length})</span></p>
                {tasks.slice(0, 3).map(task => (
                  <p key={task.id} className="text-[10px] text-gray-500 dark:text-gray-400 pl-3 truncate">
                    <span className={`font-semibold ${task.status === 'Closed' ? 'text-emerald-500' : task.status.toLowerCase().includes('progress') ? 'text-blue-500' : 'text-gray-400'}`}>●</span>
                    {' '}#{task.id} {task.subject}
                  </p>
                ))}
                {tasks.length > 3 && <p className="text-[10px] text-gray-400 pl-3">+{tasks.length - 3} more</p>}
              </div>
            ))}
          </div>
          <button
            onClick={() => navigator.clipboard.writeText(copyText)}
            className="mt-3 px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
          >
            📋 Copy Sprint Plan Agenda
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Agenda Banner (reusable, ISL sessions) ────────────────────────────────────────────────

function AgendaBanner({ reviewEvent, projects, projectSprints, currentSprintNo, lang, t, agendaOpen, setAgendaOpen, opSprintName }: {
  reviewEvent: CalendarEvent | null
  projects: Project[]
  projectSprints: Props['projectSprints']
  currentSprintNo: number
  lang: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: (k: any) => string
  agendaOpen: boolean
  setAgendaOpen: (v: boolean) => void
  opSprintName?: string | null
}) {
  if (!reviewEvent) return null
  const eventDate = parseISO(reviewEvent.start.substring(0, 10))
  const daysUntil = differenceInDays(eventDate, startOfDay(new Date()))
  if (daysUntil < 0 || daysUntil > 7) return null
  const isToday    = daysUntil === 0
  const isTomorrow = daysUntil === 1

  const agendaLines: string[] = []
  projects.forEach(proj => {
    const sessions = projectSprints[proj.id]?.[currentSprintNo] ?? []
    if (!sessions.length) return
    agendaLines.push(`**${proj.name}** (${sessions.length} ${lang === 'id' ? 'sesi' : 'sessions'})`)
    sessions.slice(0, 3).forEach(s => agendaLines.push(`  - ${s.title}`))
    if (sessions.length > 3) agendaLines.push(`  - +${sessions.length - 3} ${lang === 'id' ? 'sesi lainnya' : 'more sessions'}`)
  })

  return (
    <div className={`mb-5 rounded-xl border p-4 ${isToday ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800' : isTomorrow ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800' : 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800'}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2.5">
          <span className="text-lg">{isToday ? '🔴' : isTomorrow ? '🟡' : '📅'}</span>
          <div>
            <p className={`text-xs font-bold ${isToday ? 'text-red-700 dark:text-red-300' : isTomorrow ? 'text-amber-700 dark:text-amber-300' : 'text-blue-700 dark:text-blue-300'}`}>
              {isToday ? t('sprint.review_today') : isTomorrow ? t('sprint.review_tomorrow') : `Sprint Review ${daysUntil} ${t('sprint.review_days')}`}
            </p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              {reviewEvent.summary} · {format(eventDate, 'd MMM yyyy')}
            </p>
          </div>
        </div>
        <button
          onClick={() => setAgendaOpen(!agendaOpen)}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg transition bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50"
        >
          {agendaOpen ? t('sprint.close_agenda') : t('sprint.view_agenda')}
        </button>
      </div>

      {agendaOpen && (
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">{t('sprint.agenda_draft')} {opSprintName ?? `S${currentSprintNo}`}</p>
          {agendaLines.length === 0 ? (
            <p className="text-xs text-gray-400 italic">{t('sprint.agenda_empty')}</p>
          ) : (
            <div className="space-y-1">
              {agendaLines.map((line, i) => (
                <p key={i} className={`text-xs ${line.startsWith('**') ? 'font-semibold text-gray-800 dark:text-gray-200' : 'text-gray-500 dark:text-gray-400 pl-2'}`}>
                  {line.replace(/\*\*/g, '')}
                </p>
              ))}
            </div>
          )}
          <button
            onClick={() => {
              const text = `Sprint Review ${opSprintName ?? `S${currentSprintNo}`} — Agenda\n\n` + agendaLines.map(l => l.replace(/\*\*/g, '')).join('\n')
              navigator.clipboard.writeText(text)
            }}
            className="mt-3 px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
          >
            {t('sprint.copy_agenda')}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Work Log tab ─────────────────────────────────────────────────────────────

function WorkLogTab({
  projectSprints, sprintMeta, currentSprintNo, viewSprintNo, projects, lang, t,
  reviewEvent, allEvents, agendaOpen, setAgendaOpen, opSprintName,
}: {
  projectSprints: Props['projectSprints']
  sprintMeta: Props['sprintMeta']
  currentSprintNo: number
  viewSprintNo: number
  projects: Project[]
  lang: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: (k: any) => string
  reviewEvent: CalendarEvent | null
  allEvents: CalendarEvent[]
  agendaOpen: boolean
  setAgendaOpen: (v: boolean) => void
  opSprintName?: string | null
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const viewMeta = sprintMeta[viewSprintNo]
  const projectsInSprint = projects.filter((p) => projectSprints[p.id]?.[viewSprintNo]?.length)

  function toggleProject(id: string) {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div>
      <AgendaBanner
        reviewEvent={reviewEvent}
        projects={projects}
        projectSprints={projectSprints}
        currentSprintNo={currentSprintNo}
        lang={lang}
        t={t}
        agendaOpen={agendaOpen}
        setAgendaOpen={setAgendaOpen}
        opSprintName={opSprintName}
      />

      {/* Sprint header card */}
      {viewMeta && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-5 shadow-sm">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">
                Sprint {viewSprintNo}
                {viewSprintNo === currentSprintNo && (
                  <span className="ml-2 text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 px-2 py-0.5 rounded-full font-semibold">{t('sprint.in_progress')}</span>
                )}
                {viewSprintNo < currentSprintNo && (
                  <span className="ml-2 text-xs bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 px-2 py-0.5 rounded-full font-semibold">{t('sprint.completed')}</span>
                )}
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {format(new Date(viewMeta.start), 'd MMM yyyy')} – {format(new Date(viewMeta.end), 'd MMM yyyy')}
              </p>
            </div>
            <div className="flex gap-6">
              {[
                { val: viewMeta.sessions, lbl: t('sprint.sessions') },
                { val: viewMeta.dates.length, lbl: t('sprint.active_days') },
                { val: projectsInSprint.length, lbl: t('sprint.projects') },
              ].map(({ val, lbl }) => (
                <div key={lbl} className="text-center">
                  <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{val}</div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide">{lbl}</div>
                </div>
              ))}
            </div>
          </div>

          {viewSprintNo < currentSprintNo && sprintMeta[viewSprintNo + 1] && (
            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-400">
              {t('sprint.reviewed_suffix')} Sprint {viewSprintNo + 1} ({format(new Date(sprintMeta[viewSprintNo + 1].start), 'd MMM')})
            </div>
          )}
        </div>
      )}

      {/* GCal events */}
      {allEvents.length > 0 && (
        <div className="mb-5">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-3">{t('sprint.upcoming_events')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {allEvents.slice(0, 6).map(ev => {
              const evDate = parseISO(ev.start.substring(0, 10))
              const daysUntil = differenceInDays(evDate, startOfDay(new Date()))
              const isToday = daysUntil === 0
              const isSoon = daysUntil <= 2
              return (
                <div key={ev.id} className={`rounded-xl border p-3 ${isToday ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800' : isSoon ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800' : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700'}`}>
                  <div className="flex items-start gap-2">
                    <div className="flex-shrink-0 text-center min-w-[36px]">
                      <div className="text-[10px] font-bold text-gray-400 uppercase">{format(evDate, 'MMM')}</div>
                      <div className="text-lg font-bold leading-none text-gray-800 dark:text-gray-200">{format(evDate, 'd')}</div>
                      <div className="text-[9px] text-gray-400">{format(evDate, 'EEE')}</div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 leading-snug">{ev.summary}</p>
                      {ev.start.length > 10 && (
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {new Date(ev.start).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                          {ev.end && ` – ${new Date(ev.end).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`}
                        </p>
                      )}
                      {ev.description && (
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 leading-relaxed line-clamp-2"
                          dangerouslySetInnerHTML={{ __html: ev.description.replace(/<[^>]+>/g, '').substring(0, 120) + (ev.description.length > 120 ? '…' : '') }} />
                      )}
                      {ev.calendarName && <p className="text-[9px] text-gray-400 mt-1">{ev.calendarName}</p>}
                    </div>
                    <div className="flex-shrink-0">
                      {isToday && <span className="text-[9px] font-bold text-red-600 bg-red-100 dark:bg-red-900 px-1.5 py-0.5 rounded-full">{t('sprint.today')}</span>}
                      {!isToday && daysUntil === 1 && <span className="text-[9px] font-bold text-amber-600 bg-amber-100 dark:bg-amber-900 px-1.5 py-0.5 rounded-full">{t('sprint.tomorrow')}</span>}
                      {!isToday && daysUntil > 1 && <span className="text-[9px] text-gray-400">{daysUntil}d</span>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {projectsInSprint.length === 0 && (
        <p className="text-sm text-gray-400 italic text-center py-16">{t('sprint.no_sessions')}</p>
      )}

      <div className="space-y-3">
        {projectsInSprint.map((proj) => {
          const sessions = projectSprints[proj.id]?.[viewSprintNo] ?? []
          const isCollapsed = collapsed[proj.id] ?? true
          return (
            <div key={proj.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
              <button
                onClick={() => toggleProject(proj.id)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-750 transition text-left"
              >
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm flex-shrink-0" style={{ background: proj.color }}>
                  {proj.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{proj.name}</p>
                  <p className="text-[11px] text-gray-400">{proj.desc}</p>
                </div>
                <span className="text-xs font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-full">
                  {sessions.length} {lang === 'id' ? 'aktivitas' : 'activities'}
                </span>
                <span className="text-gray-400 text-xs ml-1 transition-transform" style={{ transform: isCollapsed ? 'rotate(-90deg)' : '' }}>▾</span>
              </button>

              {!isCollapsed && (
                <div className="px-4 pb-4 space-y-2">
                  {sessions.map((s, i) => (
                    <div key={i} className="rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-700 p-3">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">{s.title}</p>
                        <div className="flex gap-1.5 flex-shrink-0 text-[10px] text-gray-400">
                          <span>{s.date}</span>
                          {s.time && <span>· {s.time}</span>}
                        </div>
                      </div>
                      {s.bullets.length > 0 && (
                        <ul className="space-y-1">
                          {s.bullets.slice(0, 4).map((b, j) => (
                            <li key={j} className="text-[11px] text-gray-600 dark:text-gray-400 pl-3 border-l-2 border-gray-200 dark:border-gray-600 leading-relaxed">{b}</li>
                          ))}
                          {s.bullets.length > 4 && (
                            <li className="text-[10px] text-gray-400 italic pl-3">+{s.bullets.length - 4} {lang === 'id' ? 'lainnya' : 'more'}</li>
                          )}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

type Tab = 'overview' | 'worklog' | 'plan'

export default function SprintView({ projectSprints, sprintMeta, currentSprintNo, viewSprintNo, projects, onNavigate }: Props) {
  const { t, lang } = useI18n()
  const [tab, setTab] = useState<Tab>('overview')
  const [reviewEvent, setReviewEvent] = useState<CalendarEvent | null>(null)
  const [agendaOpen, setAgendaOpen] = useState(false)
  const [allEvents, setAllEvents] = useState<CalendarEvent[]>([])
  const [overviewData, setOverviewData] = useState<OverviewData | null>(null)
  const [overviewLoading, setOverviewLoading] = useState(true)

  useEffect(() => {
    fetch('/api/calendar/events?days=30')
      .then(r => r.json())
      .then(d => {
        if (d.connected && d.events?.length) {
          setReviewEvent(d.events[0])
          setAllEvents(d.events)
        }
      })
      .catch(() => {})
  }, [])

  // Fetch overview using actual date range from sprintMeta — avoids ISL/OP number mismatch
  useEffect(() => {
    const meta = sprintMeta[viewSprintNo]
    if (!meta) return
    const startDate = new Date(meta.start).toISOString().split('T')[0]
    const endDate   = new Date(meta.end).toISOString().split('T')[0]
    setOverviewLoading(true)
    fetch(`/api/sprint/overview?startDate=${startDate}&endDate=${endDate}`)
      .then(r => r.json())
      .then(d => { setOverviewData(d); setOverviewLoading(false) })
      .catch(() => setOverviewLoading(false))
  }, [viewSprintNo, sprintMeta])

  // Reset to overview when sprint changes
  useEffect(() => { setTab('overview') }, [viewSprintNo])

  const sprintNos = Object.keys(sprintMeta).map(Number).sort((a, b) => b - a)

  // Build ISL sprint → OP sprint name map using date overlap
  type OpSprintEntry = { id: number; name: string; startDate: string; endDate: string; isCurrent: boolean }
  const opSprintByIsl: Record<number, string> = {}
  if (overviewData?.allSprints?.length) {
    for (const sno of sprintNos) {
      const meta = sprintMeta[sno]
      const sd = new Date(meta.start).toISOString().split('T')[0]
      const ed = new Date(meta.end).toISOString().split('T')[0]
      const match = (overviewData.allSprints as OpSprintEntry[]).find(
        s => s.startDate <= ed && s.endDate >= sd
      )
      if (match) opSprintByIsl[sno] = match.name
    }
  }

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: 'overview', label: 'Overview', icon: '📊' },
    { id: 'worklog',  label: 'Work Log',  icon: '📝' },
    { id: 'plan',     label: 'Sprint Plan', icon: '🗓' },
  ]

  return (
    <div>
      {/* Sprint selector */}
      <div className="flex items-center gap-2 flex-wrap mb-5">
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">Sprint</span>
        {sprintNos.map((sno) => {
          const sm = sprintMeta[sno]
          const isView = sno === viewSprintNo
          const isCurrent = sno === currentSprintNo
          return (
            <button
              key={sno}
              onClick={() => onNavigate({ view: 'sprint', sprint: String(sno) })}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                isView
                  ? 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 dark:border-indigo-700'
                  : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400'
              }`}
            >
              {opSprintByIsl[sno] ?? `S${sno}`}
              <span className="font-normal text-[10px] ml-1">
                {format(new Date(sm.start), 'd MMM')}–{format(new Date(sm.end), 'd MMM')}
              </span>
              {isCurrent && <span className="ml-1 text-[9px] text-emerald-600 font-bold">{t('sprint.now')}</span>}
            </button>
          )
        })}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-5 border-b border-gray-200 dark:border-gray-700">
        {TABS.map(({ id, label, icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition -mb-px ${
              tab === id
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <span>{icon}</span>
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview' && <OverviewTab data={overviewData} loading={overviewLoading} />}
      {tab === 'worklog' && (
        <WorkLogTab
          projectSprints={projectSprints}
          sprintMeta={sprintMeta}
          currentSprintNo={currentSprintNo}
          viewSprintNo={viewSprintNo}
          projects={projects}
          lang={lang}
          t={t}
          reviewEvent={reviewEvent}
          allEvents={allEvents}
          agendaOpen={agendaOpen}
          setAgendaOpen={setAgendaOpen}
          opSprintName={overviewData?.sprint?.name}
        />
      )}
      {tab === 'plan' && (
        <div>
          <OpAgendaBanner
            reviewEvent={reviewEvent}
            agendaOpen={agendaOpen}
            setAgendaOpen={setAgendaOpen}
            t={t}
          />
          <SprintPlanView />
        </div>
      )}
    </div>
  )
}
