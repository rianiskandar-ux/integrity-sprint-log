'use client'

import { useState } from 'react'
import { useI18n } from '@/lib/i18n'

interface OPTask {
  id: number
  subject: string
  status?: string
  islStatus?: string
  type?: string
  assignee?: string | null
  assigneeId?: number | null
  sprintId?: number | null
  sprintName?: string | null
  source?: string[]
  userStoryId?: number | null
  isClosed?: boolean
  createdBy?: string | null
  updatedAt?: string | null
  project?: string
  projectId?: number
}

interface OPSprint { id: number; name: string; isCurrent: boolean; startDate: string; endDate: string }

type SprintBucket = { new: number; in_progress: number; on_hold: number; done: number; total: number }
interface SprintStats {
  sprint: { id: number; name: string; endDate: string }
  total: number; done: number; remaining: number; pct: number
  buckets: SprintBucket
  byProject: Record<string, SprintBucket & { projectTitle: string }>
}

interface Suggestion {
  summary: string[]
  recommendation: 'next-sprint' | 'keep' | 'backlog' | 'close'
  reasoning: string
  nextSprint: string | null
  nextSprintId: number | null
}

interface ISLSession {
  id: string
  date: string
  title: string
  bullets: string[]
  actualMins: number | null
  estimatedMins: number
  pushStatus: string
  createdAt: string
}

interface OPEntry {
  id: number
  hours: number
  comment: string
  date: string
  user: string
  ongoing: boolean
}

interface TaskLog {
  islSessions: ISLSession[]
  opEntries: OPEntry[]
}

type Decision = 'next-sprint' | 'keep' | 'backlog' | 'close' | null

const DECISION_STYLE: Record<string, string> = {
  'next-sprint': 'text-violet-600 bg-violet-50 dark:bg-violet-950 border-violet-200 dark:border-violet-800',
  'keep':        'text-emerald-600 bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-800',
  'backlog':     'text-amber-600 bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800',
  'close':       'text-gray-400 bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700',
}
const DECISION_LABEL: Record<string, string> = {
  'next-sprint': '→ Next Sprint',
  'keep':        '✓ Keep',
  'backlog':     '↓ Backlog',
  'close':       '✕ Close',
}

const ISL_DOT: Record<string, string> = {
  in_progress: 'bg-blue-400',
  on_hold:     'bg-amber-400',
  done:        'bg-emerald-400',
  new:         'bg-gray-300 dark:bg-gray-600',
}

