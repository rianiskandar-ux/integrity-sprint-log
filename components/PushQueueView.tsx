'use client'

import { useState, useEffect } from 'react'
import { useI18n } from '@/lib/i18n'
import { type TaskChatContext } from './TaskChatModal'
import ChatDock from './ChatDock'
import { Send, MessageCircle, Clock, Sparkles, Loader2, CheckCircle2, Link2, ChevronDown, ChevronRight, RefreshCw, Search, Plus } from 'lucide-react'

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
interface OPStory { id: number; subject: string; epicId?: number | null; project?: string; status?: string }
interface OPEpic  { id: number; subject: string }

// Parent picker. ISL creates a User Story (wrapping Tasks), so its parent must be
// one level UP — an Epic or Feature. We search Epic/Feature only (never US/Task),
// or let the user create a brand-new Epic/Feature parent inline.
function ParentPicker({ value, valueLabel, newParent, onChange, onNewParent, epics }: {
  value: number | null
  valueLabel?: string | null
  newParent: { subject: string; typeId: number } | null
  onChange: (id: number | null, label: string) => void
  onNewParent: (np: { subject: string; typeId: number } | null) => void
  epics: OPEpic[]
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [live, setLive] = useState<{ id: number; subject: string; type: string; project?: string }[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (q.trim().length < 2) { setLive([]); return }
    const t = setTimeout(() => {
      setSearching(true)
      fetch(`/api/op/search?q=${encodeURIComponent(q.trim())}`)
        .then(r => r.json())
        // Epic / Feature only — a User Story can't be a parent here
        .then(d => setLive(((d.results ?? []) as typeof live).filter(r => /^(epic|feature)$/i.test(r.type))))
        .catch(() => {})
        .finally(() => setSearching(false))
    }, 350)
    return () => clearTimeout(t)
  }, [q])

  // An existing Epic/Feature is selected
  if (value) {
    return (
      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] border border-violet-200 dark:border-violet-700 rounded-lg px-2 py-1.5 bg-violet-50/50 dark:bg-violet-950/20">
        <span className="truncate text-violet-800 dark:text-violet-200">✓ #{value} {valueLabel}</span>
        <button type="button" onClick={() => { onChange(null, ''); setQ('') }}
          className="text-[10px] font-bold text-gray-400 hover:text-red-500 flex-shrink-0">✕ ganti</button>
      </div>
    )
  }

  // Creating a new parent (Epic / Feature)
  if (newParent) {
    return (
      <div className="mt-1 flex items-center gap-1.5">
        <select value={newParent.typeId} onChange={e => onNewParent({ ...newParent, typeId: Number(e.target.value) })}
          className="text-[11px] border border-violet-200 dark:border-violet-700 rounded-lg px-1.5 py-1.5 bg-white dark:bg-gray-900">
          <option value={5}>Epic</option>
          <option value={4}>Feature</option>
        </select>
        <input value={newParent.subject} autoFocus onChange={e => onNewParent({ ...newParent, subject: e.target.value })}
          placeholder="Nama parent baru (Epic/Feature)…"
          className="flex-1 text-[11px] border border-violet-200 dark:border-violet-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-violet-300" />
        <button type="button" onClick={() => onNewParent(null)} className="text-[10px] font-bold text-gray-400 hover:text-red-500 flex-shrink-0 px-1">✕</button>
      </div>
    )
  }

  const ql = q.trim().toLowerCase()
  const localMatches = ql.length >= 2
    ? epics.filter(e => String(e.id).includes(ql) || e.subject.toLowerCase().includes(ql)).slice(0, 8)
    : []
  const localIds = new Set(localMatches.map(e => e.id))
  const merged = [
    ...localMatches.map(e => ({ id: e.id, subject: e.subject, type: 'Epic', project: '' })),
    ...live.filter(r => !localIds.has(r.id)).map(r => ({ id: r.id, subject: r.subject, type: r.type, project: r.project ?? '' })),
  ].slice(0, 12)

  return (
    <div className="relative mt-1">
      <div className="flex gap-1.5">
        <input
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Cari Epic / Feature (nama atau #id)…"
          className="flex-1 text-[11px] border border-violet-200 dark:border-violet-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-violet-300" />
        <button type="button" onClick={() => onNewParent({ subject: '', typeId: 5 })}
          className="text-[10px] font-bold text-violet-600 border border-violet-200 dark:border-violet-700 rounded-lg px-2 hover:bg-violet-50 dark:hover:bg-violet-950/30 whitespace-nowrap">
          + buat baru
        </button>
      </div>
      {open && ql.length >= 2 && (
        <div className="absolute z-30 mt-1 w-full max-h-60 overflow-y-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl">
          {merged.length === 0 ? (
            <p className="px-2 py-2 text-[10px] text-gray-400">{searching ? 'Mencari di OP…' : 'Tidak ada Epic/Feature — pakai "+ buat baru"'}</p>
          ) : merged.map(m => (
            <button key={`${m.id}-${m.type}`} type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onChange(m.id, m.subject.slice(0, 70)); setOpen(false); setQ('') }}
              className="w-full text-left px-2 py-1.5 hover:bg-violet-50 dark:hover:bg-violet-950/30 border-b border-gray-50 dark:border-gray-800 last:border-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-violet-100 dark:bg-violet-900 text-violet-600 dark:text-violet-300 flex-shrink-0">{m.type}</span>
                <span className="text-[11px] font-medium text-gray-800 dark:text-gray-100 truncate">#{m.id} {m.subject}</span>
              </div>
              {m.project && <div className="text-[9px] text-gray-400 truncate mt-0.5">{m.project}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
// Relation picker — search any WP type for a "relates to" non-hierarchical link
function RelationPicker({ value, valueLabel, onChange }: {
  value: number | null
  valueLabel?: string | null
  onChange: (id: number | null, label: string) => void
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [live, setLive] = useState<{ id: number; subject: string; type: string }[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (q.trim().length < 2) { setLive([]); return }
    const t = setTimeout(() => {
      setSearching(true)
      fetch(`/api/op/search?q=${encodeURIComponent(q.trim())}`)
        .then(r => r.json())
        .then(d => setLive((d.results ?? []).slice(0, 10)))
        .catch(() => {})
        .finally(() => setSearching(false))
    }, 350)
    return () => clearTimeout(t)
  }, [q])

  if (value) {
    return (
      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] border border-orange-200 dark:border-orange-800 rounded-lg px-2 py-1.5 bg-orange-50/50 dark:bg-orange-950/20">
        <span className="truncate text-orange-800 dark:text-orange-200">↗ #{value} {valueLabel}</span>
        <button type="button" onClick={() => { onChange(null, ''); setQ('') }}
          className="text-[10px] font-bold text-gray-400 hover:text-red-500 flex-shrink-0">✕ hapus</button>
      </div>
    )
  }

  return (
    <div className="relative mt-1">
      <input
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Cari task / US (nama atau #id)… kosongkan = tidak ada"
        className="w-full text-[11px] border border-orange-200 dark:border-orange-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-orange-300"
      />
      {open && q.trim().length >= 2 && (
        <div className="absolute z-30 mt-1 w-full max-h-48 overflow-y-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl">
          {live.length === 0 ? (
            <p className="px-2 py-2 text-[10px] text-gray-400">{searching ? 'Mencari di OP…' : 'Tidak ditemukan'}</p>
          ) : live.map(m => (
            <button key={m.id} type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onChange(m.id, m.subject.slice(0, 70)); setOpen(false); setQ('') }}
              className="w-full text-left px-2 py-1.5 hover:bg-orange-50 dark:hover:bg-orange-950/30 border-b border-gray-50 dark:border-gray-800 last:border-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-orange-100 dark:bg-orange-900 text-orange-600 dark:text-orange-300 flex-shrink-0">{m.type}</span>
                <span className="text-[11px] font-medium text-gray-800 dark:text-gray-100 truncate">#{m.id} {m.subject}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface OPSprint { id: number; name: string; isCurrent: boolean; startDate: string; endDate: string }

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

interface ActivitySegment { duration: number; note: string }

function bulletsToSegments(bullets: string[], totalMins: number): ActivitySegment[] {
  if (!bullets.length) return [{ duration: totalMins, note: '' }]
  // Weight each item by note length (a rough proxy for effort) so durations vary
  // naturally instead of a flat even split. Floor keeps short notes from going to ~0.
  const weights = bullets.map(b => Math.max(10, b.trim().length))
  const totalW  = weights.reduce((a, b) => a + b, 0)
  let allocated = 0
  return bullets.map((note, i) => {
    const d = i === bullets.length - 1
      ? Math.max(1, totalMins - allocated)                       // last gets remainder → exact sum
      : Math.max(1, Math.round(totalMins * weights[i] / totalW))
    if (i < bullets.length - 1) allocated += d
    return { duration: d, note }
  })
}

function segmentsToBullets(segs: ActivitySegment[]): string[] {
  return segs.filter(s => s.note.trim()).map(s => `[${s.duration}m] ${s.note.trim()}`)
}

interface NewTaskForm {
  subject: string
  projectId: number
  projectIdentifier: string
  parentId: number | null
  parentLabel?: string
  newParent?: { subject: string; typeId: number } | null
  sprintId: number | null
  estimatedMins: number
  typeId: number
  relatesTo: number | null
  relatesToLabel?: string
}

function isMetadataOnly(bullets: string[]): boolean {
  if (!bullets.length) return true
  const patterns = [/^carry.?over/i, /^tipe:/i, /^type:/i, /^project:/i, /^sprint #/i, /^→ sprint/i, /^status:/i]
  return bullets.every(b => patterns.some(p => p.test(b.trim())))
}

function ActivityTimeline({
  segments, onChange, totalMins, accentColor, taskTitle, autoSuggest,
}: {
  segments: ActivitySegment[]
  onChange: (segs: ActivitySegment[]) => void
  totalMins: number
  accentColor: 'teal' | 'violet'
  taskTitle?: string
  autoSuggest?: boolean
}) {
  const [suggesting, setSuggesting] = useState(false)

  useEffect(() => {
    if (autoSuggest && !suggesting) suggestSegments()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSuggest])

  async function suggestSegments() {
    setSuggesting(true)
    try {
      const items = segments.filter(s => s.note.trim())
      // If there are real activities, REFINE them (keep items, assign realistic minutes).
      // Otherwise fall back to generating phases from the title.
      const prompt = items.length > 0
        ? `You are a work-log assistant. Below are the activities done for a task and the total time spent. Assign a REALISTIC duration (minutes) to EACH activity based on its likely effort — some longer, some shorter, NOT an even split. Keep the SAME activities, SAME order, SAME count.

Task: "${taskTitle ?? 'Work session'}"
Total time: ${totalMins} minutes
Activities:
${items.map((s, i) => `${i + 1}. ${s.note.trim()}`).join('\n')}

Reply with ONLY a JSON array (exactly ${items.length} items, same order), no explanation:
[{"duration": N, "note": "..."}, ...]
Rules:
- durations must sum to exactly ${totalMins}
- keep each note's meaning and language; you may lightly tidy wording
- bigger/complex items get more minutes, trivial ones less`
        : `You are a work-log assistant. Suggest 3-4 realistic activity segments for this task.

Task: "${taskTitle ?? 'Work session'}"
Total: ${totalMins} minutes

Reply with ONLY a JSON array: [{"duration": N, "note": "..."}, ...]
- durations sum to exactly ${totalMins}; notes concise & action-oriented`

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          taskContext: { id: 'suggest', title: taskTitle ?? '', taskType: 'new' },
        }),
      })
      if (!res.ok) return

      const reader = res.body!.getReader()
      const dec = new TextDecoder()
      let full = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        full += dec.decode(value, { stream: true })
      }

      const match = full.match(/\[[\s\S]*\]/)
      if (match) {
        let parsed = (JSON.parse(match[0]) as { duration: number; note: string }[])
          .filter(s => s && s.note != null)
          .map(s => ({ duration: Math.max(1, Math.round(Number(s.duration) || 1)), note: String(s.note) }))
        if (parsed.length > 0) {
          // Normalize so durations sum EXACTLY to totalMins (AI can be off by a few)
          const sum = parsed.reduce((a, s) => a + s.duration, 0)
          if (sum !== totalMins) {
            const diff = totalMins - sum
            const last = parsed.length - 1
            parsed[last] = { ...parsed[last], duration: Math.max(1, parsed[last].duration + diff) }
          }
          onChange(parsed)
        }
      }
    } catch { /* ignore */ }
    setSuggesting(false)
  }

  const usedMins = segments.reduce((s, x) => s + x.duration, 0)
  const over = usedMins > totalMins
  const pct  = Math.min(100, Math.round(usedMins / Math.max(1, totalMins) * 100))

  const borderCls = accentColor === 'teal'
    ? 'border-teal-100 dark:border-teal-800'
    : 'border-violet-100 dark:border-violet-800'
  const ringCls = accentColor === 'teal'
    ? 'focus:ring-teal-300'
    : 'focus:ring-violet-300'
  const barCls = over ? 'bg-red-400' : accentColor === 'teal' ? 'bg-teal-400' : 'bg-violet-400'
  const addCls = accentColor === 'teal'
    ? 'text-teal-500 hover:text-teal-700'
    : 'text-violet-500 hover:text-violet-700'

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Activity Timeline</label>
        <div className="flex items-center gap-2">
          <button type="button" onClick={suggestSegments} disabled={suggesting}
            title="AI atur ulang durasi tiap item secara natural (item dipertahankan, sum tetap pas)"
            className="text-[9px] font-semibold text-amber-500 hover:text-amber-700 disabled:opacity-50 flex items-center gap-0.5">
            {suggesting ? <><Loader2 size={9} className="animate-spin" /> Suggesting…</> : <><Sparkles size={9} /> Suggest durasi</>}
          </button>
          <button type="button"
            onClick={() => onChange([...segments, { duration: Math.max(1, totalMins - usedMins), note: '' }])}
            className={`text-[9px] font-semibold ${addCls}`}>
            + Add segment
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-0.5">
        <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${barCls}`} style={{ width: `${pct}%` }} />
        </div>
        <div className={`text-[9px] font-semibold ${over ? 'text-red-500' : 'text-gray-400'}`}>
          {usedMins}m / {totalMins}m {over ? `(+${usedMins - totalMins}m over)` : `(${totalMins - usedMins}m remaining)`}
        </div>
      </div>

      {/* Segments */}
      <div className="space-y-1.5">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="text-[9px] text-gray-400 font-mono flex-shrink-0 w-4 text-right">{i + 1}.</span>
            <input
              type="number"
              min={1}
              value={seg.duration}
              onChange={e => onChange(segments.map((x, j) => j === i ? { ...x, duration: Math.max(1, Number(e.target.value)) } : x))}
              className={`w-14 text-[11px] border ${borderCls} rounded px-1.5 py-1 bg-white dark:bg-gray-900 text-center focus:outline-none focus:ring-1 ${ringCls} text-indigo-600 font-semibold`}
              title="Duration in minutes"
            />
            <span className="text-[9px] text-gray-400 flex-shrink-0">min</span>
            <input
              value={seg.note}
              onChange={e => onChange(segments.map((x, j) => j === i ? { ...x, note: e.target.value } : x))}
              placeholder={`What was done in this ${seg.duration}m…`}
              className={`flex-1 text-[11px] border ${borderCls} rounded px-2 py-1 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 ${ringCls}`}
            />
            <button type="button" onClick={() => onChange(segments.filter((_, j) => j !== i))}
              className="text-[10px] text-gray-300 hover:text-red-400 px-0.5 flex-shrink-0">✕</button>
          </div>
        ))}
        {segments.length === 0 && (
          <p className="text-[10px] text-gray-300 italic">No segments — click &ldquo;+ Add segment&rdquo; to log activity</p>
        )}
      </div>
    </div>
  )
}

function SessionCard({
  session, cache, opUrl, onPushed, onDiscard, onClearOpMatch, onBackToHub, userId, onOpenChat,
}: {
  session: PendingSession
  cache: OPCache
  opUrl: string
  onPushed: (id: string, taskId: number) => void
  onDiscard: (id: string) => void
  onClearOpMatch: (id: string) => void
  onBackToHub: (id: string) => void
  userId: number
  onOpenChat: (ctx: TaskChatContext) => void
}) {
  const { t } = useI18n()
  const [expanded, setExpanded]   = useState(false)
  const [mode, setMode]           = useState<'idle' | 'create' | 'link'>('idle')
  const [pushing, setPushing]     = useState(false)
  const [linkId, setLinkId]       = useState(session.opTaskId ? String(session.opTaskId) : '')
  const [error, setError]         = useState<string | null>(null)
  const metadataOnly = isMetadataOnly(session.bullets)
  const [segments, setSegments] = useState<ActivitySegment[]>(() =>
    metadataOnly ? [] : bulletsToSegments(session.bullets, session.actualMins ?? session.estimatedMins ?? 60)
  )
  const [sprintMoving, setSprintMoving] = useState(false)
  const [sprintMoved, setSprintMoved]   = useState(false)
  const [wpStatus, setWpStatus] = useState<{ subject: string; status: string; version: string | null } | null>(null)

  useEffect(() => {
    if (!linkId || linkId.length < 2) { setWpStatus(null); return }
    const t = setTimeout(() => {
      fetch(`/api/op/wp-detail?wpId=${linkId}`)
        .then(r => r.json())
        .then(d => { if (d.subject) setWpStatus({ subject: d.subject, status: d.status, version: d.version }) })
        .catch(() => {})
    }, 400)
    return () => clearTimeout(t)
  }, [linkId])

  const allSprints = (cache.sprints ?? []).sort((a, b) => b.startDate.localeCompare(a.startDate))
  const currentSprint = allSprints.find(s => s.isCurrent) ?? null
  // Find NEAREST next sprint (ascending by startDate, first one after current ends)
  const sprintsAsc = [...allSprints].sort((a, b) => a.startDate.localeCompare(b.startDate))
  const nextSprint = sprintsAsc.find(s => !s.isCurrent && s.startDate > (currentSprint?.endDate ?? '')) ?? null

  async function moveToNextSprint(e: React.MouseEvent) {
    e.stopPropagation()
    if (!nextSprint || !session.opTaskId || sprintMoving) return
    setSprintMoving(true)
    const r = await fetch('/api/op/sprint-move', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskIds: [session.opTaskId], targetSprintId: nextSprint.id, defaultEstMins: 60 }),
    }).then(r => r.json()).catch(() => ({ results: [{ ok: false }] }))
    if (r.results?.[0]?.ok) {
      setSprintMoved(true)
      await fetch('/api/op/cache', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {})
      window.dispatchEvent(new Event('isl:cache-refreshed'))
    }
    setSprintMoving(false)
  }
  // Only show current + next sprint in the selector
  const sprints = [currentSprint, nextSprint].filter(Boolean) as typeof allSprints
  const rawProjects = cache.watchedProjects ?? []
  const fallbackProject = { id: 12, name: "Integrity's Websites", identifier: 'integritys-websites' }
  const projects = rawProjects.length > 0 ? rawProjects : [fallbackProject]
  const defaultProject = projects[0]

  const suggested = findSuggestedTask(session.title, session.bullets, cache.myOpenTasks ?? [])

  const [form, setForm] = useState<NewTaskForm>({
    subject:             session.title.slice(0, 120),
    projectId:           defaultProject.id,
    projectIdentifier:   defaultProject.identifier,
    parentId:            null,
    parentLabel:         '',
    newParent:           null,
    sprintId:            currentSprint?.id ?? null,
    estimatedMins:       session.actualMins ?? session.estimatedMins ?? 60,
    typeId:              1,
    relatesTo:           null,
    relatesToLabel:      '',
  })

  const fmtMin = (x: number) => x >= 60 ? `${Math.floor(x / 60)}h${x % 60 > 0 ? ` ${x % 60}m` : ''}` : `${x}m`
  const origEst = session.estimatedMins ?? 60
  const actMins = session.actualMins ?? null
  // The "Estimated (mins)" field IS the worklog value pushed to OP.
  const loggedMins = form.estimatedMins
  const activeMode: 'estimate' | 'actual' = actMins != null && form.estimatedMins === actMins ? 'actual' : 'estimate'

  // Quick-fill the field with estimate or measured-actual (only when actual exists).
  const pushTimeToggle = actMins != null ? (
    <div className="flex items-center gap-1 mt-1.5 flex-wrap">
      <span className="text-[9px] text-gray-400 font-semibold">isi cepat:</span>
      <button type="button" onClick={() => setForm(f => ({ ...f, estimatedMins: origEst }))}
        className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition ${activeMode === 'estimate' ? 'bg-violet-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'}`}>
        Est {fmtMin(origEst)}
      </button>
      <button type="button" onClick={() => setForm(f => ({ ...f, estimatedMins: actMins }))}
        className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold transition ${activeMode === 'actual' ? 'bg-emerald-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'}`}>
        <Clock size={9} /> Actual {fmtMin(actMins)}
      </button>
    </div>
  ) : null

  // OP preview of the task that will be created
  const previewProject = projects.find(p => p.id === form.projectId) ?? defaultProject
  const previewParent  = form.parentId
    ? { id: form.parentId, subject: form.parentLabel || (cache.userStories ?? []).find(s => s.id === form.parentId)?.subject || '' }
    : null
  const previewSprint  = form.sprintId ? sprints.find(s => s.id === form.sprintId) : null
  const previewType    = TYPE_OPTIONS.find(t => t.id === form.typeId)?.label ?? 'Task'

  async function doPush(action: 'create_new' | 'link_existing') {
    setPushing(true); setError(null)
    try {
      const bullets = segmentsToBullets(segments)
      const body: Record<string, unknown> = { sessionId: session.id, action, bullets, loggedMins }
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
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-[10px] text-gray-400">{session.date}</span>
            <span className="text-[10px] text-indigo-500 font-medium">est {fmtMin(origEst)}</span>
            {actMins != null && (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400"><Clock size={9} /> actual {fmtMin(actMins)}</span>
            )}
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
              session.taskStatus === 'done'        ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-600' :
              session.taskStatus === 'in_progress' ? 'bg-blue-100 dark:bg-blue-950 text-blue-600' :
              'bg-gray-100 dark:bg-gray-800 text-gray-500'
            }`}>{session.taskStatus}</span>
            {session.opTaskId && (
              <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-teal-50 dark:bg-teal-950 text-teal-600 dark:text-teal-400">
                → OP #{session.opTaskId}
                <button
                  onClick={e => { e.stopPropagation(); onClearOpMatch(session.id) }}
                  className="text-teal-300 hover:text-red-400 leading-none"
                  title="Clear OP match — remove this link so you can re-assign">
                  ✕
                </button>
              </span>
            )}
            {session.opTaskId && nextSprint && (
              sprintMoved ? (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-950 text-purple-600 dark:text-purple-400">✓ {nextSprint.name}</span>
              ) : (
                <button
                  onClick={moveToNextSprint}
                  disabled={sprintMoving}
                  title={`Pindah version OP ke ${nextSprint.name}`}
                  className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-800 hover:bg-purple-100 disabled:opacity-50">
                  {sprintMoving ? '…' : `→ ${nextSprint.name}`}
                </button>
              )
            )}
          </div>
        </div>

        {/* Suggested match badge */}
        {suggested && mode === 'idle' && (
          <div className="flex-shrink-0 text-right" title={`Auto-match: session ini mirip dengan task OP "${suggested.subject}" — klik "Link ke #${suggested.id}" untuk menghubungkan`}>
            <p className="flex items-center gap-1 text-[9px] text-teal-500 font-semibold"><Search size={9} /> Match OP:</p>
            <p className="text-[10px] text-teal-600 dark:text-teal-400 font-medium">#{suggested.id}</p>
            <p className="text-[9px] text-teal-400 max-w-[100px] truncate">{suggested.subject.slice(0, 30)}</p>
          </div>
        )}

        <span className="text-gray-300 dark:text-gray-600 flex-shrink-0">{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
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
        <div className="flex items-center gap-2 px-4 py-2.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/20 flex-wrap">
          {session.opTaskId ? (
            <button onClick={() => setMode('link')}
              className="flex items-center gap-1.5 text-[10px] font-semibold text-teal-600 hover:text-teal-800 transition px-2.5 py-1.5 rounded-lg border border-teal-200 dark:border-teal-800 hover:bg-teal-50 dark:hover:bg-teal-950">
              <Link2 size={10} /> Push Log ke #{session.opTaskId}
            </button>
          ) : (
            <>
              {suggested && (
                <button onClick={() => { setMode('link'); setLinkId(String(suggested.id)) }}
                  className="flex items-center gap-1.5 text-[10px] font-semibold text-teal-600 hover:text-teal-800 transition px-2.5 py-1.5 rounded-lg border border-teal-200 dark:border-teal-800 hover:bg-teal-50 dark:hover:bg-teal-950">
                  <Link2 size={10} /> Link ke #{suggested.id}
                </button>
              )}
              <button onClick={() => setMode('create')}
                className="text-[10px] font-semibold text-violet-600 hover:text-violet-800 transition px-2.5 py-1.5 rounded-lg border border-violet-200 dark:border-violet-800 hover:bg-violet-50 dark:hover:bg-violet-950">
                {t('pushqueue.create_new')}
              </button>
              <button onClick={() => setMode('link')}
                className="flex items-center gap-1.5 text-[10px] text-gray-400 hover:text-gray-600 transition px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700">
                <Link2 size={10} /> Link ke Task Lain
              </button>
            </>
          )}
          <button
            onClick={() => onOpenChat({
              id: session.id,
              title: session.title,
              taskType: 'session',
              opTaskId: session.opTaskId,
              sprintName: (cache.sprints ?? []).find(s => s.isCurrent)?.name ?? null,
              date: session.date,
              status: session.taskStatus,
              bullets: session.bullets,
            })}
            className="flex items-center gap-1.5 text-[10px] font-semibold text-blue-600 hover:text-blue-800 transition px-2.5 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-950">
            <MessageCircle size={10} /> Lanjut Chat
          </button>
          <button onClick={() => onBackToHub(session.id)}
            className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-amber-600 transition px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-amber-300">
            ← Hub
          </button>
          <button onClick={() => onDiscard(session.id)}
            className="text-[10px] text-gray-300 hover:text-red-400 transition ml-auto">
            Discard
          </button>
        </div>
      )}

      {/* Link existing form */}
      {mode === 'link' && (
        <div className="px-4 py-3 border-t border-teal-100 dark:border-teal-900 bg-teal-50/30 dark:bg-teal-950/10 space-y-3">
          <p className="flex items-center gap-1 text-[10px] font-bold text-teal-700 dark:text-teal-300"><Link2 size={10} /> Push Log ke OP Task</p>

          {/* Task ID input */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-500">#</span>
            <input
              value={linkId}
              onChange={e => setLinkId(e.target.value.replace(/\D/g, ''))}
              placeholder="Task ID dari OP"
              className="w-32 text-[11px] border border-teal-200 dark:border-teal-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
            <a href={linkId ? `${opUrl}/work_packages/${linkId}` : '#'} target="_blank" rel="noopener"
              className="text-[10px] text-indigo-500 hover:underline">
              {linkId ? `Lihat #${linkId} ↗` : 'masukkan ID'}
            </a>
          </div>

          {/* Closed task warning */}
          {wpStatus?.status === 'Closed' && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 space-y-2">
              <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                ⚠️ Task #{linkId} sudah <strong>Closed</strong>{wpStatus.version ? ` (${wpStatus.version})` : ''} — time entry akan masuk ke sprint lama.
              </p>
              <p className="text-[10px] text-amber-600 dark:text-amber-400">
                Direkomendasikan: buat task baru di sprint ini dan relates ke #{linkId}.
              </p>
              <button
                type="button"
                onClick={() => {
                  setForm(f => ({ ...f, relatesTo: Number(linkId), relatesToLabel: wpStatus.subject }))
                  setMode('create')
                  setError(null)
                }}
                className="text-[10px] font-bold text-violet-600 dark:text-violet-400 border border-violet-200 dark:border-violet-700 rounded-lg px-3 py-1.5 hover:bg-violet-50 dark:hover:bg-violet-950/30 transition"
              >
                ✚ Buat task baru & relates ke #{linkId} →
              </button>
            </div>
          )}

          {/* Activity timeline editor */}
          <ActivityTimeline segments={segments} onChange={setSegments} totalMins={form.estimatedMins} accentColor="teal" taskTitle={session.title} />

          {actMins != null && (
            <div className="flex items-center gap-1.5 text-[10px]">
              <span className="text-gray-400 font-semibold">Log waktu ke OP: <span className="text-gray-600 dark:text-gray-300 font-bold">{fmtMin(loggedMins)}</span> ·</span>
              {pushTimeToggle}
            </div>
          )}
          {error && <p className="text-[10px] text-red-500">{error}</p>}
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => doPush('link_existing')} disabled={!linkId || pushing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition disabled:opacity-40">
              {pushing ? <><Loader2 size={9} className="animate-spin" /> Pushing…</> : <><Link2 size={9} /> Push Log ke OP →</>}
            </button>
            {!linkId && (
              <button
                onClick={() => { setMode('create'); setError(null) }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold text-violet-600 border border-violet-200 dark:border-violet-800 rounded-lg hover:bg-violet-50 dark:hover:bg-violet-950 transition"
              >
                <Plus size={9} /> Buat task baru di OP
              </button>
            )}
            <button onClick={() => { setMode('idle'); setError(null) }}
              className="text-[10px] text-gray-400 hover:text-gray-600 px-2">Cancel</button>
          </div>
        </div>
      )}

      {/* Create new form + preview */}
      {mode === 'create' && (
        <div className="px-4 py-3 border-t border-violet-100 dark:border-violet-900 bg-violet-50/30 dark:bg-violet-950/10 space-y-4">
          <p className="text-[10px] font-bold text-violet-700 dark:text-violet-300">{t('pushqueue.create_new')}</p>

          {/* Metadata-only warning */}
          {metadataOnly && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-3 py-2.5 flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold text-amber-800 dark:text-amber-300">⚠️ Bullets original hanya metadata — AI sedang generate aktivitas dari judul.</p>
                <p className="text-[9px] text-amber-600 dark:text-amber-400 mt-0.5">Kalau hasilnya tidak akurat atau kamu tidak tahu apa yang dikerjakan, lebih baik Discard.</p>
              </div>
              <button type="button" onClick={() => { setMode('idle'); onDiscard(session.id) }}
                className="flex-shrink-0 text-[9px] font-bold text-red-500 hover:text-red-700 border border-red-200 rounded-lg px-2 py-1">
                Discard
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3">
            {/* Subject */}
            <div>
              <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Subject</label>
              <input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                className="mt-1 w-full text-[12px] border border-violet-200 dark:border-violet-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-violet-400" />
            </div>

            {/* Activity timeline */}
            <ActivityTimeline segments={segments} onChange={setSegments} totalMins={form.estimatedMins} accentColor="violet" taskTitle={form.subject} autoSuggest={metadataOnly} />

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
                  {sprints.map(s => <option key={s.id} value={s.id}>{s.name}{s.isCurrent ? ' (current)' : ' (next)'}</option>)}
                </select>
              </div>

              {/* Estimated — with est/actual quick-fill toggle */}
              <div>
                <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Estimated (mins) → ini yg di-log ke OP</label>
                <input type="number" value={form.estimatedMins} onChange={e => setForm(f => ({ ...f, estimatedMins: Number(e.target.value) }))}
                  className="mt-1 w-full text-[11px] border border-violet-200 dark:border-violet-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-900 focus:outline-none" />
                {pushTimeToggle}
              </div>
            </div>

            {/* Parent (Epic / Feature) — the User Story ISL creates goes under this */}
            <div>
              <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Parent — Epic / Feature (optional)</label>
              <ParentPicker
                value={form.parentId}
                valueLabel={form.parentLabel}
                newParent={form.newParent ?? null}
                onChange={(id, label) => setForm(f => ({ ...f, parentId: id, parentLabel: label, newParent: null }))}
                onNewParent={(np) => setForm(f => ({ ...f, newParent: np, parentId: np ? null : f.parentId }))}
                epics={cache.epics ?? []}
              />
            </div>

            {/* Relates to — non-hierarchical reference ke task/US lain */}
            <div>
              <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Relates to (optional)</label>
              <p className="text-[9px] text-gray-400 mt-0.5">Referensi ke task terkait — task baru tetap independen, tidak jadi bagian scope-nya</p>
              <RelationPicker
                value={form.relatesTo}
                valueLabel={form.relatesToLabel}
                onChange={(id, label) => setForm(f => ({ ...f, relatesTo: id, relatesToLabel: label }))}
              />
            </div>
          </div>

          {/* OP Structure Preview */}
          {(() => {
            const allBullets = segmentsToBullets(segments)
            // Estimate task groups client-side (simplified — mirrors server logic)
            const estimatedGroups = (() => {
              if (allBullets.length <= 2) return [{ label: form.subject, count: allBullets.length }]
              const THEME_KEYS: Array<{ label: string; keys: string[] }> = [
                { label: 'Setup & Configuration', keys: ['setup', 'install', 'config', 'init', 'docker', 'env'] },
                { label: 'Investigation & Debug',  keys: ['debug', 'diagnos', 'analyz', 'identif', 'found'] },
                { label: 'Fix & Repair',           keys: ['fix', 'repair', 'bug', 'error', 'broken'] },
                { label: 'Implementation',         keys: ['implement', 'create', 'build', 'buat', 'tambah'] },
                { label: 'Update & Refactor',      keys: ['update', 'upgrade', 'refactor', 'improve'] },
                { label: 'Deploy & Release',       keys: ['deploy', 'release', 'publish', 'staging'] },
                { label: 'Test & Verification',    keys: ['test', 'verify', 'validate', 'cek'] },
              ]
              const hits: Record<string, number> = {}
              let unmatched = 0
              for (const b of allBullets) {
                const lower = b.toLowerCase()
                let hit = false
                for (const t of THEME_KEYS) {
                  if (t.keys.some(k => lower.includes(k))) { hits[t.label] = (hits[t.label] ?? 0) + 1; hit = true; break }
                }
                if (!hit) unmatched++
              }
              const groups = Object.entries(hits).map(([label, count]) => ({ label, count }))
              if (unmatched > 0) groups.push({ label: 'General Work', count: unmatched })
              return groups.length ? groups : [{ label: form.subject, count: allBullets.length }]
            })()
            return (
              <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 space-y-2">
                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Preview — struktur di OP</p>

                {/* Meta */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] text-gray-400 w-14 flex-shrink-0">Project</span>
                    <span className="text-[10px] text-gray-600 dark:text-gray-300 truncate">{previewProject.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] text-gray-400 w-14 flex-shrink-0">Sprint</span>
                    <span className="text-[10px] text-gray-600 dark:text-gray-300">{previewSprint ? previewSprint.name : '—'}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] text-gray-400 w-14 flex-shrink-0">Total time</span>
                    <span className="text-[10px] text-indigo-600 font-semibold">{Math.round(form.estimatedMins / 60 * 10) / 10}h</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] text-gray-400 w-14 flex-shrink-0">Task type</span>
                    <span className="text-[10px] text-gray-600 dark:text-gray-300">{previewType}</span>
                  </div>
                </div>

                {/* Hierarchy tree */}
                <div className="mt-1 pt-2 border-t border-gray-100 dark:border-gray-800 space-y-1">
                  {/* User Story */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-bold bg-violet-100 dark:bg-violet-900 text-violet-600 dark:text-violet-300 px-1.5 py-0.5 rounded flex-shrink-0">US</span>
                    <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-200 truncate">{form.subject}</span>
                  </div>
                  {/* Tasks */}
                  {estimatedGroups.map((g, i) => (
                    <div key={i} className="flex items-center gap-1.5 ml-4">
                      <span className="text-[9px] font-semibold bg-blue-50 dark:bg-blue-950 text-blue-500 dark:text-blue-400 px-1.5 py-0.5 rounded flex-shrink-0">T{i + 1}</span>
                      <span className="text-[10px] text-gray-600 dark:text-gray-300 truncate">
                        {estimatedGroups.length === 1 ? form.subject : `${form.subject} — ${g.label}`}
                      </span>
                      <span className="text-[9px] text-gray-400 flex-shrink-0 ml-auto">{g.count} item{g.count !== 1 ? 's' : ''}</span>
                    </div>
                  ))}
                  <p className="text-[9px] text-gray-400 mt-1 italic ml-4">
                    {estimatedGroups.length > 1
                      ? `${estimatedGroups.length} tasks auto-grouped by theme · time split proportionally`
                      : 'Single task — all activities logged as 1 task'}
                  </p>
                </div>

                {previewParent && (
                  <div className="flex items-center gap-1.5 pt-1 border-t border-gray-100 dark:border-gray-800">
                    <span className="text-[9px] text-gray-400">Parent:</span>
                    <span className="text-[10px] text-gray-600 dark:text-gray-300">#{previewParent.id} {previewParent.subject.slice(0, 50)}</span>
                  </div>
                )}
                {form.newParent?.subject?.trim() && (
                  <div className="flex items-center gap-1.5 pt-1 border-t border-gray-100 dark:border-gray-800">
                    <span className="text-[9px] text-gray-400">Parent baru:</span>
                    <span className="text-[10px] text-violet-600 dark:text-violet-400 font-semibold">
                      ✚ {form.newParent.typeId === 5 ? 'Epic' : 'Feature'}: {form.newParent.subject.slice(0, 50)}
                    </span>
                  </div>
                )}
                {form.relatesTo && (
                  <div className="flex items-center gap-1.5 pt-1 border-t border-gray-100 dark:border-gray-800">
                    <span className="text-[9px] text-gray-400">Relates to:</span>
                    <span className="text-[10px] text-orange-600 dark:text-orange-400 font-semibold">
                      ↗ #{form.relatesTo} {form.relatesToLabel?.slice(0, 50)}
                    </span>
                  </div>
                )}
              </div>
            )
          })()}

          {error && <p className="text-[10px] text-red-500">{error}</p>}

          <div className="flex items-center gap-2">
            <button onClick={() => doPush('create_new')} disabled={!form.subject.trim() || pushing}
              className="flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-bold bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition disabled:opacity-40">
              {pushing ? <><Loader2 size={9} className="animate-spin" /> Creating…</> : <><Plus size={10} /> Create & Push ke OP →</>}
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
  const [chatTasks, setChatTasks] = useState<TaskChatContext[]>([])

  useEffect(() => { load() }, [])

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  // Open chats run in parallel — each is a docked floating window. Re-opening an
  // already-open task is a no-op (keeps its existing conversation in place).
  function openChat(t: TaskChatContext) {
    setChatTasks(prev => prev.some(x => x.id === t.id) ? prev : [...prev, t])
  }
  function closeChat(id: string) {
    setChatTasks(prev => prev.filter(x => x.id !== id))
  }

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
      if (cacheRes._userId != null) setUserId(cacheRes._userId)
      else if (cacheRes.userId != null) setUserId(cacheRes.userId)
      if (cacheRes._opUrl) setOpUrl(cacheRes._opUrl)
    } catch {}
    setLoading(false)
  }

  function onPushed(id: string, taskId: number) {
    setPushed(prev => new Set([...prev, id]))
    setSessions(prev => prev.filter(s => s.id !== id))
    showToast(`Pushed ke OP — task #${taskId}`)
  }

  async function onClearOpMatch(id: string) {
    const r = await fetch(`/api/isl/sessions/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ opTaskId: null }),
    }).then(r => r.json()).catch(() => ({ error: 'Network error' }))
    if (r.ok) {
      setSessions(prev => prev.map(s => s.id === id ? { ...s, opTaskId: null } : s))
      showToast('OP match cleared — re-assign from queue')
    } else {
      showToast(`Clear gagal: ${r.error ?? 'Server error'}`)
    }
  }

  async function onDiscard(id: string) {
    const r = await fetch(`/api/isl/sessions/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pushStatus: 'discarded' }),
    }).then(r => r.json()).catch(() => ({ error: 'Network error' }))
    if (r.ok) {
      setSessions(prev => prev.filter(s => s.id !== id))
      showToast('Discarded dari queue')
    } else {
      showToast(`Discard gagal: ${r.error ?? 'Server error'}`)
    }
  }

  async function onBackToHub(id: string) {
    const r = await fetch(`/api/isl/sessions/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pushStatus: 'hub' }),
    }).then(r => r.json()).catch(() => ({ error: 'Network error' }))
    if (r.ok) {
      setSessions(prev => prev.filter(s => s.id !== id))
      showToast('Dikembalikan ke Daily Hub')
    } else {
      showToast(`Gagal: ${r.error ?? 'Server error'}`)
    }
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
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2"><Send size={16} /> Push Queue</h2>
          <p className="text-xs text-gray-400 mt-0.5">ISL sessions yang belum masuk ke OP — review, edit, lalu push manual</p>
        </div>
        <button onClick={load} className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-600 border border-gray-200 dark:border-gray-700 px-2.5 py-1.5 rounded-lg flex-shrink-0">
          <RefreshCw size={10} /> Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 text-[11px]">
        <span className="font-semibold text-amber-600 dark:text-amber-400">{visible.length} pending</span>
        {pushed.size > 0 && <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><CheckCircle2 size={10} /> {pushed.size} pushed this session</span>}
      </div>

      {visible.length === 0 ? (
        <div className="text-center text-gray-400 py-16">
          <div className="flex justify-center mb-3"><CheckCircle2 size={40} className="text-emerald-500" /></div>
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
              onClearOpMatch={onClearOpMatch}
              onBackToHub={onBackToHub}
              userId={userId}
              onOpenChat={openChat}
            />
          ))}
        </div>
      )}

      <ChatDock
        chats={chatTasks}
        onClose={closeChat}
        onPushed={(sessionId, taskId) => { onPushed(sessionId, taskId); closeChat(sessionId) }}
      />
    </div>
  )
}
