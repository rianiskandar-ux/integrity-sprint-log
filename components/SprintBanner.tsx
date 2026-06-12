'use client'

import { useState, useEffect } from 'react'
import type { CachedWorkPackage } from '@/lib/op-cache'
import { useI18n } from '@/lib/i18n'
import TaskChatModal, { type TaskChatContext } from './TaskChatModal'

interface Props {
  currentSprintNo: number
  sprintEndDate?: number
}

// Status dot color
const STATUS_DOT: Record<string, string> = {
  'In Progress': 'bg-blue-400',
  'On Hold':     'bg-amber-400',
  'New':         'bg-gray-300',
  'Closed':      'bg-emerald-400',
}

function TaskRow({ t, opUrl, myUserId, onChat }: {
  t: CachedWorkPackage; opUrl: string | null; myUserId: number | null
  onChat: (ctx: TaskChatContext) => void
}) {
  const link = opUrl ? `${opUrl}/work_packages/${t.id}` : null
  const dot  = STATUS_DOT[t.status] ?? 'bg-gray-300 dark:bg-gray-600'
  const fromOther = t.createdById !== null && myUserId !== null && t.createdById !== myUserId

  return (
    <div className="flex items-center gap-2 py-1 text-[11px] border-b border-gray-100 dark:border-gray-700/40 last:border-0 min-w-0 group">
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
      {link
        ? <a href={link} target="_blank" rel="noopener" className="text-indigo-400 font-mono hover:text-indigo-500 flex-shrink-0 font-semibold">#{t.id}</a>
        : <span className="text-indigo-400 font-mono flex-shrink-0 font-semibold">#{t.id}</span>
      }
      <span className="truncate flex-1 min-w-0 text-gray-700 dark:text-gray-300">{t.subject}</span>
      {fromOther && (
        <span className="flex-shrink-0 text-[10px] text-amber-500 italic">dari {t.createdBy?.split(' ')[0] ?? '?'}</span>
      )}
      {/* Chat button — visible on hover */}
      <button
        onClick={e => { e.stopPropagation(); onChat({ id: `banner-${t.id}`, title: t.subject, taskType: fromOther ? 'incoming' : 'session', opTaskId: t.id, sprintName: t.sprintName ?? null, status: t.status }) }}
        className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition text-[9px] font-semibold text-indigo-500 border border-indigo-200 dark:border-indigo-700 px-1.5 py-0.5 rounded-full hover:bg-indigo-50 dark:hover:bg-indigo-950">
        💬
      </button>
      <span className="flex-shrink-0 text-[10px] text-gray-400">{t.status}</span>
    </div>
  )
}

