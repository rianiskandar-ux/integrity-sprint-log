'use client'

import { useState, useEffect } from 'react'
import { useI18n } from '@/lib/i18n'

interface PendingSession {
  id: string
  sessionId?: string
  title: string
  bullets: string[]
  actualMins: number | null
  estimatedMins: number
  startedAt: string
  date: string
  opTaskId: number | null
  pushStatus: string
  needsValidation: boolean
  taskStatus: string
}

interface OPTask  { id: number; subject: string; project?: string; sprintId?: number | null }
interface OPStory { id: number; subject: string; epicId?: number | null }
interface OPEpic  { id: number; subject: string }
interface OPSprint { id: number; name: string; isCurrent: boolean; startDate: string }

interface OPCache {
  myOpenTasks?: OPTask[]
  userStories?: OPStory[]
  epics?: OPEpic[]
  sprints?: OPSprint[]
  watchedProjects?: { id: number; name: string; identifier: string }[]
}

// Fuzzy match session title to an OP task
function findSuggestedTask(title: string, bullets: string[], tasks: OPTask[]): OPTask | null {
  if (!tasks.length) return null
  const text = (title + ' ' + bullets.join(' ')).toLowerCase()
  const words = text.split(/\W+/).filter(w => w.length > 3 && !['this','that','with','from','have','will','been','into','more','than','when','make','task','work','done','setup','update','untuk','yang','dengan'].includes(w))
  let best: OPTask | null = null, bestScore = 0
  for (const t of tasks) {
    const score = words.filter(w => t.subject.toLowerCase().includes(w)).length
    if (score >= 2 && score > bestScore) { bestScore = score; best = t }
  }
  return best
}

const TYPE_OPTIONS = [
  { id: 1, label: 'Task' },
  { id: 4, label: 'Feature' },
  { id: 7, label: 'Bug' },
  { id: 6, label: 'User Story' },
]

interface NewTaskForm {
  subject: string
  projectId: number
  projectIdentifier: string
  parentId: number | null
  sprintId: number | null
  estimatedMins: number
  typeId: number
}

