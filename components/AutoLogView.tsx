'use client'

import { useState, useEffect } from 'react'
import MyOPTasksTab from './MyOPTasksTab'
import QuickLogModal from './QuickLogModal'
import ActivityTimeline, { ActivitySegment, bulletsToSegments, segmentsToBullets } from './ActivityTimeline'
import {
  Bot, FolderOpen, Pin, Pencil, Save, ClipboardList, Zap,
  CheckCircle2, PauseCircle, XCircle, CornerDownLeft, BadgePlus,
  Link, AlertTriangle, Calendar, User, Sparkles, Building2,
  Circle, Check, ExternalLink, Loader2, RefreshCw, X,
  Play, Landmark, ChevronDown, ChevronRight, Clock, CalendarDays, Folder,
  RotateCcw,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Session {
  id: string
  sessionId?: string
  title: string
  bullets: string[]
  estimatedMins: number
  actualMins?: number
  startedAt: string
  updatedAt: string
  pushStatus?: 'pending' | 'pushed' | 'discarded'
  status?: 'pending' | 'pushed' | 'discarded'
  opTaskId?: number | null
  opStoryId?: number | null
  opEpicId?: number | null
  autoPushed?: boolean
  undoneAt?: string
  isNewTask?: boolean
  taskStatus?: string
  needsValidation?: boolean
  hasExplicitCmd?: boolean
  aiStatus?: string
  tokenUsage?: { inputTokens: number; outputTokens: number } | null
  relatedOldTaskId?: number | null
  ticketBinding?: number | null
  source?: string
}

interface OPItem { id: number; subject: string }
interface OPTask extends OPItem {
  userStoryId?: number | null
  parentId?: number | null
  status?: string
  islStatus?: string
  type?: string
  sprintId?: number | null
  sprintName?: string | null
  assignee?: string | null
  assigneeId?: number | null
  isClosed?: boolean
  createdBy?: string | null
  updatedAt?: string | null
  source?: string[]
  project?: string
  projectId?: number
}
interface OPSprint { id: number; name: string; isCurrent: boolean; startDate: string; endDate: string }
interface OPCache {
  epics?: OPItem[]
  userStories?: (OPItem & { epicId?: number | null })[]
  myOpenTasks?: OPTask[]
  myClosedTasks?: OPTask[]
  sprints?: OPSprint[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function pushStatus(s: Session): 'pending' | 'pushed' | 'discarded' | 'hub' | 'live' {
  return (s.pushStatus ?? (s as any).status ?? 'pending') as any
}

function formatDur(mins: number | undefined) {
  if (!mins) return '—'
  const h = Math.floor(mins / 60), m = mins % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    + ' ' + new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

const STATUS_BADGE: Record<string, string> = {
  in_progress: 'In Progress',
  done:        'Done',
  on_hold:     'On Hold',
  abandoned:   'Abandoned',
  backlog:     'Backlog',
}
const STATUS_COLOR: Record<string, string> = {
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  done:        'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  on_hold:     'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  abandoned:   'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  backlog:     'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
}

// ── Edit Session Modal ─────────────────────────────────────────────────────────
function EditSessionModal({
  session, onClose, onSaved,
}: {
  session: Session
  onClose: () => void
  onSaved: (updated: Partial<Session>) => void
}) {
  const totalMins = session.actualMins ?? session.estimatedMins ?? 30
  const [title, setTitle]         = useState(session.title)
  const [segments, setSegments]   = useState<ActivitySegment[]>(() =>
    bulletsToSegments(session.bullets ?? [], totalMins)
  )
  const [estimatedMins, setEstimatedMins] = useState(session.estimatedMins ?? 30)
  const [actualMins, setActualMins]       = useState<number | ''>(session.actualMins ?? '')
  const [taskStatus, setTaskStatus]       = useState(session.taskStatus ?? 'in_progress')
  const [saving, setSaving]               = useState(false)

  async function handleSave() {
    setSaving(true)
    const bullets = segmentsToBullets(segments)
    const body: Record<string, unknown> = {
      title,
      bullets,
      estimatedMins: Number(estimatedMins),
      actualMins: actualMins === '' ? null : Number(actualMins),
      taskStatus,
    }
    const r = await fetch(`/api/isl/sessions/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.json()).catch(() => ({ error: 'Network error' }))
    setSaving(false)
    if (r.ok) { onSaved(body as Partial<Session>); onClose() }
    else alert(r.error ?? 'Save failed')
  }

  const previewMins = Number(estimatedMins) || totalMins

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-1.5"><Pencil size={14} /> Edit Session</h3>
            {session.opTaskId && (
              <p className="text-[10px] text-indigo-400 mt-0.5">OP Task #{session.opTaskId}</p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none">×</button>
        </div>

        {/* Form */}
        <div className="px-5 py-4 space-y-4 overflow-y-auto max-h-[72vh]">

          {/* Subject */}
          <div>
            <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Subject</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="mt-1 w-full text-[12px] border border-violet-200 dark:border-violet-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-violet-400"
              placeholder="Session title…"
            />
          </div>

          {/* Activity Timeline */}
          <ActivityTimeline
            segments={segments}
            onChange={setSegments}
            totalMins={previewMins}
            taskTitle={title}
          />

          {/* Duration + Status */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Estimated (mins)</label>
              <input
                type="number" min={1} value={estimatedMins}
                onChange={e => setEstimatedMins(Number(e.target.value))}
                className="mt-1 w-full text-[11px] border border-violet-200 dark:border-violet-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-violet-400"
              />
            </div>
            <div>
              <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Actual (mins)</label>
              <input
                type="number" min={1}
                value={actualMins}
                onChange={e => setActualMins(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="—"
                className="mt-1 w-full text-[11px] border border-violet-200 dark:border-violet-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-violet-400"
              />
            </div>
            <div>
              <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Status</label>
              <select
                value={taskStatus}
                onChange={e => setTaskStatus(e.target.value)}
                className="mt-1 w-full text-[11px] border border-violet-200 dark:border-violet-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-violet-400"
              >
                <option value="in_progress">In Progress</option>
                <option value="done">Done</option>
                <option value="on_hold">On Hold</option>
                <option value="abandoned">Abandoned</option>
                <option value="backlog">Backlog</option>
              </select>
            </div>
          </div>

          {/* Preview */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 space-y-2">
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Preview — Session Log</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-gray-400 w-16 flex-shrink-0">Total time</span>
                <span className="text-[10px] text-indigo-600 font-semibold">{Math.round(previewMins / 60 * 10) / 10}h</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-gray-400 w-16 flex-shrink-0">Segments</span>
                <span className="text-[10px] text-gray-600 dark:text-gray-300">{segments.filter(s => s.note.trim()).length} items</span>
              </div>
            </div>
            <div className="pt-2 border-t border-gray-100 dark:border-gray-800 space-y-1">
              {segments.filter(s => s.note.trim()).map((seg, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <span className="text-[9px] font-bold text-violet-400 flex-shrink-0 mt-0.5 w-8 text-right">{seg.duration}m</span>
                  <span className="text-[10px] text-gray-600 dark:text-gray-300">{seg.note}</span>
                </div>
              ))}
              {segments.filter(s => s.note.trim()).length === 0 && (
                <p className="text-[9px] text-gray-400 italic">No activity notes yet</p>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-end gap-2">
          <button onClick={onClose}
            className="px-3 py-1.5 text-xs font-semibold text-gray-500 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-1.5 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg transition">
            {saving ? 'Saving…' : <><Save size={12} className="inline mr-1" />Save Changes</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Session Detail Popup ──────────────────────────────────────────────────────
function SessionDetailPopup({
  session, opUrl, opStatus, onClose, onStatusChange, onUndo, onResetToPending, onImprove, onSyncStatus, onConfirm, onEdit,
}: {
  session: Session
  opUrl: string
  opStatus?: string
  onClose: () => void
  onStatusChange: (id: string, status: string) => void
  onUndo: (session: Session) => void
  onResetToPending: (session: Session) => void
  onImprove: (session: Session) => void
  onSyncStatus: (taskId: number, islStatus: string) => void
  onConfirm?: (id: string) => void
  onEdit?: (session: Session) => void
}) {
  const ps       = pushStatus(session)
  const isUndone = ps === 'discarded'
  const status   = session.taskStatus ?? 'in_progress'
  const outOfSync = opStatus && opStatus !== status && session.opTaskId

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-gray-100 dark:border-gray-800">
          <div className="flex-1 min-w-0">
            {session.opTaskId && (
              <a href={`${opUrl}/work_packages/${session.opTaskId}`} target="_blank" rel="noopener"
                className="text-xs font-mono font-bold text-indigo-500 hover:underline">
                #{session.opTaskId}
              </a>
            )}
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mt-0.5 leading-snug">{session.title}</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none flex-shrink-0 mt-0.5">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Status + meta */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLOR[status] ?? STATUS_COLOR.in_progress}`}>
              {STATUS_BADGE[status] ?? status}
            </span>
            {/* Origin badge — most prominent label */}
            {(() => { const o = getOriginBadge(session); return o ? <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${o.cls}`}>{o.label}</span> : null })()}
            {isUndone && <span className="text-[10px] font-semibold text-red-400 bg-red-50 dark:bg-red-950 px-2 py-0.5 rounded-full flex items-center gap-1"><CornerDownLeft size={9} /> Backlog</span>}
            {session.needsValidation && !session.hasExplicitCmd && (
              <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 dark:bg-amber-950 px-2 py-0.5 rounded-full flex items-center gap-1"><AlertTriangle size={9} /> Needs validation</span>
            )}
            {session.isNewTask === true && (
              <span className="text-[10px] text-violet-500 bg-violet-50 dark:bg-violet-950 px-2 py-0.5 rounded-full flex items-center gap-1"><BadgePlus size={9} /> New task created</span>
            )}
          </div>

          {/* Bullets */}
          {session.bullets?.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">Work done</p>
              <ul className="space-y-1">
                {session.bullets.map((b, i) => (
                  <li key={i} className="flex gap-2 text-xs text-gray-700 dark:text-gray-300">
                    <span className="text-gray-300 dark:text-gray-600 flex-shrink-0 mt-0.5">▸</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Related old task */}
          {session.relatedOldTaskId && !isUndone && (
            <div className="flex items-start gap-2 bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-800 rounded-lg px-3 py-2">
              <Link size={12} className="text-orange-500 flex-shrink-0" />
              <p className="text-[11px] text-orange-700 dark:text-orange-300">
                Related to old task{' '}
                <a href={`${opUrl}/work_packages/${session.relatedOldTaskId}`} target="_blank" rel="noopener"
                  className="font-bold underline">#{session.relatedOldTaskId}</a>{' '}
                from a previous sprint.
              </p>
            </div>
          )}

          {/* OP sync warning */}
          {outOfSync && (
            <div className="flex items-center gap-2 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-lg px-3 py-2">
              <Zap size={12} className="text-orange-500" />
              <p className="text-[11px] text-orange-700 dark:text-orange-300 flex-1">
                OP status is <strong>{opStatus}</strong> but ISL says <strong>{status}</strong>
              </p>
              <button
                onClick={() => { onSyncStatus(session.opTaskId!, status); onClose() }}
                className="text-[10px] font-bold text-orange-600 border border-orange-300 dark:border-orange-700 px-2 py-0.5 rounded hover:bg-orange-100 dark:hover:bg-orange-900 transition">
                Sync to OP
              </button>
            </div>
          )}

          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] text-gray-500 dark:text-gray-400">
            <div><span className="font-semibold text-gray-600 dark:text-gray-300">Duration</span><br />
              {session.actualMins && session.estimatedMins && session.actualMins !== session.estimatedMins ? (
                <span>
                  {formatDur(session.estimatedMins)} <span className="text-gray-300">est →</span> <span className="font-semibold text-gray-700 dark:text-gray-200">{formatDur(session.actualMins)}</span>
                  {(() => {
                    const diff = session.actualMins - session.estimatedMins
                    const over = diff > 0
                    return <span className={`ml-1 text-[10px] font-bold ${over ? 'text-orange-500' : 'text-emerald-500'}`}>({over ? '+' : ''}{diff}m)</span>
                  })()}
                </span>
              ) : session.actualMins ? `${formatDur(session.actualMins)} (actual)` : formatDur(session.estimatedMins) + ' (est)'}
            </div>
            <div><span className="font-semibold text-gray-600 dark:text-gray-300">Date</span><br />{formatDate(session.startedAt)}</div>
            {opStatus && (
              <div><span className="font-semibold text-gray-600 dark:text-gray-300">OP Status</span><br />
                <span className={outOfSync ? 'text-orange-500 font-semibold' : 'text-emerald-600'}>{opStatus.replace('_', ' ')}</span>
              </div>
            )}
            {session.ticketBinding && (
              <div><span className="font-semibold text-gray-600 dark:text-gray-300">Ticket bind</span><br />!ticket:{session.ticketBinding}</div>
            )}
            {session.tokenUsage && (
              <div><span className="font-semibold text-gray-600 dark:text-gray-300">Tokens</span><br />
                {((session.tokenUsage.inputTokens + session.tokenUsage.outputTokens) / 1000).toFixed(1)}k total
              </div>
            )}
            {session.sessionId && (
              <div><span className="font-semibold text-gray-600 dark:text-gray-300">Session ID</span><br />
                <span className="font-mono">{session.sessionId.slice(0, 8)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        {!isUndone && status !== 'abandoned' && (
          <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center gap-2 flex-wrap">
            {session.needsValidation && !session.hasExplicitCmd && onConfirm && (
              <button onClick={() => { onConfirm(session.id); onClose() }}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-lg transition">
                <Check size={12} /> Confirm
              </button>
            )}
            {onEdit && (
              <button onClick={() => { onEdit(session); onClose() }}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-violet-600 border border-violet-200 dark:border-violet-800 rounded-lg hover:bg-violet-50 dark:hover:bg-violet-950 transition">
                <Pencil size={12} /> Edit
              </button>
            )}
            {session.opTaskId && (status === 'in_progress' || status === 'on_hold') && (
              <button
                onClick={() => { navigator.clipboard.writeText(`!ticket:${session.opTaskId}`); onClose() }}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-indigo-600 border border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950 transition">
                <Play size={12} /> Copy !ticket
              </button>
            )}
            {status !== 'done' && (
              <button onClick={() => { onStatusChange(session.id, 'done'); onClose() }}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-emerald-600 border border-emerald-200 dark:border-emerald-800 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-950 transition">
                <CheckCircle2 size={12} /> Mark Done
              </button>
            )}
            {status !== 'on_hold' && (
              <button onClick={() => { onStatusChange(session.id, 'on_hold'); onClose() }}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-amber-600 border border-amber-200 dark:border-amber-800 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-950 transition">
                <PauseCircle size={12} /> Hold
              </button>
            )}
            {status === 'on_hold' && (
              <button onClick={() => { onStatusChange(session.id, 'in_progress'); onClose() }}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-blue-600 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950 transition">
                <Play size={12} /> Resume
              </button>
            )}
            <button onClick={() => { onImprove(session); onClose() }}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-purple-600 border border-purple-200 dark:border-purple-800 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-950 transition">
              <Sparkles size={12} /> Improve
            </button>
            <div className="ml-auto flex items-center gap-2">
              {session.opTaskId && (
                <button onClick={() => { onResetToPending(session); onClose() }}
                  title="Balikin ke Push Queue di ISL saja — tiket/comment/worklog yang sudah dibuat di OP TIDAK disentuh/dihapus."
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition">
                  <RotateCcw size={12} /> Re-queue
                </button>
              )}
              <button onClick={() => { onUndo(session); onClose() }}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition">
                <CornerDownLeft size={12} /> Backlog
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Origin badge helper ────────────────────────────────────────────────────────
function getOriginBadge(s: Session): { label: string; cls: string } | null {
  if (s.source === 'sprint-plan') return { label: 'Sprint Plan',   cls: 'text-violet-500 bg-violet-50 dark:bg-violet-950' }
  if (s.source === 'ai-suggest')  return { label: 'AI Suggest',    cls: 'text-indigo-500 bg-indigo-50 dark:bg-indigo-950' }
  if (s.autoPushed)               return { label: 'ISL Auto',      cls: 'text-amber-600 bg-amber-50 dark:bg-amber-950' }
  if (s.needsValidation && !s.hasExplicitCmd) return { label: 'ISL Generated', cls: 'text-blue-500 bg-blue-50 dark:bg-blue-950' }
  if (s.hasExplicitCmd)           return { label: 'ISL Confirmed', cls: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950' }
  if (s.opTaskId && s.isNewTask === false) return { label: 'OP Activity', cls: 'text-sky-600 bg-sky-50 dark:bg-sky-950' }
  return null
}

// ── Session Row (inside a task group) ─────────────────────────────────────────
function SessionRow({ session, opUrl, onClick }: { session: Session; opUrl: string; onClick: () => void }) {
  const ps     = pushStatus(session)
  const status = session.taskStatus ?? 'in_progress'
  const origin = getOriginBadge(session)
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition group ${ps === 'discarded' ? 'opacity-40' : ''}`}
    >
      <span className="flex-shrink-0 text-gray-300 dark:text-gray-600 text-xs">├─</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${STATUS_COLOR[status] ?? STATUS_COLOR.in_progress}`}>
            {STATUS_BADGE[status] ?? status}
          </span>
          {session.needsValidation && !session.hasExplicitCmd && (
            <AlertTriangle size={10} className="text-amber-500 flex-shrink-0" />
          )}
          {ps === 'discarded' && <CornerDownLeft size={10} className="text-red-400 flex-shrink-0" />}
          <span className="text-xs text-gray-600 dark:text-gray-300 truncate">{session.title}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-400 flex-wrap">
          <span className="flex items-center gap-0.5"><Clock size={9} />{formatDur(session.actualMins ?? session.estimatedMins)}</span>
          <span className="flex items-center gap-0.5"><CalendarDays size={9} />{formatDate(session.startedAt)}</span>
          {session.isNewTask && <span className="text-violet-400">new task</span>}
          {origin && (
            <span className={`px-1.5 py-0.5 rounded-full font-semibold ${origin.cls}`}>{origin.label}</span>
          )}
        </div>
      </div>
      <span className="text-gray-300 dark:text-gray-600 text-xs group-hover:text-gray-500 transition flex-shrink-0">›</span>
    </div>
  )
}

// ── Task Group (sessions for same opTaskId) ────────────────────────────────────
function TaskGroup({
  taskId, taskName, sessions, opUrl, opStatus, onSessionClick, onSyncStatus, defaultOpen,
}: {
  taskId: number | null
  taskName: string
  sessions: Session[]
  opUrl: string
  opStatus?: string   // actual OP islStatus (e.g. 'in_progress', 'done')
  onSessionClick: (s: Session) => void
  onSyncStatus: (taskId: number, islStatus: string) => void
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const totalMins    = sessions.reduce((s, e) => s + (e.actualMins ?? e.estimatedMins ?? 0), 0)
  const islStatus    = sessions[0]?.taskStatus ?? 'in_progress'
  const hasWarning   = sessions.some(s => s.needsValidation && !s.hasExplicitCmd && pushStatus(s) !== 'discarded')
  const outOfSync    = opStatus && opStatus !== islStatus && sessions[0]?.opTaskId

  return (
    <div className="ml-6 mb-1">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition text-left group"
      >
        <span className="text-gray-400 flex-shrink-0">{open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}</span>
        <span className={`flex-shrink-0 w-2 h-2 rounded-full mt-0.5 ${
          islStatus === 'done'      ? 'bg-emerald-500' :
          islStatus === 'on_hold'   ? 'bg-amber-400' :
          islStatus === 'abandoned' ? 'bg-gray-400' :
          'bg-blue-500'
        }`} />
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {taskId && (
            <a href={`${opUrl}/work_packages/${taskId}`} target="_blank" rel="noopener"
              onClick={e => e.stopPropagation()}
              className="text-[11px] font-mono font-bold text-indigo-400 hover:text-indigo-600 flex-shrink-0">
              #{taskId}
            </a>
          )}
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-200 truncate">{taskName}</span>
          {hasWarning && <AlertTriangle size={10} className="text-amber-500 flex-shrink-0" />}
          {islStatus === 'in_progress' && sessions.some(s => pushStatus(s) === 'pushed') && (
            <button
              onClick={e => { e.stopPropagation(); window.dispatchEvent(new CustomEvent('isl:navigate', { detail: 'sprint-plan' })) }}
              title="Task still in progress — view in Sprint Plan"
              className="text-[9px] text-violet-500 bg-violet-50 dark:bg-violet-950/40 px-1.5 py-0.5 rounded font-semibold hover:bg-violet-100 transition flex-shrink-0">
              ▶ Sprint Plan
            </button>
          )}
          {outOfSync && (
            <button
              onClick={e => { e.stopPropagation(); onSyncStatus(sessions[0].opTaskId!, islStatus) }}
              title={`OP status: ${opStatus} · ISL: ${islStatus} — click to sync`}
              className="flex items-center gap-0.5 text-[10px] text-orange-500 bg-orange-50 dark:bg-orange-950/40 px-1.5 py-0.5 rounded font-semibold hover:bg-orange-100 transition flex-shrink-0">
              <Zap size={10} /> sync
            </button>
          )}
          {opStatus && !outOfSync && (
            <span title={`OP: ${opStatus}`} className="flex items-center gap-0.5 text-[10px] text-gray-300 dark:text-gray-600 flex-shrink-0"><Check size={9} />OP</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 text-[10px] text-gray-400">
          <span>{sessions.length} session{sessions.length > 1 ? 's' : ''}</span>
          <span className="flex items-center gap-0.5"><Clock size={9} />{formatDur(totalMins)}</span>
        </div>
      </button>
      {open && (
        <div className="ml-3 border-l border-gray-100 dark:border-gray-800">
          {sessions.map(s => (
            <SessionRow key={s.id} session={s} opUrl={opUrl} onClick={() => onSessionClick(s)} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Story Group ────────────────────────────────────────────────────────────────
function StoryGroup({
  storyId, storyName, taskGroups, opUrl, onSessionClick, onSyncStatus, defaultOpen,
}: {
  storyId: number | null
  storyName: string
  taskGroups: { taskId: number | null; taskName: string; sessions: Session[]; opStatus?: string }[]
  opUrl: string
  onSessionClick: (s: Session) => void
  onSyncStatus: (taskId: number, islStatus: string) => void
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const totalSessions = taskGroups.reduce((n, g) => n + g.sessions.length, 0)
  const totalMins     = taskGroups.reduce((n, g) => n + g.sessions.reduce((s, e) => s + (e.actualMins ?? e.estimatedMins ?? 0), 0), 0)

  return (
    <div className="ml-4 mb-2">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition text-left"
      >
        <span className="text-gray-400 flex-shrink-0">{open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}</span>
        <ClipboardList size={14} className="text-indigo-500 flex-shrink-0" />
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {storyId && (
            <a href={`${opUrl}/work_packages/${storyId}`} target="_blank" rel="noopener"
              onClick={e => e.stopPropagation()}
              className="text-[11px] font-mono font-bold text-indigo-400 hover:text-indigo-600 flex-shrink-0">
              #{storyId}
            </a>
          )}
          <span className="text-xs font-bold text-gray-700 dark:text-gray-200 truncate">{storyName}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 text-[10px] text-gray-400">
          <span>{taskGroups.length} task{taskGroups.length > 1 ? 's' : ''}</span>
          <span>·</span>
          <span>{totalSessions} sessions</span>
          <span>·</span>
          <span className="flex items-center gap-0.5"><Clock size={9} />{formatDur(totalMins)}</span>
        </div>
      </button>
      {open && (
        <div>
          {taskGroups.map(g => (
            <TaskGroup
              key={g.taskId ?? 'null'}
              taskId={g.taskId}
              taskName={g.taskName}
              sessions={g.sessions}
              opUrl={opUrl}
              opStatus={g.opStatus}
              onSessionClick={onSessionClick}
              onSyncStatus={onSyncStatus}
              defaultOpen={taskGroups.length === 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Epic Group ─────────────────────────────────────────────────────────────────
function EpicGroup({
  epicId, epicName, storyGroups, opUrl, onSessionClick, onSyncStatus, defaultOpen,
}: {
  epicId: number | null
  epicName: string
  storyGroups: { storyId: number | null; storyName: string; taskGroups: any[] }[]
  opUrl: string
  onSessionClick: (s: Session) => void
  onSyncStatus: (taskId: number, islStatus: string) => void
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const totalSessions = storyGroups.reduce((n, sg) => n + sg.taskGroups.reduce((m, tg) => m + tg.sessions.length, 0), 0)
  const totalMins     = storyGroups.reduce((n, sg) =>
    n + sg.taskGroups.reduce((m, tg) =>
      m + tg.sessions.reduce((s: number, e: Session) => s + (e.actualMins ?? e.estimatedMins ?? 0), 0), 0), 0)

  return (
    <div className="mb-3 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition text-left"
      >
        <span className="text-gray-400 flex-shrink-0">{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
        <Landmark size={14} className="text-orange-500 flex-shrink-0" />
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {epicId && (
            <a href={`${opUrl}/work_packages/${epicId}`} target="_blank" rel="noopener"
              onClick={e => e.stopPropagation()}
              className="text-[11px] font-mono font-bold text-indigo-400 hover:text-indigo-600 flex-shrink-0">
              #{epicId}
            </a>
          )}
          <span className="text-sm font-bold text-gray-800 dark:text-gray-100 truncate">{epicName}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 text-[11px] text-gray-400">
          <span>{storyGroups.length} stor{storyGroups.length > 1 ? 'ies' : 'y'}</span>
          <span>·</span>
          <span>{totalSessions} sessions</span>
          <span>·</span>
          <span className="font-semibold text-gray-600 dark:text-gray-300 flex items-center gap-0.5"><Clock size={10} />{formatDur(totalMins)}</span>
        </div>
      </button>
      {open && (
        <div className="border-t border-gray-100 dark:border-gray-800 py-2">
          {storyGroups.map(sg => (
            <StoryGroup
              key={sg.storyId ?? 'null'}
              storyId={sg.storyId}
              storyName={sg.storyName}
              taskGroups={sg.taskGroups}
              opUrl={opUrl}
              onSessionClick={onSessionClick}
              onSyncStatus={onSyncStatus}
              defaultOpen={storyGroups.length === 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function AutoLogView() {
  const [sessions, setSessions]     = useState<Session[]>([])
  const [cache, setCache]           = useState<OPCache>({})
  const [opMode, setOpMode]         = useState<{ mode: string; project?: string } | null>(null)
  const [activeTimer, setActiveTimer] = useState<{ taskId: number; taskTitle: string; since: string } | null>(null)

  type SprintBucket = { new: number; in_progress: number; on_hold: number; done: number; total: number }
  const [sprintStats, setSprintStats] = useState<{
    sprint: { id: number; name: string; endDate: string }
    total: number; done: number; remaining: number; pct: number
    buckets: SprintBucket
    byProject: Record<string, SprintBucket & { projectTitle: string }>
  } | null>(null)
  const [loading, setLoading]       = useState(true)
  const [mainTab, setMainTab]        = useState<'sessions' | 'my-tasks' | 'untracked'>('sessions')
  const [filter, setFilter]         = useState<'all' | 'pushed' | 'discarded' | 'abandoned'>('pushed')
  const [sprintFilter, setSprintFilter] = useState<number | null>(null)
  const [detail, setDetail]         = useState<Session | null>(null)
  const [toast, setToast]           = useState<string | null>(null)
  const [improvingId, setImprovingId] = useState<string | null>(null)
  const [quickLogOpen, setQuickLogOpen] = useState(false)
  const [editSession, setEditSession] = useState<Session | null>(null)

  const opUrl = (cache as { _opUrl?: string })._opUrl ?? 'https://tokek.integrity-asia.com'

  async function load(isInitial = false) {
    const [sessRes, cacheRes, modeRes, statsRes, timerRes] = await Promise.all([
      fetch('/api/isl/sessions').then(r => r.json()).catch(() => ({ sessions: [] })),
      fetch('/api/op/cache').then(r => r.json()).catch(() => ({})),
      fetch('/api/op/mode').then(r => r.json()).catch(() => null),
      fetch('/api/op/sprint-stats').then(r => r.json()).catch(() => null),
      fetch('/api/op/active-timer').then(r => r.json()).catch(() => ({ active: null })),
    ])
    setSessions(sessRes.sessions ?? [])
    setCache(cacheRes)
    setOpMode(modeRes)
    setSprintStats(statsRes?.sprint ? statsRes : null)
    setActiveTimer(timerRes?.active ?? null)
    setLoading(false)
    // Auto-select current sprint on first load
    if (isInitial) {
      const sprints = (cacheRes.sprints ?? []) as OPSprint[]
      const cur = sprints.find(s => s.isCurrent)
      if (cur) setSprintFilter(cur.id)
    }
  }

  useEffect(() => { load(true) }, [])

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 4000) }

  // ── Build lookup maps from cache (must be before filtered) ───────────────
  const epicMap      = new Map<number, string>((cache.epics ?? []).map(e => [e.id, e.subject]))
  const storyMap     = new Map<number, string>((cache.userStories ?? []).map(s => [s.id, s.subject]))
  const taskMap      = new Map<number, string>()
  const taskStoryMap = new Map<number, number | null>()
  const taskEpicMap  = new Map<number, number | null>()
  const taskOpStatusMap = new Map<number, string>()
  const taskSprintMap   = new Map<number, number | null>()

  for (const t of [...(cache.myOpenTasks ?? []), ...(cache.myClosedTasks ?? [])]) {
    taskMap.set(t.id, t.subject)
    if (t.islStatus) taskOpStatusMap.set(t.id, t.islStatus)
    taskSprintMap.set(t.id, t.sprintId ?? null)
    const storyId = t.userStoryId ?? t.parentId ?? null
    taskStoryMap.set(t.id, storyId)
    if (storyId) {
      const story = (cache.userStories ?? []).find(s => s.id === storyId) as any
      taskEpicMap.set(t.id, story?.epicId ?? null)
    }
  }

  // Available sprints — dedupe by id, sort by startDate desc
  const allSprints = Array.from(
    new Map((cache.sprints ?? []).map(s => [s.id, s])).values()
  ).sort((a, b) => b.startDate.localeCompare(a.startDate))
  const currentSprint = allSprints.find(s => s.isCurrent) ?? null

  // Only show sprints that have ISL sessions linked to them, plus the current sprint
  const sprintIdsWithSessions = new Set(
    sessions.map(s => s.opTaskId ? taskSprintMap.get(s.opTaskId) ?? null : null).filter((id): id is number => id !== null)
  )
  // Current sprint always first, then up to 3 most recent past sprints with sessions
  const pastSprintsWithSessions = allSprints
    .filter(s => !s.isCurrent && sprintIdsWithSessions.has(s.id))
    .slice(0, 3)
  const availableSprints = [
    ...(currentSprint ? [currentSprint] : []),
    ...pastSprintsWithSessions,
  ]

  // ── Compute hierarchy ──────────────────────────────────────────────────────
  const filtered = sessions.filter(s => {
    const ps = pushStatus(s)
    // Exclude live/hub sessions from Auto Log — they belong in Daily Hub
    if (ps === 'live' || ps === 'hub') return false
    if (filter === 'pushed') {
      // Only sessions truly pushed to OP (must have opTaskId)
      if (!(ps === 'pushed' && s.taskStatus !== 'abandoned')) return false
      if (!s.opTaskId) return false
    }
    else if (filter === 'discarded') { if (ps !== 'discarded') return false }
    else if (filter === 'abandoned') { if (s.taskStatus !== 'abandoned') return false }
    if (sprintFilter !== null) {
      if (s.opTaskId) {
        const taskSprint = taskSprintMap.get(s.opTaskId)
        // undefined = task not in cache → don't filter out (show it)
        if (taskSprint !== undefined && taskSprint !== sprintFilter) return false
      } else {
        // No OP task: filter by date range of selected sprint
        const sp = allSprints.find(sp => sp.id === sprintFilter)
        if (sp && s.startedAt) {
          const d = s.startedAt.slice(0, 10)
          if (d < sp.startDate || d > sp.endDate) return false
        }
      }
    }
    return true
  })

  // Group: epic → story → task → sessions
  const epicTree = new Map<string, {
    epicId: number | null
    epicName: string
    stories: Map<string, {
      storyId: number | null
      storyName: string
      tasks: Map<string, { taskId: number | null; taskName: string; sessions: Session[]; opStatus?: string }>
    }>
  }>()

  for (const s of filtered) {
    // Resolve story first (needed for epic fallback)
    const storyId  = s.opStoryId ?? (s.opTaskId ? taskStoryMap.get(s.opTaskId) ?? null : null)

    // Resolve epic — fallback chain: session.opEpicId → taskEpicMap → story.epicId
    const storyEpicId = storyId
      ? ((cache.userStories ?? []).find(st => st.id === storyId) as any)?.epicId ?? null
      : null
    const epicId  = s.opEpicId ?? (s.opTaskId ? taskEpicMap.get(s.opTaskId) ?? null : null) ?? storyEpicId
    const epicKey  = epicId ? String(epicId) : 'no-epic'
    const epicName = epicId ? (epicMap.get(epicId) ?? `Epic #${epicId}`) : 'No Epic'
    const storyKey = String(storyId ?? 0)
    const storyName = storyId ? (storyMap.get(storyId) ?? `User Story #${storyId}`) : 'No User Story'

    // Resolve task
    const taskId  = s.opTaskId ?? null
    const taskKey = String(taskId ?? s.id)
    const taskName = taskId ? (taskMap.get(taskId) ?? s.title) : s.title

    if (!epicTree.has(epicKey)) {
      epicTree.set(epicKey, { epicId, epicName, stories: new Map() })
    }
    const epicNode = epicTree.get(epicKey)!

    if (!epicNode.stories.has(storyKey)) {
      epicNode.stories.set(storyKey, { storyId, storyName, tasks: new Map() })
    }
    const storyNode = epicNode.stories.get(storyKey)!

    if (!storyNode.tasks.has(taskKey)) {
      const opStatus = taskId ? (taskOpStatusMap.get(taskId) ?? undefined) : undefined
      storyNode.tasks.set(taskKey, { taskId, taskName, sessions: [], opStatus })
    }
    storyNode.tasks.get(taskKey)!.sessions.push(s)
  }

  // Convert to sorted arrays (most recent first)
  const epicList = Array.from(epicTree.values()).map(epic => ({
    ...epic,
    storyGroups: Array.from(epic.stories.values()).map(story => ({
      ...story,
      taskGroups: Array.from(story.tasks.values()).map(task => ({
        ...task,
        sessions: task.sessions.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()),
      })),
    })),
  }))

  // Stats — computed from filtered (respects sprint filter + tab filter)
  const totalMins  = filtered.filter(s => pushStatus(s) === 'pushed').reduce((n, s) => n + (s.actualMins ?? s.estimatedMins ?? 0), 0)
  const pendingVal = filtered.filter(s => s.needsValidation && !s.hasExplicitCmd && pushStatus(s) === 'pushed').length

  // Tab counts — based on sessions excluding live/hub, but NOT sprint-filtered (shows global counts per tab)
  const baseSessions = sessions.filter(s => { const ps = pushStatus(s); return ps !== 'live' && ps !== 'hub' })
  const tabCounts = {
    pushed:    baseSessions.filter(s => pushStatus(s) === 'pushed' && s.taskStatus !== 'abandoned').length,
    all:       baseSessions.length,
    discarded: baseSessions.filter(s => pushStatus(s) === 'discarded').length,
    abandoned: baseSessions.filter(s => s.taskStatus === 'abandoned').length,
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  async function doStatusChange(id: string, taskStatus: string) {
    const r = await fetch(`/api/isl/sessions/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskStatus }),
    }).then(r => r.json()).catch(() => ({ error: 'Network error' }))

    if (!r.ok) { showToast(`Error: ${r.error ?? 'Update failed'}`); return }
    setSessions(prev => prev.map(s => s.id === id ? { ...s, taskStatus } : s))

    const session = sessions.find(s => s.id === id)
    if (session?.opTaskId) {
      const opR = await fetch('/api/op/status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wpId: session.opTaskId, islStatus: taskStatus }),
      }).then(r => r.json()).catch(() => ({ ok: false }))
      showToast(opR.synced ? `Status updated → OP #${session.opTaskId}` : 'Status saved (OP offline)')
    } else {
      showToast('Status updated')
    }
  }

  async function doConfirm(id: string) {
    await fetch(`/api/isl/sessions/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hasExplicitCmd: true }),
    }).catch(() => {})
    setSessions(prev => prev.map(s => s.id === id ? { ...s, hasExplicitCmd: true } : s))
    showToast('Session confirmed')
  }

  async function doUndo(session: Session) {
    if (!confirm(`Move "${session.title}" to backlog?\n\nOP task #${session.opTaskId} will be moved to [REVIEW]. Task will NOT be deleted.`)) return
    const r = await fetch(`/api/isl/sessions/${session.id}`, { method: 'DELETE' }).then(r => r.json()).catch(() => ({ error: 'Network error' }))
    if (r.ok) {
      setSessions(prev => prev.map(s => s.id === session.id ? { ...s, pushStatus: 'discarded', undoneAt: new Date().toISOString() } : s))
      showToast(`Moved to backlog — task #${session.opTaskId} → [REVIEW]`)
    } else {
      showToast(`Error: ${r.error ?? 'Failed'}`)
    }
  }

  // ISL-only undo: back to Push Queue for redo, OP left completely untouched
  // (no status change, no delete, no new comment) — for when the push itself
  // was fine but you want to redo/relink without touching what's already there.
  async function doResetToPending(session: Session) {
    if (!confirm(`Balikin "${session.title}" ke Push Queue?\n\nTiket/comment/worklog yang sudah dibuat di OP #${session.opTaskId} TIDAK akan disentuh sama sekali.`)) return
    const r = await fetch(`/api/isl/sessions/${session.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pushStatus: 'pending', undoneAt: new Date().toISOString() }),
    }).then(r => r.json()).catch(() => ({ error: 'Network error' }))
    if (r.ok) {
      setSessions(prev => prev.map(s => s.id === session.id ? { ...s, pushStatus: 'pending' } : s))
      showToast('Balik ke Push Queue — OP tidak diubah')
    } else {
      showToast(`Error: ${r.error ?? 'Failed'}`)
    }
  }

  async function doImprove(session: Session) {
    setImprovingId(session.id)
    showToast('Improving with AI…')
    try {
      const r = await fetch('/api/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `Improve this work session summary. More specific, technical, actionable. Same structure, expand each bullet with technical detail.\n\nTitle: ${session.title}\nBullets:\n${session.bullets.map(b => `- ${b}`).join('\n')}\n\nReturn JSON: {"title":"...","bullets":["..."]}`,
          mode: 'improve',
        }),
      }).then(r => r.json())
      if (r.title || r.bullets) {
        await fetch(`/api/isl/sessions/${session.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: r.title ?? session.title, bullets: r.bullets ?? session.bullets }),
        })
        setSessions(prev => prev.map(s => s.id === session.id ? { ...s, title: r.title ?? s.title, bullets: r.bullets ?? s.bullets } : s))
        showToast('Summary improved by AI')
      }
    } catch { showToast('Improve failed') }
    setImprovingId(null)
  }

  async function doSyncStatus(taskId: number, islStatus: string) {
    const r = await fetch('/api/op/status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wpId: taskId, islStatus }),
    }).then(r => r.json()).catch(() => ({ ok: false }))
    showToast(r.synced ? `OP #${taskId} synced → ${islStatus}` : `Sync failed for #${taskId}`)
    if (r.synced) load()
  }

  function doEditSaved(id: string, updated: Partial<Session>) {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, ...updated } : s))
    showToast('Session updated')
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) return <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Loading sessions…</div>

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 bg-gray-900 text-white text-xs font-semibold px-4 py-2.5 rounded-xl shadow-xl animate-in slide-in-from-bottom-2">
          {toast}
        </div>
      )}

      {/* Detail popup */}
      {detail && (
        <SessionDetailPopup
          session={detail}
          opUrl={opUrl}
          opStatus={detail.opTaskId ? taskOpStatusMap.get(detail.opTaskId) : undefined}
          onClose={() => setDetail(null)}
          onStatusChange={doStatusChange}
          onUndo={doUndo}
          onResetToPending={doResetToPending}
          onImprove={doImprove}
          onSyncStatus={doSyncStatus}
          onConfirm={doConfirm}
          onEdit={s => { setDetail(null); setEditSession(s) }}
        />
      )}

      {/* Edit modal */}
      {editSession && (
        <EditSessionModal
          session={editSession}
          onClose={() => setEditSession(null)}
          onSaved={updated => doEditSaved(editSession.id, updated)}
        />
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2"><Bot size={16} /> Auto Log</h2>
          <p className="text-xs text-gray-400 mt-0.5">Sessions from Claude Code — synced to OpenProject</p>
        </div>
        {mainTab === 'sessions' && (
          <button onClick={() => setQuickLogOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white rounded-lg transition flex-shrink-0 hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, #059669, #10b981)' }}>
            <Pencil size={12} /> Quick Log
          </button>
        )}
      </div>

      {/* Main sub-nav */}
      <div className="flex gap-0 border-b border-gray-200 dark:border-gray-700">
        {([
          { id: 'sessions'  as const, icon: <Bot size={12} />,    label: 'Sessions',    count: sessions.length },
          { id: 'my-tasks'  as const, icon: <Folder size={12} />, label: 'My OP Tasks', count: (cache.myOpenTasks?.length ?? 0) + (cache.myClosedTasks?.length ?? 0) },
          { id: 'untracked' as const, icon: <Pin size={12} />,    label: 'Untracked',   count: (cache.myOpenTasks ?? []).filter(t => !sessions.some(s => s.opTaskId === t.id) && t.islStatus !== 'done' && t.islStatus !== 'rejected').length },
        ]).map(({ id, icon, label, count }) => (
          <button key={id} onClick={() => setMainTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition -mb-px ${
              mainTab === id
                ? 'border-violet-500 text-violet-600 dark:text-violet-400'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}>
            {icon}{label} <span className="text-[10px] opacity-60 ml-0.5">({count})</span>
          </button>
        ))}
      </div>

      {/* My OP Tasks tab */}
      {mainTab === 'my-tasks' && (() => {
        // In TEST mode, only show tasks from the test project (scrum-project)
        // In LIVE mode, show all watched project tasks
        const modeProject = opMode?.mode === 'test' ? (opMode.project ?? 'scrum-project') : null
        const filterByProject = (tasks: OPTask[]) =>
          modeProject ? tasks.filter(t => t.project === modeProject) : tasks
        return (
          <MyOPTasksTab
            openTasks={filterByProject(cache.myOpenTasks ?? [])}
            closedTasks={filterByProject(cache.myClosedTasks ?? [])}
            sprints={cache.sprints ?? []}
            opUrl={opUrl}
            onToast={showToast}
            modeLabel={opMode?.mode === 'test' ? `TEST · ${opMode.project ?? 'scrum-project'}` : null}
            sprintStats={sprintStats}
            activeTimerTaskId={activeTimer?.taskId ?? null}
            onSessionLogged={load}
          />
        )
      })()}

      {/* Untracked tab */}
      {mainTab === 'untracked' && (
        <div className="space-y-3">
          {!sprintStats && !loading && (
            <div className="flex items-center gap-2 px-4 py-2.5 border border-amber-100 dark:border-amber-900 rounded-xl bg-amber-50/50 dark:bg-amber-950/20 text-[10px] text-amber-600 dark:text-amber-400">
              <AlertTriangle size={12} className="flex-shrink-0" />
              <span>Tidak ada sprint berjalan — sprint stats tidak tersedia.</span>
            </div>
          )}
          {sprintStats && (() => {
            const b = sprintStats.buckets
            return (
              <div className="border border-gray-100 dark:border-gray-800 rounded-xl px-4 py-2.5 space-y-1.5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1 text-[10px] font-bold text-violet-600 dark:text-violet-400"><CalendarDays size={10} />{sprintStats.sprint.name}</span>
                    <span className="text-[10px] text-gray-400">ends {sprintStats.sprint.endDate}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="text-gray-400">{sprintStats.total} total</span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">{sprintStats.pct}% done</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {b.new > 0 && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 flex items-center gap-1"><span className="w-1 h-1 rounded-full bg-gray-400 inline-block" />{b.new} New</span>}
                  {b.in_progress > 0 && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950 text-blue-600 flex items-center gap-1"><span className="w-1 h-1 rounded-full bg-blue-500 inline-block" />{b.in_progress} In Progress</span>}
                  {b.done > 0 && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950 text-emerald-600 flex items-center gap-1"><span className="w-1 h-1 rounded-full bg-emerald-500 inline-block" />{b.done} Closed</span>}
                  <div className="flex-1 min-w-16 bg-gray-200 dark:bg-gray-700 rounded-full h-1 overflow-hidden ml-1">
                    <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${sprintStats.pct}%` }} />
                  </div>
                </div>
              </div>
            )
          })()}
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-[11px] text-gray-400 flex-shrink-0"><CalendarDays size={11} />Sprint:</span>
            <div className="flex gap-1 flex-wrap">
              <button onClick={() => setSprintFilter(null)}
                className={`px-2.5 py-1 text-[10px] font-semibold rounded-full transition ${sprintFilter === null ? 'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 hover:bg-gray-200'}`}>
                All
              </button>
              {availableSprints.map(sp => (
                <button key={sp.id} onClick={() => setSprintFilter(sprintFilter === sp.id ? null : sp.id)}
                  className={`px-2.5 py-1 text-[10px] font-semibold rounded-full transition ${sprintFilter === sp.id ? 'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300' : sp.isCurrent ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 hover:bg-emerald-100' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 hover:bg-gray-200'}`}>
                  {sp.name}{sp.isCurrent ? ' ●' : ''}
                </button>
              ))}
            </div>
          </div>
          <ActiveInOP
            openTasks={cache.myOpenTasks ?? []}
            trackedTaskIds={new Set(sessions.map(s => s.opTaskId).filter(Boolean) as number[])}
            sprintFilter={sprintFilter}
            opUrl={opUrl}
            onToast={showToast}
            standalone
          />
        </div>
      )}

      {/* Sessions tab content */}
      {mainTab === 'sessions' && <>

      {/* Sprint filter — first so user knows context before seeing counts */}
      {availableSprints.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-[11px] text-gray-400 flex-shrink-0"><CalendarDays size={9} /> Sprint:</span>
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => setSprintFilter(null)}
              className={`px-2.5 py-1 text-[10px] font-semibold rounded-full transition ${
                sprintFilter === null
                  ? 'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300'
                  : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}>
              All
            </button>
            {availableSprints.map(sp => (
              <button
                key={sp.id}
                onClick={() => setSprintFilter(sprintFilter === sp.id ? null : sp.id)}
                className={`px-2.5 py-1 text-[10px] font-semibold rounded-full transition ${
                  sprintFilter === sp.id
                    ? 'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300'
                    : sp.isCurrent
                    ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400 hover:bg-emerald-100'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}>
                {sp.name}{sp.isCurrent ? ' ●' : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Stats bar */}
      <div className="flex items-center gap-4 px-4 py-2 bg-gray-50 dark:bg-gray-800 rounded-xl text-xs text-gray-500 dark:text-gray-400">
        <span><span className="font-bold text-gray-800 dark:text-gray-100">{filtered.length}</span> sessions</span>
        <span className="flex items-center gap-1"><span className="font-bold text-gray-800 dark:text-gray-100 flex items-center gap-0.5"><Clock size={10} />{formatDur(totalMins)}</span> <span className="text-gray-400">actual to OP</span></span>
        {pendingVal > 0 && (
          <button
            onClick={() => { setFilter('all'); showToast(`Showing ${pendingVal} sessions needing validation`) }}
            className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold hover:underline">
            <AlertTriangle size={10} /> {pendingVal} need validation
          </button>
        )}
        <button onClick={() => load()} className="ml-auto flex items-center gap-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition" title="Refresh"><RefreshCw size={12} /> Refresh</button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {(['pushed', 'all', 'discarded', 'abandoned'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-2 text-xs font-semibold border-b-2 transition -mb-px ${
              filter === f ? 'border-violet-500 text-violet-600 dark:text-violet-400' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}>
            {f === 'pushed'    ? `Pushed (${tabCounts.pushed})`
            : f === 'all'      ? `All (${tabCounts.all})`
            : f === 'discarded'? `Backlogged (${tabCounts.discarded})`
            :                    `Abandoned (${tabCounts.abandoned})`}
          </button>
        ))}
      </div>

      {/* Epic → Story → Task → Session tree */}
      {epicList.length === 0 ? (
        <div className="text-center text-gray-400 text-sm py-16">
          <div className="mb-3 flex justify-center"><Bot size={40} className="text-gray-300 dark:text-gray-600" /></div>
          <p className="font-medium">No sessions yet.</p>
          <p className="text-xs mt-1 text-gray-300 dark:text-gray-600">Every completed Claude Code session will appear here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {epicList.map(epic => (
            <EpicGroup
              key={epic.epicId ?? 0}
              epicId={epic.epicId}
              epicName={epic.epicName}
              storyGroups={epic.storyGroups}
              opUrl={opUrl}
              onSessionClick={s => setDetail(s)}
              onSyncStatus={doSyncStatus}
              defaultOpen={epicList.length === 1}
            />
          ))}
        </div>
      )}

      </> /* end sessions tab */}

      {quickLogOpen && (
        <QuickLogModal onClose={() => setQuickLogOpen(false)} onSaved={load} />
      )}
    </div>
  )
}

// ── Active in OP (untracked tasks) ────────────────────────────────────────────
function ActiveInOP({
  openTasks, trackedTaskIds, sprintFilter, opUrl, onToast, standalone = false,
}: {
  openTasks: OPTask[]
  trackedTaskIds: Set<number>
  sprintFilter: number | null
  opUrl: string
  onToast: (msg: string) => void
  standalone?: boolean
}) {
  const [open, setOpen] = useState(standalone)
  const [showAll, setShowAll] = useState(false)

  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000

  const untracked = openTasks.filter(t => {
    if (trackedTaskIds.has(t.id)) return false
    if (t.islStatus === 'done' || t.islStatus === 'rejected') return false
    // When sprint filter active, only show tasks in that sprint
    if (sprintFilter !== null) return t.sprintId === sprintFilter
    // Default (All): show tasks with sprint assigned OR in_progress without sprint
    // Hide old "new" tasks with no sprint unless showAll
    if (!showAll) {
      if (!t.sprintId && t.islStatus !== 'in_progress') return false
    }
    return true
  })

  if (untracked.length === 0) return null

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-amber-200 dark:border-amber-800 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-amber-50 dark:hover:bg-amber-950/20 transition text-left"
      >
        <span className="text-gray-400 flex-shrink-0">{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
        <Pin size={14} className="text-amber-500 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-bold text-gray-800 dark:text-gray-100">Active in OP</span>
          <span className="text-[11px] text-gray-400 ml-2">tasks open in OP without ISL session</span>
        </div>
        <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 flex-shrink-0">
          {untracked.length} task{untracked.length > 1 ? 's' : ''}
        </span>
      </button>
      {open && (
        <div className="border-t border-amber-100 dark:border-amber-900">
          {sprintFilter === null && (
            <div className="flex items-center justify-between px-4 py-2 bg-amber-50 dark:bg-amber-950/20">
              <span className="text-[10px] text-gray-400">
                {showAll ? 'Showing all open tasks' : 'Showing sprint & in-progress tasks only'}
              </span>
              <button
                onClick={() => setShowAll(!showAll)}
                className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 hover:underline">
                {showAll ? 'Show less' : 'Show all'}
              </button>
            </div>
          )}
          <div className="divide-y divide-gray-50 dark:divide-gray-800">
          {untracked.map(t => (
            <div key={t.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                t.islStatus === 'in_progress' ? 'bg-blue-400' :
                t.islStatus === 'on_hold'     ? 'bg-amber-400' :
                'bg-gray-300'
              }`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <a href={`${opUrl}/work_packages/${t.id}`} target="_blank" rel="noopener"
                    className="text-[11px] font-mono font-bold text-indigo-400 hover:text-indigo-600 flex-shrink-0">
                    #{t.id}
                  </a>
                  <span className="text-xs text-gray-700 dark:text-gray-200 truncate">{t.subject}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-400">
                  {t.islStatus && <span className="capitalize">{t.islStatus.replace('_', ' ')}</span>}
                  {t.sprintName && <><span>·</span><span className="flex items-center gap-0.5"><CalendarDays size={9} />{t.sprintName}</span></>}
                  {t.assignee && <><span>·</span><span className="flex items-center gap-0.5"><User size={9} />{t.assignee}</span></>}
                </div>
              </div>
              <button
                onClick={() => { navigator.clipboard.writeText(`!ticket:${t.id}`); onToast(`Copied !ticket:${t.id}`) }}
                className="px-2.5 py-1 text-[10px] font-semibold text-indigo-600 border border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950 transition flex-shrink-0">
                !ticket
              </button>
            </div>
          ))}
          </div>
        </div>
      )}
    </div>
  )
}
