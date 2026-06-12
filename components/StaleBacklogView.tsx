'use client'

import { useState, useEffect } from 'react'

interface StaleTask {
  id: number
  subject: string
  status?: string
  islStatus?: string
  type?: string
  assignee?: string | null
  assigneeId?: number | null
  createdBy?: string | null
  versionName?: string
  sprintName?: string | null
  sprintId?: number | null
  projectId?: string
  href?: string
  updatedAt?: string
  source?: string[]
}

interface OPSprint { id: number; name: string; isCurrent: boolean; startDate: string; endDate: string }

interface Suggestion {
  summary: string[]
  recommendation: 'next-sprint' | 'keep' | 'backlog' | 'close'
  reasoning: string
  nextSprint: string | null
  nextSprintId: number | null
}

type Decision = 'next-sprint' | 'keep' | 'backlog' | 'close' | null

const RECOMMEND_STYLE: Record<string, string> = {
  'next-sprint': 'text-violet-600 bg-violet-50 dark:bg-violet-950 border-violet-200 dark:border-violet-800',
  'keep':        'text-emerald-600 bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-800',
  'backlog':     'text-amber-600 bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800',
  'close':       'text-gray-500 bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700',
}
const RECOMMEND_LABEL: Record<string, string> = {
  'next-sprint': '→ Next Sprint',
  'keep':        '✓ Keep Current',
  'backlog':     '↓ Backlog',
  'close':       '✕ Close',
}

const ISL_DOT: Record<string, string> = {
  in_progress: 'bg-blue-500',
  on_hold:     'bg-amber-400',
  done:        'bg-emerald-500',
  new:         'bg-gray-300',
}

const TYPE_LABELS: Record<string, string> = {
  Epic: '🟣',
  'User Story': '🔵',
  Task: '⬜',
}