export default function SprintBanner({ currentSprintNo, sprintEndDate }: Props) {
  const { lang } = useI18n()
  const [tasks, setTasks]         = useState<CachedWorkPackage[]>([])
  const [expanded, setExpanded]   = useState(false)
  const [daysLeft, setDaysLeft]   = useState<number | null>(null)
  const [opUrl, setOpUrl]         = useState<string | null>(null)
  const [myUserId, setMyUserId]   = useState<number | null>(null)
  const [incomingCount, setIncomingCount] = useState(0)
  const [lastSync, setLastSync]   = useState<string | null>(null)
  const [opSprintName, setOpSprintName] = useState<string | null>(null)
  const [chatTask, setChatTask]         = useState<TaskChatContext | null>(null)

  function refreshCache() {
    fetch('/api/op/cache')
      .then(r => r.json())
      .then(d => {
        setTasks(d.myOpenTasks ?? [])
        setIncomingCount((d.incomingTasks ?? []).filter((t: CachedWorkPackage) => t.islStatus !== 'done').length)
        setLastSync(d.lastSync ?? null)
        const current = (d.sprints ?? []).find((s: { isCurrent: boolean }) => s.isCurrent)
        if (current) setOpSprintName(current.name)
      })
      .catch(() => {})
  }

  useEffect(() => {
    refreshCache()
    window.addEventListener('isl:cache-refreshed', refreshCache)

    if (sprintEndDate != null) {
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const end   = new Date(sprintEndDate as number); end.setHours(0, 0, 0, 0)
      setDaysLeft(Math.round((end.getTime() - today.getTime()) / 86400000))
    }

    try {
      const appCfg = localStorage.getItem('isl_app_config')
      const s      = localStorage.getItem('isl_user_settings')
      const opUrlVal: string = appCfg
        ? ((JSON.parse(appCfg as string) as { opUrl?: string }).opUrl ?? 'https://tokek.integrity-asia.com')
        : 'https://tokek.integrity-asia.com'
      setOpUrl(opUrlVal)
      if (s) setMyUserId((JSON.parse(s as string) as { userId?: number }).userId ?? null)
    } catch {}
    fetch('/api/op/mode').then(r => r.json()).then(d => { if (d.userId) setMyUserId(d.userId) }).catch(() => {})

    return () => window.removeEventListener('isl:cache-refreshed', refreshCache)
  }, [currentSprintNo, sprintEndDate])  // eslint-disable-line react-hooks/exhaustive-deps

  if (tasks.length === 0 && daysLeft === null) return null

  const isUrgent  = daysLeft !== null && daysLeft <= 1
  const isWarning = daysLeft !== null && daysLeft <= 3 && daysLeft > 1

  const actionable  = tasks.filter(t => t.type !== 'Epic')
  const quickTasks  = actionable.filter(t => t.type === 'Task' || t.type === 'Bug')
  const heavyTasks  = actionable.filter(t => t.type !== 'Task' && t.type !== 'Bug')
  const ownCount    = actionable.filter(t => t.isOwn).length
  const othersCount = actionable.filter(t => !t.isOwn).length

  const bgClass = isUrgent
    ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800'
    : isWarning
    ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800'
    : 'bg-blue-50/60 dark:bg-blue-950/20 border-blue-100 dark:border-blue-900'

  const textClass = isUrgent ? 'text-red-700 dark:text-red-300'
    : isWarning ? 'text-amber-700 dark:text-amber-300'
    : 'text-blue-700 dark:text-blue-300'

  const icon = isUrgent ? '🔴' : isWarning ? '🟡' : '🔵'

  return (
    <div className={`border-b ${bgClass}`}>
      {/* Compact single-line header */}
      <div className="flex items-center gap-2 px-4 lg:px-6 py-1.5 flex-wrap">
        <span className="text-xs flex-shrink-0">{icon}</span>

        {daysLeft !== null && (
          <span className={`text-xs font-bold ${textClass} flex-shrink-0`}>
            {opSprintName ?? `S${currentSprintNo}`}:{' '}
            {daysLeft < 0  ? (lang === 'id' ? 'Selesai' : 'Ended')
             : daysLeft === 0 ? (lang === 'id' ? 'Berakhir hari ini!' : 'Ends today!')
             : (lang === 'id' ? `${daysLeft}h lagi` : `${daysLeft}d left`)}
          </span>
        )}

        {actionable.length > 0 && (
          <span className="text-[11px] text-gray-500 dark:text-gray-400 flex-shrink-0">
            <span className="font-semibold text-gray-700 dark:text-gray-300">{actionable.length}</span> open
            {ownCount > 0 && othersCount > 0 && (
              <span className="ml-1 text-[10px] text-gray-400">({ownCount} gw · {othersCount} orang)</span>
            )}
          </span>
        )}

        {/* Sprint suggestion — only show when critical */}
        {daysLeft !== null && daysLeft <= 3 && actionable.length > 0 && (
          <span className="text-[10px] text-gray-400 flex-shrink-0 hidden sm:inline">
            {quickTasks.length > 0 && `✅ ${quickTasks.length} sprint ini`}
            {quickTasks.length > 0 && heavyTasks.length > 0 && ' · '}
            {heavyTasks.length > 0 && `➡️ ${heavyTasks.length} geser next`}
          </span>
        )}

        {/* Incoming badge */}
        {incomingCount > 0 && (
          <span className="flex-shrink-0 text-[10px] font-semibold bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded-full">
            📥 {incomingCount} masuk
          </span>
        )}

        {actionable.length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] text-indigo-500 hover:text-indigo-600 underline flex-shrink-0 transition ml-auto"
          >
            {expanded ? (lang === 'id' ? 'Tutup' : 'Hide') : (lang === 'id' ? 'Lihat' : 'Show')}
          </button>
        )}
      </div>

      {/* Expandable task list — max height + scroll */}
      {expanded && actionable.length > 0 && (
        <div className="px-4 lg:px-6 pb-2">
          <div className="max-h-52 overflow-y-auto rounded-lg bg-white dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700 px-3 py-1">
            {daysLeft !== null && daysLeft <= 3 && quickTasks.length > 0 && (
              <p className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide pt-1.5 pb-0.5">
                ✅ Sprint ini
              </p>
            )}
            {(daysLeft === null || daysLeft > 3 ? actionable : quickTasks).map(t =>
              <TaskRow key={t.id} t={t} opUrl={opUrl} myUserId={myUserId} onChat={setChatTask} />
            )}
            {daysLeft !== null && daysLeft <= 3 && heavyTasks.length > 0 && (
              <>
                <p className="text-[10px] font-semibold text-amber-500 dark:text-amber-400 uppercase tracking-wide pt-2 pb-0.5">
                  ➡️ Next sprint
                </p>
                {heavyTasks.map(t => <TaskRow key={t.id} t={t} opUrl={opUrl} myUserId={myUserId} onChat={setChatTask} />)}
              </>
            )}
          </div>
        </div>
      )}

      {chatTask && (
        <TaskChatModal task={chatTask} onClose={() => setChatTask(null)} />
      )}
    </div>
  )
}
