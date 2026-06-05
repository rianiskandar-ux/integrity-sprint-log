'use client'

import { useState, useEffect } from 'react'
import type { CachedWorkPackage } from '@/lib/op-cache'

interface Props {
  currentSprintNo: number
  sprintEndDate?: number
}

export default function SprintBanner({ currentSprintNo, sprintEndDate }: Props) {
  const [tasks, setTasks] = useState<CachedWorkPackage[]>([])
  const [expanded, setExpanded] = useState(false)
  const [daysLeft, setDaysLeft] = useState<number | null>(null)

  useEffect(() => {
    // Always load open tasks from cache
    fetch('/api/op/cache')
      .then(r => r.json())
      .then(d => setTasks(d.myOpenTasks ?? []))
      .catch(() => {})

    if (sprintEndDate) {
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const end = new Date(sprintEndDate); end.setHours(0, 0, 0, 0)
      setDaysLeft(Math.round((end.getTime() - today.getTime()) / 86400000))
    }
  }, [currentSprintNo, sprintEndDate])

  if (tasks.length === 0 && daysLeft === null) return null

  const isUrgent = daysLeft !== null && daysLeft <= 1
  const isWarning = daysLeft !== null && daysLeft <= 3 && daysLeft > 1

  // Classify: Tasks = quick (can finish), User Stories = heavy (move to next)
  const quickTasks = tasks.filter(t => t.type === 'Task' || t.type === 'Bug')
  const heavyTasks = tasks.filter(t => t.type !== 'Task' && t.type !== 'Bug')

  const bgClass = isUrgent
    ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800'
    : isWarning
    ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800'
    : 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800'

  const textClass = isUrgent
    ? 'text-red-700 dark:text-red-300'
    : isWarning
    ? 'text-amber-700 dark:text-amber-300'
    : 'text-blue-700 dark:text-blue-300'

  const icon = isUrgent ? '🔴' : isWarning ? '🟡' : '🔵'

  return (
    <div className={`border-b ${bgClass} px-4 lg:px-6 py-2`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
          <span className="text-sm flex-shrink-0">{icon}</span>

          {/* Sprint countdown */}
          {daysLeft !== null && (
            <span className={`text-xs font-bold ${textClass} flex-shrink-0`}>
              S{currentSprintNo}:
              {daysLeft < 0 ? ' Sprint selesai' : daysLeft === 0 ? ' Berakhir hari ini!' : ` ${daysLeft}h lagi`}
            </span>
          )}

          {/* Open task count — always visible */}
          {tasks.length > 0 && (
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex-shrink-0">
              <span className="inline-flex items-center gap-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-2 py-0.5 rounded-full">
                📋 {tasks.length} open task{tasks.length > 1 ? 's' : ''}
              </span>
            </span>
          )}

          {/* AI suggestion */}
          {tasks.length > 0 && daysLeft !== null && daysLeft <= 3 && (
            <span className="text-[10px] text-gray-500 dark:text-gray-400 flex-shrink-0">
              {quickTasks.length > 0 && `✅ ${quickTasks.length} bisa selesai sprint ini`}
              {quickTasks.length > 0 && heavyTasks.length > 0 && ' · '}
              {heavyTasks.length > 0 && `➡️ ${heavyTasks.length} sebaiknya pindah ke sprint berikutnya`}
            </span>
          )}

          {tasks.length > 0 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[10px] text-indigo-500 hover:text-indigo-600 underline flex-shrink-0 transition"
            >
              {expanded ? 'Sembunyikan' : 'Lihat semua'}
            </button>
          )}
        </div>
      </div>

      {/* Expanded task list — always expandable, cannot be dismissed */}
      {expanded && tasks.length > 0 && (
        <div className="mt-2 pl-6 space-y-1">
          {quickTasks.length > 0 && (
            <>
              <p className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">✅ Bisa selesai sprint ini</p>
              {quickTasks.map(t => (
                <div key={t.id} className="flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-400">
                  <span className="text-gray-400 font-mono">#{t.id}</span>
                  <span className="truncate max-w-xs">{t.subject}</span>
                  <span className="text-[10px] text-gray-400">{t.project}</span>
                </div>
              ))}
            </>
          )}
          {heavyTasks.length > 0 && (
            <>
              <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wide mt-2">➡️ Pertimbangkan pindah ke sprint berikutnya</p>
              {heavyTasks.map(t => (
                <div key={t.id} className="flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-400">
                  <span className="text-gray-400 font-mono">#{t.id}</span>
                  <span className="truncate max-w-xs">{t.subject}</span>
                  <span className="text-[10px] text-gray-400">{t.project}</span>
                </div>
              ))}
            </>
          )}
          {daysLeft === null && tasks.map(t => (
            <div key={t.id} className="flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-400">
              <span className="text-gray-400 font-mono">#{t.id}</span>
              <span className="truncate max-w-xs">{t.subject}</span>
              <span className="text-[10px] text-gray-400">{t.project}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