function SessionCard({
  session, cache, opUrl, onPushed, onDiscard, userId,
}: {
  session: PendingSession
  cache: OPCache
  opUrl: string
  onPushed: (id: string, taskId: number) => void
  onDiscard: (id: string) => void
  userId: number
}) {
  const { t } = useI18n()
  const [expanded, setExpanded]   = useState(false)
  const [mode, setMode]           = useState<'idle' | 'create' | 'link'>('idle')
  const [pushing, setPushing]     = useState(false)
  const [linkId, setLinkId]       = useState('')
  const [error, setError]         = useState<string | null>(null)

  const sprints = (cache.sprints ?? []).sort((a, b) => b.startDate.localeCompare(a.startDate))
  const currentSprint = sprints.find(s => s.isCurrent) ?? null
  const projects = cache.watchedProjects ?? []
  const defaultProject = projects[0] ?? { id: 12, name: "Integrity's Websites", identifier: 'integritys-websites' }

  const suggested = findSuggestedTask(session.title, session.bullets, cache.myOpenTasks ?? [])

  const [form, setForm] = useState<NewTaskForm>({
    subject:             session.title.slice(0, 120),
    projectId:           defaultProject.id,
    projectIdentifier:   defaultProject.identifier,
    parentId:            null,
    sprintId:            currentSprint?.id ?? null,
    estimatedMins:       session.actualMins ?? session.estimatedMins ?? 60,
    typeId:              1,
  })

  const mins = session.actualMins ?? session.estimatedMins ?? 30
  const h = Math.floor(mins / 60), m = mins % 60
  const dur = mins >= 60 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${mins}m`

  const stories = (cache.userStories ?? []).filter(s => {
    // Show stories from selected project (no direct project link in cache, show all)
    return true
  })

  // OP preview of the task that will be created
  const previewProject = projects.find(p => p.id === form.projectId) ?? defaultProject
  const previewParent  = form.parentId ? (cache.userStories ?? []).find(s => s.id === form.parentId) : null
  const previewSprint  = form.sprintId ? sprints.find(s => s.id === form.sprintId) : null
  const previewType    = TYPE_OPTIONS.find(t => t.id === form.typeId)?.label ?? 'Task'

  async function doPush(action: 'create_new' | 'link_existing') {
    setPushing(true); setError(null)
    try {
      const body: Record<string, unknown> = { sessionId: session.id, action }
      if (action === 'link_existing') {
        body.opTaskId = Number(linkId)
      } else {
        body.newTask = { ...form, userId }
      }
      const r = await fetch('/api/op/push-session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(r => r.json())
      if (r.error) throw new Error(r.error)
      onPushed(session.id, r.taskId)
    } catch (e) { setError(String(e)) }
    setPushing(false)
  }

  return (
    <div className={`border rounded-xl overflow-hidden transition-all ${
      mode !== 'idle' ? 'border-violet-200 dark:border-violet-800' : 'border-gray-200 dark:border-gray-700'
    }`}>
      {/* Header row */}
      <div className="flex items-start gap-3 px-4 py-3 cursor-pointer" onClick={() => setExpanded(v => !v)}>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-gray-800 dark:text-gray-100 leading-snug">{session.title}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] text-gray-400">{session.date}</span>
            <span className="text-[10px] text-indigo-500 font-medium">{dur}</span>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
              session.taskStatus === 'done'        ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-600' :
              session.taskStatus === 'in_progress' ? 'bg-blue-100 dark:bg-blue-950 text-blue-600' :
              'bg-gray-100 dark:bg-gray-800 text-gray-500'
            }`}>{session.taskStatus}</span>
          </div>
        </div>

        {/* Suggested match badge */}
        {suggested && mode === 'idle' && (
          <div className="flex-shrink-0 text-right">
            <p className="text-[9px] text-teal-500 font-semibold">Suggested match:</p>
            <p className="text-[10px] text-teal-600 dark:text-teal-400 font-medium">#{suggested.id}</p>
          </div>
        )}

        <span className="text-[10px] text-gray-300 dark:text-gray-600 flex-shrink-0">{expanded ? '▾' : '▸'}</span>
      </div>

      {/* Expanded bullets */}
      {expanded && session.bullets.length > 0 && (
        <div className="px-4 pb-2 space-y-0.5">
          {session.bullets.map((b, i) => (
            <p key={i} className="text-[11px] text-gray-500 dark:text-gray-400 flex gap-1.5">
              <span className="text-gray-300 flex-shrink-0">▸</span><span>{b}</span>
            </p>
          ))}
        </div>
      )}

      {/* Action bar */}
      {mode === 'idle' && (
        <div className="flex items-center gap-2 px-4 py-2.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/20">
          {suggested && (
            <button onClick={() => { setMode('link'); setLinkId(String(suggested.id)) }}
              className="text-[10px] font-semibold text-teal-600 hover:text-teal-800 transition px-2.5 py-1.5 rounded-lg border border-teal-200 dark:border-teal-800 hover:bg-teal-50 dark:hover:bg-teal-950">
              🔗 Link ke #{suggested.id}
            </button>
          )}
          <button onClick={() => setMode('create')}
            className="text-[10px] font-semibold text-violet-600 hover:text-violet-800 transition px-2.5 py-1.5 rounded-lg border border-violet-200 dark:border-violet-800 hover:bg-violet-50 dark:hover:bg-violet-950">
            {t('pushqueue.create_new')}
          </button>
          <button onClick={() => setMode('link')}
            className="text-[10px] text-gray-400 hover:text-gray-600 transition px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700">
            🔗 Link ke Task Lain
          </button>
          <button onClick={() => onDiscard(session.id)}
            className="text-[10px] text-gray-300 hover:text-red-400 transition ml-auto">
            Discard
          </button>
        </div>
      )}

      {/* Link existing form */}
      {mode === 'link' && (
        <div className="px-4 py-3 border-t border-violet-100 dark:border-violet-900 bg-violet-50/30 dark:bg-violet-950/10 space-y-3">
          <p className="text-[10px] font-bold text-violet-700 dark:text-violet-300">🔗 Link ke OP Task</p>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-500">#</span>
            <input
              value={linkId}
              onChange={e => setLinkId(e.target.value.replace(/\D/g, ''))}
              placeholder="Task ID dari OP"
              className="w-32 text-[11px] border border-violet-200 dark:border-violet-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-violet-400"
            />
            <a href={linkId ? `${opUrl}/work_packages/${linkId}` : '#'} target="_blank" rel="noopener"
              className="text-[10px] text-indigo-500 hover:underline">
              {linkId ? `Lihat #${linkId} ↗` : 'masukkan ID'}
            </a>
          </div>
          {error && <p className="text-[10px] text-red-500">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => doPush('link_existing')} disabled={!linkId || pushing}
              className="px-3 py-1.5 text-[10px] font-bold bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition disabled:opacity-40">
              {pushing ? '⏳ Linking…' : '🔗 Link & Log ke OP'}
            </button>
            <button onClick={() => { setMode('idle'); setError(null) }}
              className="text-[10px] text-gray-400 hover:text-gray-600 px-2">Cancel</button>
          </div>
        </div>
      )}

      {/* Create new form + preview */}
      {mode === 'create' && (
        <div className="px-4 py-3 border-t border-violet-100 dark:border-violet-900 bg-violet-50/30 dark:bg-violet-950/10 space-y-4">
          <p className="text-[10px] font-bold text-violet-700 dark:text-violet-300">{t('pushqueue.create_new')}</p>

          <div className="grid grid-cols-1 gap-3">
            {/* Subject */}
            <div>
              <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Subject</label>
              <input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                className="mt-1 w-full text-[12px] border border-violet-200 dark:border-violet-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-violet-400" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Type */}
              <div>
                <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Type</label>
                <select value={form.typeId} onChange={e => setForm(f => ({ ...f, typeId: Number(e.target.value) }))}
                  className="mt-1 w-full text-[11px] border border-violet-200 dark:border-violet-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-900 focus:outline-none">
                  {TYPE_OPTIONS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>

              {/* Project */}
              <div>
                <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Project</label>
                <select value={form.projectId} onChange={e => {
                  const p = projects.find(p => p.id === Number(e.target.value))
                  if (p) setForm(f => ({ ...f, projectId: p.id, projectIdentifier: p.identifier, parentId: null }))
                }}
                  className="mt-1 w-full text-[11px] border border-violet-200 dark:border-violet-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-900 focus:outline-none">
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              {/* Sprint */}
              <div>
                <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Sprint</label>
                <select value={form.sprintId ?? ''} onChange={e => setForm(f => ({ ...f, sprintId: e.target.value ? Number(e.target.value) : null }))}
                  className="mt-1 w-full text-[11px] border border-violet-200 dark:border-violet-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-900 focus:outline-none">
                  <option value="">No sprint</option>
                  {sprints.slice(0, 5).map(s => <option key={s.id} value={s.id}>{s.name}{s.isCurrent ? ' ●' : ''}</option>)}
                </select>
              </div>

              {/* Estimated */}
              <div>
                <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Estimated (mins)</label>
                <input type="number" value={form.estimatedMins} onChange={e => setForm(f => ({ ...f, estimatedMins: Number(e.target.value) }))}
                  className="mt-1 w-full text-[11px] border border-violet-200 dark:border-violet-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-900 focus:outline-none" />
              </div>
            </div>

            {/* Parent (User Story) */}
            <div>
              <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Parent / User Story (optional)</label>
              <select value={form.parentId ?? ''} onChange={e => setForm(f => ({ ...f, parentId: e.target.value ? Number(e.target.value) : null }))}
                className="mt-1 w-full text-[11px] border border-violet-200 dark:border-violet-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-900 focus:outline-none">
                <option value="">— No parent —</option>
                {stories.slice(0, 30).map(s => <option key={s.id} value={s.id}>#{s.id} {s.subject.slice(0, 60)}</option>)}
              </select>
            </div>
          </div>

          {/* OP Preview */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 space-y-2">
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Preview — struktur di OP</p>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-400 w-20 flex-shrink-0">Type</span>
                <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">{previewType}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-400 w-20 flex-shrink-0">Subject</span>
                <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-200 truncate">{form.subject}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-400 w-20 flex-shrink-0">Project</span>
                <span className="text-[11px] text-gray-600 dark:text-gray-300">{previewProject.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-400 w-20 flex-shrink-0">Sprint</span>
                <span className="text-[11px] text-gray-600 dark:text-gray-300">{previewSprint ? previewSprint.name : '—'}</span>
              </div>
              {previewParent && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400 w-20 flex-shrink-0">Parent</span>
                  <span className="text-[11px] text-gray-600 dark:text-gray-300">#{previewParent.id} {previewParent.subject.slice(0, 50)}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-400 w-20 flex-shrink-0">Estimated</span>
                <span className="text-[11px] text-gray-600 dark:text-gray-300">{Math.round(form.estimatedMins / 60 * 10) / 10}h</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-400 w-20 flex-shrink-0">Status</span>
                <span className="text-[11px] text-blue-600">In Progress</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-400 w-20 flex-shrink-0">Assignee</span>
                <span className="text-[11px] text-gray-600 dark:text-gray-300">Rian Iskandar</span>
              </div>
              <div className="mt-1 pt-1 border-t border-gray-100 dark:border-gray-800">
                <p className="text-[9px] text-gray-400 font-semibold mb-0.5">Description preview:</p>
                <p className="text-[10px] text-gray-500 font-mono">{`**${form.subject}**`}</p>
                {session.bullets.slice(0, 3).map((b, i) => (
                  <p key={i} className="text-[10px] text-gray-500 font-mono">{`- ${b}`}</p>
                ))}
                {session.bullets.length > 3 && <p className="text-[9px] text-gray-400">+{session.bullets.length - 3} more bullets</p>}
              </div>
            </div>
          </div>

          {error && <p className="text-[10px] text-red-500">{error}</p>}

          <div className="flex items-center gap-2">
            <button onClick={() => doPush('create_new')} disabled={!form.subject.trim() || pushing}
              className="px-4 py-1.5 text-[11px] font-bold bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition disabled:opacity-40">
              {pushing ? '⏳ Creating…' : '✚ Create & Push ke OP →'}
            </button>
            <button onClick={() => { setMode('idle'); setError(null) }}
              className="text-[10px] text-gray-400 hover:text-gray-600 px-2">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function PushQueueView() {
  const { t } = useI18n()
  const [sessions, setSessions]   = useState<PendingSession[]>([])
  const [cache, setCache]         = useState<OPCache>({})
  const [loading, setLoading]     = useState(true)
  const [opUrl, setOpUrl]         = useState('https://tokek.integrity-asia.com')
  const [userId, setUserId]       = useState(8)
  const [toast, setToast]         = useState<string | null>(null)
  const [pushed, setPushed]       = useState<Set<string>>(new Set())

  useEffect(() => {
    try {
      const s = localStorage.getItem('isl_settings')
      if (s) { const p = JSON.parse(s); if (p.opBaseUrl) setOpUrl(p.opBaseUrl) }
    } catch {}
    load()
  }, [])

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  async function load() {
    setLoading(true)
    try {
      const [sessRes, cacheRes] = await Promise.all([
        fetch('/api/isl/sessions?status=pending').then(r => r.json()),
        fetch('/api/op/cache').then(r => r.json()),
      ])
      // Also include sessions with needsValidation=true (from before the flow change)
      const allPending = (sessRes.sessions ?? []) as PendingSession[]
      setSessions(allPending.sort((a, b) => b.startedAt.localeCompare(a.startedAt)))
      setCache(cacheRes)
      if (cacheRes.userId) setUserId(cacheRes.userId)
    } catch {}
    setLoading(false)
  }

  function onPushed(id: string, taskId: number) {
    setPushed(prev => new Set([...prev, id]))
    setSessions(prev => prev.filter(s => s.id !== id))
    showToast(`✅ Pushed ke OP — task #${taskId}`)
  }

  async function onDiscard(id: string) {
    await fetch(`/api/isl/sessions/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pushStatus: 'discarded' }),
    }).catch(() => {})
    setSessions(prev => prev.filter(s => s.id !== id))
    showToast('🗑 Discarded dari queue')
  }

  const visible = sessions.filter(s => !pushed.has(s.id))

  if (loading) return <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Loading push queue…</div>

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-semibold px-4 py-2.5 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">📤 Push Queue</h2>
          <p className="text-xs text-gray-400 mt-0.5">ISL sessions yang belum masuk ke OP — review, edit, lalu push manual</p>
        </div>
        <button onClick={load} className="text-[10px] text-gray-400 hover:text-gray-600 border border-gray-200 dark:border-gray-700 px-2.5 py-1.5 rounded-lg flex-shrink-0">
          ↻ Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 text-[11px]">
        <span className="font-semibold text-amber-600 dark:text-amber-400">{visible.length} pending</span>
        {pushed.size > 0 && <span className="text-emerald-600 dark:text-emerald-400">✅ {pushed.size} pushed this session</span>}
      </div>

      {visible.length === 0 ? (
        <div className="text-center text-gray-400 py-16">
          <div className="text-4xl mb-3">✅</div>
          <p className="font-medium text-sm">Push queue kosong</p>
          <p className="text-xs mt-1 text-gray-300 dark:text-gray-600">Semua session sudah linked ke OP atau di-discard.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map(s => (
            <SessionCard
              key={s.id}
              session={s}
              cache={cache}
              opUrl={opUrl}
              onPushed={onPushed}
              onDiscard={onDiscard}
              userId={userId}
            />
          ))}
        </div>
      )}
    </div>
  )
}