function TaskCard({
  task, opUrl, nextSprintName, decision, onDecision, onToast,
}: {
  task: StaleTask
  opUrl: string
  nextSprintName: string | null
  decision: Decision
  onDecision: (id: number, d: Decision) => void
  onToast: (msg: string) => void
}) {
  const [expanded, setExpanded]     = useState(false)
  const [suggest, setSuggest]       = useState<Suggestion | null>(null)
  const [suggesting, setSuggesting] = useState(false)

  async function doSuggest() {
    setSuggesting(true)
    try {
      const r = await fetch('/api/op/suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id }),
      }).then(r => r.json())
      setSuggest(r)
      if (!expanded) setExpanded(true)
    } catch { onToast('❌ AI suggest failed') }
    setSuggesting(false)
  }

  const dot = ISL_DOT[task.islStatus ?? 'new'] ?? 'bg-gray-300'
  const typeIcon = TYPE_LABELS[task.type ?? 'Task'] ?? '⬜'

  return (
    <div className={`bg-white dark:bg-gray-900 rounded-xl border overflow-hidden transition ${
      decision ? 'border-violet-200 dark:border-violet-800' : 'border-gray-200 dark:border-gray-700'
    }`}>
      <div className="flex items-start gap-3 px-4 py-3">
        <button onClick={() => setExpanded(!expanded)} className="flex-shrink-0 mt-0.5 text-gray-300 hover:text-gray-500 transition text-xs">
          {expanded ? '▼' : '▶'}
        </button>

        <span className={`flex-shrink-0 w-2 h-2 rounded-full mt-1.5 ${dot}`} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <a href={`${opUrl}/work_packages/${task.id}`} target="_blank" rel="noopener"
              onClick={e => e.stopPropagation()}
              className="text-[11px] font-mono font-bold text-indigo-400 hover:text-indigo-600 flex-shrink-0">
              #{task.id}
            </a>
            <span className="text-[10px] text-gray-400">{typeIcon} {task.type}</span>
            {task.status && (
              <span className="text-[10px] text-gray-400 bg-gray-50 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                {task.status}
              </span>
            )}
            {task.versionName && (
              <span className="text-[10px] text-violet-500 bg-violet-50 dark:bg-violet-950 px-1.5 py-0.5 rounded">
                🗓 {task.versionName}
              </span>
            )}
          </div>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 mt-0.5 leading-snug">{task.subject}</p>
          <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-400 flex-wrap">
            {task.assignee && <span>👤 {task.assignee}</span>}
            {task.createdBy && task.createdBy !== task.assignee && <span>✍️ {task.createdBy}</span>}
            {task.updatedAt && <span>🕐 {task.updatedAt.slice(0, 10)}</span>}
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={doSuggest}
            disabled={suggesting}
            className="px-2 py-1 text-[10px] font-semibold text-purple-600 border border-purple-200 dark:border-purple-800 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-950 transition disabled:opacity-50">
            {suggesting ? '⏳' : '✨ AI'}
          </button>

          <select
            value={decision ?? ''}
            onChange={e => onDecision(task.id, (e.target.value as Decision) || null)}
            className={`text-[10px] font-semibold px-2 py-1 rounded-lg border transition appearance-none cursor-pointer ${
              decision ? RECOMMEND_STYLE[decision] : 'text-gray-400 bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700'
            }`}>
            <option value="">Plan…</option>
            <option value="next-sprint">→ Next Sprint{nextSprintName ? ` (${nextSprintName})` : ''}</option>
            <option value="keep">✓ Keep Current Sprint</option>
            <option value="backlog">↓ Move to Backlog</option>
            <option value="close">✕ Mark for Closing</option>
          </select>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-50 dark:border-gray-800 px-4 py-3 space-y-3">
          {suggest && (
            <div className={`rounded-lg border px-3 py-2.5 ${RECOMMEND_STYLE[suggest.recommendation]}`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wide">✨ AI Suggestion</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${RECOMMEND_STYLE[suggest.recommendation]}`}>
                  {RECOMMEND_LABEL[suggest.recommendation]}
                </span>
              </div>
              <ul className="space-y-0.5 mb-1.5">
                {suggest.summary.map((b, i) => (
                  <li key={i} className="flex gap-1.5 text-[11px]">
                    <span className="opacity-50 flex-shrink-0">▸</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[10px] italic opacity-70">{suggest.reasoning}</p>
              {decision && decision !== suggest.recommendation && (
                <p className="text-[10px] mt-1.5 font-semibold opacity-80">
                  ℹ️ Your decision differs from AI suggestion — that's fine, you decide.
                </p>
              )}
              <button
                onClick={() => onDecision(task.id, suggest.recommendation)}
                className="mt-2 text-[10px] font-bold underline opacity-70 hover:opacity-100 transition">
                Apply AI suggestion
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-500 dark:text-gray-400">
            <div><span className="font-semibold text-gray-600 dark:text-gray-300">Type</span><br />{task.type ?? '—'}</div>
            <div><span className="font-semibold text-gray-600 dark:text-gray-300">Sprint</span><br />{task.versionName ?? 'Unassigned'}</div>
            <div><span className="font-semibold text-gray-600 dark:text-gray-300">Assignee</span><br />{task.assignee ?? '—'}</div>
            <div><span className="font-semibold text-gray-600 dark:text-gray-300">Author</span><br />{task.createdBy ?? '—'}</div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function StaleBacklogView({ onToast }: { onToast?: (msg: string) => void }) {
  const [tasks, setTasks]       = useState<StaleTask[]>([])
  const [sprints, setSprints]   = useState<OPSprint[]>([])
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState<'all' | 'epic' | 'story' | 'task'>('all')
  const [decisions, setDecisions] = useState<Record<number, Decision>>({})
  const [showPlan, setShowPlan] = useState(false)
  const [opUrl, setOpUrl]       = useState<string>('')

  useEffect(() => {
    fetch('/api/op/cache')
      .then(r => r.json())
      .then(d => {
        if (d._opUrl) setOpUrl(d._opUrl)
        const cache = d
        const sprintList: OPSprint[] = Array.from<OPSprint>(
          new Map<number, OPSprint>((cache.sprints ?? []).map((s: OPSprint) => [s.id, s])).values()
        )
        setSprints(sprintList)

        const currentSprint = sprintList.find(s => s.isCurrent)
        const currentVersionId = currentSprint?.id

        const epics: StaleTask[] = (cache.epics ?? []).map((e: StaleTask) => ({ ...e, type: 'Epic' }))

        const stories: StaleTask[] = (cache.userStories ?? [])
          .filter((s: { versionId?: number }) => s.versionId !== currentVersionId)
          .map((s: StaleTask) => ({ ...s, type: 'User Story' }))

        const openTasks: StaleTask[] = (cache.myOpenTasks ?? [])
          .filter((t: { sprintId?: number, islStatus?: string }) =>
            t.sprintId !== currentVersionId && t.islStatus !== 'abandoned'
          )
          .map((t: StaleTask) => ({ ...t, type: 'Task' }))

        const sprintCutoff = currentSprint?.startDate ?? ''
        const oldClosed: StaleTask[] = (cache.myClosedTasks ?? [])
          .filter((t: { updatedAt?: string, islStatus?: string }) =>
            (t.updatedAt ?? '').slice(0, 10) < sprintCutoff && t.islStatus !== 'abandoned'
          )
          .map((t: StaleTask) => ({ ...t, type: 'Task' }))

        const all = [...epics, ...stories, ...openTasks, ...oldClosed]
        const seen = new Set<number>()
        const deduped = all.filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true })
        setTasks(deduped)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const currentSprint = sprints.find(s => s.isCurrent)
  const nextSprint    = sprints
    .filter(s => !s.isCurrent && s.startDate > (currentSprint?.startDate ?? ''))
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0]

  function setDecision(id: number, d: Decision) {
    setDecisions(prev => ({ ...prev, [id]: d }))
  }

  const toast = onToast ?? ((msg: string) => console.log(msg))

  const filtered = tasks.filter(t => {
    if (filter === 'epic')  return t.type === 'Epic'
    if (filter === 'story') return t.type === 'User Story'
    if (filter === 'task')  return t.type === 'Task'
    return true
  })

  const epicsCount   = tasks.filter(t => t.type === 'Epic').length
  const storiesCount = tasks.filter(t => t.type === 'User Story').length
  const tasksCount   = tasks.filter(t => t.type === 'Task').length

  const pendingDecisions = Object.entries(decisions).filter(([, d]) => d !== null)
  const groupedDecisions: Record<string, { id: number; subject: string }[]> = {}
  for (const [idStr, d] of pendingDecisions) {
    const id   = Number(idStr)
    const task = tasks.find(t => t.id === id)
    if (!task || !d) continue
    if (!groupedDecisions[d]) groupedDecisions[d] = []
    groupedDecisions[d].push({ id, subject: task.subject })
  }

  if (loading) return (
    <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Loading…</div>
  )

  return (
    <div className="space-y-4">

      {/* Header + plan button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">🗃️ Old Tasks</h2>
          <p className="text-xs text-gray-400 mt-0.5">Past-sprint items — review &amp; plan what to do next</p>
        </div>
        {pendingDecisions.length > 0 && (
          <button onClick={() => setShowPlan(!showPlan)}
            className="px-3 py-1.5 text-[10px] font-bold text-violet-600 border border-violet-200 dark:border-violet-800 rounded-lg hover:bg-violet-50 dark:hover:bg-violet-950 transition flex-shrink-0">
            📋 Plan ({pendingDecisions.length})
          </button>
        )}
      </div>

      {/* Stats */}
      {tasks.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Epics',   count: epicsCount,   color: 'text-purple-600 dark:text-purple-400' },
            { label: 'Stories', count: storiesCount, color: 'text-blue-600 dark:text-blue-400' },
            { label: 'Tasks',   count: tasksCount,   color: 'text-gray-600 dark:text-gray-300' },
          ].map(({ label, count, color }) => (
            <div key={label} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 p-3">
              <div className={`text-lg font-bold ${color}`}>{count}</div>
              <div className="text-[10px] text-gray-500 mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Pending decisions panel */}
      {showPlan && pendingDecisions.length > 0 && (
        <div className="bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-violet-700 dark:text-violet-300">📋 Sprint Plan — Pending Decisions</p>
            <button onClick={() => { setDecisions({}); setShowPlan(false) }}
              className="text-[10px] text-gray-400 hover:text-gray-600 transition">Clear all</button>
          </div>
          <p className="text-[10px] text-violet-600 dark:text-violet-400">Review below then apply manually in OP. ISL doesn't auto-move tasks.</p>
          {Object.entries(groupedDecisions).map(([decision, items]) => (
            <div key={decision}>
              <p className={`text-[10px] font-bold mb-1.5 px-2 py-0.5 rounded inline-block ${RECOMMEND_STYLE[decision]}`}>
                {RECOMMEND_LABEL[decision]}
              </p>
              <ul className="space-y-1">
                {items.map(({ id, subject }) => (
                  <li key={id} className="flex items-center gap-2 text-[11px] text-gray-700 dark:text-gray-300">
                    <a href={`${opUrl}/work_packages/${id}`} target="_blank" rel="noopener"
                      className="font-mono font-bold text-indigo-500 hover:underline flex-shrink-0">
                      #{id}
                    </a>
                    <span className="truncate">{subject}</span>
                    <button onClick={() => setDecision(id, null)}
                      className="text-[9px] text-gray-400 hover:text-red-400 flex-shrink-0">✕</button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {nextSprint && (
            <p className="text-[10px] text-violet-500 mt-2">
              ℹ️ "Next Sprint" = <strong>{nextSprint.name}</strong> (starts {nextSprint.startDate})
            </p>
          )}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
        {([
          ['all',   `All (${tasks.length})`],
          ['epic',  `Epics (${epicsCount})`],
          ['story', `Stories (${storiesCount})`],
          ['task',  `Tasks (${tasksCount})`],
        ] as const).map(([f, label]) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-2 text-xs font-semibold border-b-2 transition -mb-px ${
              filter === f
                ? 'border-violet-500 text-violet-600 dark:text-violet-400'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* Task list */}
      {filtered.length === 0 ? (
        <div className="text-center text-gray-400 text-sm py-12">
          <div className="text-3xl mb-3">🗃️</div>
          <p>No old tasks found.</p>
          <p className="text-xs mt-1 text-gray-300 dark:text-gray-600">Sync OP cache to load data.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              opUrl={opUrl}
              nextSprintName={nextSprint?.name ?? null}
              decision={decisions[task.id] ?? null}
              onDecision={setDecision}
              onToast={toast}
            />
          ))}
        </div>
      )}
    </div>
  )
}