function TaskRow({
  task, opUrl, nextSprintName, decision, onDecision, onToast, isActiveTimer, onSessionLogged,
}: {
  task: OPTask
  opUrl: string
  nextSprintName: string | null
  decision: Decision
  onDecision: (id: number, d: Decision) => void
  onToast: (msg: string) => void
  isActiveTimer: boolean
  onSessionLogged: () => void
}) {
  const { t } = useI18n()
  const [expanded, setExpanded]       = useState(false)
  const [suggest, setSuggest]         = useState<Suggestion | null>(null)
  const [suggesting, setSuggesting]   = useState(false)
  const [showLogForm, setShowLogForm] = useState(false)
  const [logForm, setLogForm]         = useState({ bullets: '', mins: '' })
  const [logging, setLogging]         = useState(false)
  const [showLog, setShowLog]         = useState(false)
  const [taskLog, setTaskLog]         = useState<TaskLog | null>(null)
  const [loadingLog, setLoadingLog]   = useState(false)

  async function loadLog() {
    if (taskLog) { setShowLog(v => !v); return }
    setLoadingLog(true)
    setShowLog(true)
    try {
      const r = await fetch(`/api/op/task-log?taskId=${task.id}`).then(r => r.json())
      setTaskLog(r)
    } catch { onToast(`❌ ${t('op_tasks.failed_load')}`) }
    setLoadingLog(false)
  }

  async function doSuggest(e: React.MouseEvent) {
    e.stopPropagation()
    setSuggesting(true)
    try {
      const r = await fetch('/api/op/suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id }),
      }).then(r => r.json())
      setSuggest(r)
      setExpanded(true)
    } catch { onToast('❌ AI suggest failed') }
    setSuggesting(false)
  }

  const dot = isActiveTimer ? 'bg-amber-400 animate-pulse' : (ISL_DOT[task.islStatus ?? 'new'] ?? 'bg-gray-300')
  const sources = task.source ?? []

  async function doLog() {
    const bullets = logForm.bullets.split('\n').map(b => b.trim()).filter(Boolean)
    if (!bullets.length) return
    setLogging(true)
    try {
      const r = await fetch('/api/isl/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:          `[OP] ${task.subject}`,
          bullets,
          actualMins:     parseInt(logForm.mins) || null,
          estimatedMins:  parseInt(logForm.mins) || 30,
          pushStatus:     'pushed',
          source:         'manual',
          needsValidation: false,
          opTaskId:       task.id,
        }),
      }).then(r => r.json())
      if (r.ok) {
        onToast(`✅ Logged to ISL — #${task.id}`)
        setLogForm({ bullets: '', mins: '' })
        setShowLogForm(false)
        onSessionLogged()
      } else {
        onToast('❌ Log failed')
      }
    } catch { onToast('❌ Log failed') }
    setLogging(false)
  }

  return (
    <div className={`group border-b border-gray-100 dark:border-gray-800 last:border-0 transition-colors ${
      decision ? 'bg-violet-50/40 dark:bg-violet-950/20' : 'hover:bg-gray-50/60 dark:hover:bg-gray-800/30'
    }`}>
      {/* Row */}
      <div className="flex items-center gap-3 px-4 py-2.5 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        {/* Status dot */}
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />

        {/* ID */}
        <a href={`${opUrl}/work_packages/${task.id}`} target="_blank" rel="noopener"
          onClick={e => e.stopPropagation()}
          className="font-mono text-[11px] font-bold text-indigo-400 hover:text-indigo-600 flex-shrink-0 w-12">
          #{task.id}
        </a>

        {/* Title */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <p className="text-[13px] text-gray-700 dark:text-gray-200 truncate leading-tight">{task.subject}</p>
          {isActiveTimer && (
            <span className="flex-shrink-0 text-[9px] font-bold text-amber-600 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 px-1.5 py-0.5 rounded-full animate-pulse">
              ⏱ running
            </span>
          )}
        </div>

        {/* Meta badges — only on hover or if notable */}
        <div className="flex items-center gap-1.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {task.sprintName && (
            <span className="text-[9px] text-violet-500 font-medium hidden sm:inline">{task.sprintName}</span>
          )}
          {sources.includes('accountable') && (
            <span className="text-[9px] text-orange-400 font-medium">acct</span>
          )}
        </div>

        {/* Decision select */}
        <select
          value={decision ?? ''}
          onChange={e => { e.stopPropagation(); onDecision(task.id, (e.target.value as Decision) || null) }}
          onClick={e => e.stopPropagation()}
          className={`text-[10px] font-semibold px-2 py-1 rounded border transition appearance-none cursor-pointer flex-shrink-0 ${
            decision ? DECISION_STYLE[decision] : 'text-gray-300 dark:text-gray-600 bg-transparent border-transparent hover:border-gray-200 dark:hover:border-gray-700'
          }`}>
          <option value="">—</option>
          <option value="next-sprint">→ Next{nextSprintName ? ` (${nextSprintName})` : ''}</option>
          <option value="keep">✓ Keep</option>
          <option value="backlog">↓ Backlog</option>
          <option value="close">✕ Close</option>
        </select>

        {/* AI button */}
        <button
          onClick={doSuggest}
          disabled={suggesting}
          className="text-[10px] text-purple-400 hover:text-purple-600 transition disabled:opacity-40 flex-shrink-0 font-medium">
          {suggesting ? '…' : 'AI'}
        </button>

        {/* Expand toggle */}
        <span className="text-[10px] text-gray-300 dark:text-gray-600 flex-shrink-0 w-3 text-center">
          {expanded ? '▾' : '▸'}
        </span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-3 pt-0 space-y-2 ml-4">
          {/* AI suggestion */}
          {suggest && (
            <div className={`rounded-lg border px-3 py-2 text-[11px] ${DECISION_STYLE[suggest.recommendation]}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-[9px] uppercase tracking-widest opacity-60">AI Suggest</span>
                <div className="flex items-center gap-2">
                  <span className="font-bold">{DECISION_LABEL[suggest.recommendation]}</span>
                  <button onClick={() => onDecision(task.id, suggest.recommendation)}
                    className="text-[9px] underline opacity-60 hover:opacity-100">apply</button>
                </div>
              </div>
              <ul className="space-y-0.5">
                {suggest.summary.map((b, i) => <li key={i} className="opacity-80">▸ {b}</li>)}
              </ul>
              <p className="mt-1 opacity-60 italic">{suggest.reasoning}</p>
              {decision && decision !== suggest.recommendation && (
                <p className="mt-1 opacity-70 font-medium">ℹ️ Decision berbeda dari saran AI — pilihan kamu yang berlaku.</p>
              )}
            </div>
          )}

          {/* Meta grid */}
          <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-[11px] text-gray-400 dark:text-gray-500">
            {task.assignee && <div><span className="text-gray-500 dark:text-gray-400">👤</span> {task.assignee}</div>}
            {task.createdBy && task.createdBy !== task.assignee && <div><span className="text-gray-500 dark:text-gray-400">✍️</span> {task.createdBy}</div>}
            {task.sprintName && <div><span className="text-gray-500 dark:text-gray-400">🗓</span> {task.sprintName}</div>}
            {task.type && <div><span className="text-gray-500 dark:text-gray-400">📎</span> {task.type}</div>}
            {task.status && <div><span className="text-gray-500 dark:text-gray-400">●</span> {task.status}</div>}
            {task.updatedAt && <div><span className="text-gray-500 dark:text-gray-400">🕐</span> {task.updatedAt.slice(0, 10)}</div>}
          </div>

          {/* View Log panel */}
          <div className="border-t border-gray-100 dark:border-gray-800 pt-2">
            <button onClick={loadLog}
              className="text-[10px] font-semibold text-teal-500 hover:text-teal-700 transition flex items-center gap-1">
              {loadingLog ? '⏳ Loading log…' : showLog ? '▾ Sembunyikan log' : '📋 Lihat activity log'}
            </button>

            {showLog && taskLog && (
              <div className="mt-2 space-y-3">
                {/* ISL Sessions */}
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-indigo-400 mb-1.5">
                    ISL Sessions ({taskLog.islSessions.length})
                  </p>
                  {taskLog.islSessions.length === 0 ? (
                    <p className="text-[10px] text-gray-400 italic">{t('op_tasks.no_isl')}</p>
                  ) : (
                    <div className="space-y-2">
                      {taskLog.islSessions.map(s => (
                        <div key={s.id} className="bg-indigo-50/60 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/40 rounded-lg px-3 py-2 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-200 truncate">{s.title}</p>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              {s.actualMins && (
                                <span className="text-[9px] text-indigo-500 font-medium">{s.actualMins}m</span>
                              )}
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                                s.pushStatus === 'pushed' ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-600' :
                                s.pushStatus === 'pending' ? 'bg-amber-100 dark:bg-amber-950 text-amber-600' :
                                'bg-gray-100 dark:bg-gray-800 text-gray-500'
                              }`}>{s.pushStatus}</span>
                              <span className="text-[9px] text-gray-400">{s.date}</span>
                            </div>
                          </div>
                          {s.bullets.length > 0 && (
                            <ul className="space-y-0.5">
                              {s.bullets.map((b, i) => (
                                <li key={i} className="text-[10px] text-gray-600 dark:text-gray-400 flex gap-1">
                                  <span className="text-indigo-300 flex-shrink-0">▸</span>
                                  <span>{b}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* OP Time Entries */}
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-violet-400 mb-1.5">
                    OP Time Entries ({taskLog.opEntries.length})
                  </p>
                  {taskLog.opEntries.length === 0 ? (
                    <p className="text-[10px] text-gray-400 italic">{t('op_tasks.no_timelog')}</p>
                  ) : (
                    <div className="space-y-1.5">
                      {taskLog.opEntries.map(e => (
                        <div key={e.id} className="flex items-start gap-2 bg-violet-50/60 dark:bg-violet-950/20 border border-violet-100 dark:border-violet-900/40 rounded-lg px-3 py-1.5">
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] text-gray-600 dark:text-gray-400 truncate">
                              {e.comment || <span className="italic opacity-50">no comment</span>}
                            </p>
                            <p className="text-[9px] text-gray-400 mt-0.5">👤 {e.user}</p>
                          </div>
                          <div className="flex flex-col items-end flex-shrink-0 gap-0.5">
                            <span className="text-[10px] font-bold text-violet-600 dark:text-violet-400">
                              {e.hours > 0 ? `${e.hours}h` : '—'}
                              {e.ongoing && <span className="ml-1 text-amber-500 animate-pulse">●</span>}
                            </span>
                            <span className="text-[9px] text-gray-400">{e.date}</span>
                          </div>
                        </div>
                      ))}
                      {/* Total OP hours */}
                      <div className="flex items-center justify-end gap-1 pt-0.5">
                        <span className="text-[9px] text-gray-400">Total OP:</span>
                        <span className="text-[10px] font-bold text-violet-600 dark:text-violet-400">
                          {taskLog.opEntries.reduce((sum, e) => sum + e.hours, 0).toFixed(1)}h
                        </span>
                        {taskLog.islSessions.length > 0 && (
                          <>
                            <span className="text-[9px] text-gray-400 ml-2">Total ISL:</span>
                            <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400">
                              {Math.round(taskLog.islSessions.reduce((sum, s) => sum + (s.actualMins ?? 0), 0) / 60 * 10) / 10}h
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Quick log to ISL */}
          <div className="border-t border-gray-100 dark:border-gray-800 pt-2">
            {!showLogForm ? (
              <button onClick={() => setShowLogForm(true)}
                className="text-[10px] font-semibold text-indigo-500 hover:text-indigo-700 transition flex items-center gap-1">
                ✏️ Log activity ke ISL{isActiveTimer ? ' (timer aktif)' : ''}
              </button>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold text-gray-600 dark:text-gray-300">
                    ✏️ Log ke ISL — <span className="font-mono text-indigo-400">#{task.id}</span>
                  </p>
                  <button onClick={() => setShowLogForm(false)} className="text-[10px] text-gray-300 hover:text-gray-500">✕</button>
                </div>
                <textarea
                  value={logForm.bullets}
                  onChange={e => setLogForm(p => ({ ...p, bullets: e.target.value }))}
                  rows={3}
                  placeholder={"Apa yang dikerjakan di task ini?\nSatu baris = satu bullet point\nContoh: Fixed subscription webhook handler"}
                  className="w-full text-[11px] border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-400 font-mono resize-none"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={logForm.mins}
                    onChange={e => setLogForm(p => ({ ...p, mins: e.target.value }))}
                    placeholder="durasi (menit)"
                    min="1"
                    className="w-36 text-[11px] border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                  <button
                    onClick={doLog}
                    disabled={!logForm.bullets.trim() || logging}
                    className="px-3 py-1.5 text-[10px] font-bold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-40">
                    {logging ? '…' : t('op_tasks.save_to_isl')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function SprintBucketBar({ b, label }: { b: SprintBucket; label: string }) {
  const pct = b.total > 0 ? Math.round(b.done / b.total * 100) : 0
  return (
    <div className="bg-gradient-to-r from-violet-50/80 to-indigo-50/80 dark:from-violet-950/30 dark:to-indigo-950/30 border border-violet-100 dark:border-violet-900/50 rounded-xl px-4 py-2.5 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-violet-600 dark:text-violet-400 uppercase tracking-wide">{label}</span>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-gray-400">{b.total} total</span>
          <span className="text-gray-300 dark:text-gray-600">·</span>
          <span className="text-gray-400">{b.total - b.done} remaining</span>
          <span className="font-bold text-emerald-600 dark:text-emerald-400">{pct}%</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {b.new         > 0 && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 flex items-center gap-1"><span className="w-1 h-1 rounded-full bg-gray-400 inline-block" />{b.new} New</span>}
        {b.in_progress > 0 && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950 text-blue-600 flex items-center gap-1"><span className="w-1 h-1 rounded-full bg-blue-500 inline-block" />{b.in_progress} In Progress</span>}
        {b.on_hold     > 0 && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950 text-amber-600 flex items-center gap-1"><span className="w-1 h-1 rounded-full bg-amber-400 inline-block" />{b.on_hold} On Hold</span>}
        {b.done        > 0 && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950 text-emerald-600 flex items-center gap-1"><span className="w-1 h-1 rounded-full bg-emerald-500 inline-block" />{b.done} Closed</span>}
        <div className="flex-1 min-w-16 bg-gray-200 dark:bg-gray-700 rounded-full h-1 overflow-hidden ml-1">
          <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  )
}

export default function MyOPTasksTab({
  openTasks, closedTasks, sprints, opUrl, onToast, modeLabel, sprintStats, activeTimerTaskId, onSessionLogged,
}: {
  openTasks: OPTask[]
  closedTasks: OPTask[]
  sprints: OPSprint[]
  opUrl: string
  onToast: (msg: string) => void
  modeLabel?: string | null
  sprintStats?: SprintStats | null
  activeTimerTaskId?: number | null
  onSessionLogged?: () => void
}) {
  const { t } = useI18n()
  const [tab, setTab]             = useState<'open' | 'closed'>('open')
  const [projectFilter, setProjectFilter] = useState<string>('all')
  const [sourceFilter, setSourceFilter]   = useState<'all' | 'assigned' | 'accountable' | 'authored'>('all')
  const [decisions, setDecisions] = useState<Record<number, Decision>>({})
  const [showPlan, setShowPlan]   = useState(false)

  // Dedupe sprints
  const sprintList = Array.from(new Map(sprints.map(s => [s.id, s])).values())
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
  const currentSprint = sprintList.find(s => s.isCurrent) ?? null
  const nextSprint    = sprintList
    .filter(s => !s.isCurrent && s.startDate > (currentSprint?.startDate ?? ''))
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null

  // Sprint filter — default to current sprint id
  const [sprintFilter, setSprintFilter] = useState<number | 'all'>(currentSprint?.id ?? 'all')

  const allTasks    = [...openTasks, ...closedTasks]
  const projects    = Array.from(new Map(allTasks.filter(t => t.project).map(t => [t.project!, t.project!])).values()).sort()

  function setDecision(id: number, d: Decision) {
    setDecisions(prev => ({ ...prev, [id]: d }))
  }

  // For closed tasks: OP removes version on close, so don't filter by sprintId — show all
  const tasks = tab === 'open' ? openTasks : closedTasks

  const filtered = tasks.filter(t => {
    if (tab === 'open' && sprintFilter !== 'all' && t.sprintId !== sprintFilter) return false
    // closed tasks: don't filter by sprint (OP removes version on close)
    if (projectFilter !== 'all' && t.project !== projectFilter) return false
    if (sourceFilter !== 'all' && !(t.source ?? []).includes(sourceFilter)) return false
    return true
  })

  // Real OP counts from sprintStats (accurate, not just "my tasks")
  const getOpCount = (type: 'open' | 'closed') => {
    if (!sprintStats || sprintFilter !== sprintStats.sprint.id) return null
    const bucket = projectFilter !== 'all'
      ? Object.entries(sprintStats.byProject).find(([k, v]) => k === projectFilter || v.projectTitle.toLowerCase().replace(/[\s'/]/g, '-') === projectFilter.replace(/'/g, ''))?.[1]
      : sprintStats.buckets
    if (!bucket) return null
    return type === 'open' ? (bucket.new + bucket.in_progress + bucket.on_hold) : bucket.done
  }
  const opOpenCount   = getOpCount('open')
  const opClosedCount = getOpCount('closed')

  const pendingDecisions = Object.entries(decisions).filter(([, d]) => d !== null)
  const groupedDecisions: Record<string, { id: number; subject: string }[]> = {}
  for (const [idStr, d] of pendingDecisions) {
    const id   = Number(idStr)
    const task = allTasks.find(t => t.id === id)
    if (!task || !d) continue
    if (!groupedDecisions[d]) groupedDecisions[d] = []
    groupedDecisions[d].push({ id, subject: task.subject })
  }

  return (
    <div className="space-y-3">

      {/* TEST mode notice */}
      {modeLabel && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-[10px] text-amber-600 dark:text-amber-400">
          {t('op_tasks.test_mode', { project: modeLabel.replace('TEST · ', '') })}
        </div>
      )}

      {/* Top bar: open/closed + plan button */}
      <div className="flex items-center gap-3">
        <div className="flex gap-0 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden text-[11px] font-semibold">
          {(['open', 'closed'] as const).map(t => {
            const count = t === 'open'
              ? (opOpenCount !== null ? opOpenCount : filtered.length)
              : (opClosedCount !== null ? opClosedCount : closedTasks.length)
            const isOp  = t === 'open' ? opOpenCount !== null : opClosedCount !== null
            return (
              <button key={t} onClick={() => setTab(t)}
                className={`px-3 py-1.5 transition ${
                  tab === t ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                }`}>
                {t === 'open' ? 'Open' : 'Closed'} {count}
                {!isOp && sprintFilter === 'all' && <span className="ml-0.5 opacity-40 text-[8px]">*</span>}
              </button>
            )
          })}
        </div>

        {/* Project tabs */}
        {projects.length > 1 && (
          <div className="flex gap-1 flex-1 flex-wrap">
            <button onClick={() => setProjectFilter('all')}
              className={`px-2.5 py-1 text-[10px] rounded-full font-medium transition ${
                projectFilter === 'all' ? 'bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
              }`}>
              All
            </button>
            {projects.map(p => (
              <button key={p} onClick={() => setProjectFilter(p)}
                className={`px-2.5 py-1 text-[10px] rounded-full font-medium transition capitalize ${
                  projectFilter === p ? 'bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                }`}>
                {p.replace(/-/g, ' ')}
              </button>
            ))}
          </div>
        )}

        <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
          {/* Sprint filter dropdown */}
          <select
            value={sprintFilter}
            onChange={e => setSprintFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            className="text-[10px] font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 cursor-pointer focus:outline-none focus:ring-1 focus:ring-violet-400">
            <option value="all">All Sprints</option>
            {currentSprint && (
              <option value={currentSprint.id}>● {currentSprint.name} (current)</option>
            )}
            {nextSprint && (
              <option value={nextSprint.id}>→ {nextSprint.name} (next)</option>
            )}
            {sprintList
              .filter(s => s.id !== currentSprint?.id && s.id !== nextSprint?.id)
              .slice(0, 8)
              .map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))
            }
          </select>

          {/* Source filter */}
          <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value as typeof sourceFilter)}
            className="text-[10px] text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 cursor-pointer focus:outline-none">
            <option value="all">All roles</option>
            <option value="assigned">Assigned</option>
            <option value="accountable">Accountable</option>
            <option value="authored">Author</option>
          </select>

          {pendingDecisions.length > 0 ? (
            <button onClick={() => setShowPlan(!showPlan)}
              className="px-2.5 py-1.5 text-[10px] font-bold text-violet-600 border border-violet-300 dark:border-violet-700 rounded-lg hover:bg-violet-50 dark:hover:bg-violet-950 transition">
              📋 {pendingDecisions.length}
            </button>
          ) : (
            <div className="w-8" /> // placeholder to keep layout stable
          )}
        </div>
      </div>

      {/* Count + active filters hint */}
      <div className="flex items-center gap-2 px-1">
        <p className="text-[10px] text-gray-400">{filtered.length} tasks</p>
        {sprintFilter === 'all' && (
          <span className="text-[9px] text-amber-500 font-medium">* semua sprint (cache) — pilih sprint untuk data OP real</span>
        )}
        {sprintFilter !== 'all' && (
          <span className="text-[10px] text-violet-500 font-medium">
            🗓 {sprintList.find(s => s.id === sprintFilter)?.name ?? `Sprint #${sprintFilter}`}
          </span>
        )}
        {sprintFilter !== 'all' && (
          <button onClick={() => setSprintFilter('all')}
            className="text-[9px] text-gray-300 hover:text-gray-500 transition">✕ clear</button>
        )}
      </div>

      {/* Per-tab sprint stats banner — only when filtering by current sprint */}
      {sprintStats && sprintFilter === sprintStats.sprint.id && (() => {
        // Pick the right bucket: per-project if a project tab is selected, else overall
        if (projectFilter === 'all') {
          return <SprintBucketBar b={sprintStats.buckets} label={`${sprintStats.sprint.name} — All Projects`} />
        }
        // Find matching project key in byProject — match by identifier (slug) or title
        const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        const entry = Object.entries(sprintStats.byProject).find(
          ([, v]) => slug(v.projectTitle) === slug(projectFilter) ||
                     v.projectTitle.toLowerCase().includes(projectFilter.replace(/-/g, ' ').split(' ')[0])
        )
        if (!entry) return null
        const [, bucket] = entry
        return <SprintBucketBar b={bucket} label={`${sprintStats.sprint.name} — ${bucket.projectTitle}`} />
      })()}

      {/* Pending decisions panel */}
      {showPlan && pendingDecisions.length > 0 && (
        <div className="bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-violet-700 dark:text-violet-300">📋 Sprint Plan</p>
            <button onClick={() => { setDecisions({}); setShowPlan(false) }}
              className="text-[10px] text-gray-400 hover:text-gray-600">Clear all</button>
          </div>
          <p className="text-[10px] text-violet-500">Review di bawah lalu apply manual di OP. ISL tidak auto-move task.</p>
          {Object.entries(groupedDecisions).map(([decision, items]) => (
            <div key={decision}>
              <p className={`text-[10px] font-bold mb-1 px-2 py-0.5 rounded inline-block border ${DECISION_STYLE[decision]}`}>
                {DECISION_LABEL[decision]}
              </p>
              <ul className="space-y-1">
                {items.map(({ id, subject }) => (
                  <li key={id} className="flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-400">
                    <a href={`${opUrl}/work_packages/${id}`} target="_blank" rel="noopener"
                      className="font-mono font-bold text-indigo-500 hover:underline flex-shrink-0">#{id}</a>
                    <span className="truncate">{subject}</span>
                    <button onClick={() => setDecision(id, null)} className="text-[9px] text-gray-300 hover:text-red-400 flex-shrink-0">✕</button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {nextSprint && (
            <p className="text-[10px] text-violet-400">Next Sprint = <strong>{nextSprint.name}</strong> (starts {nextSprint.startDate})</p>
          )}
        </div>
      )}

      {/* Task list */}
      {filtered.length === 0 ? (
        <div className="text-center text-gray-400 text-sm py-10">No tasks found.</div>
      ) : (
        <div className="border border-gray-100 dark:border-gray-800 rounded-xl overflow-hidden">
          {filtered.map(task => (
            <TaskRow
              key={task.id}
              task={task}
              opUrl={opUrl}
              nextSprintName={nextSprint?.name ?? null}
              decision={decisions[task.id] ?? null}
              onDecision={setDecision}
              onToast={onToast}
              isActiveTimer={activeTimerTaskId === task.id}
              onSessionLogged={onSessionLogged ?? (() => {})}
            />
          ))}
        </div>
      )}
    </div>
  )
}
