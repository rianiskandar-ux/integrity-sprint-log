'use client'

import { useState, useEffect } from 'react'
import type { CachedWorkPackage } from '@/lib/op-cache'

interface Props {
  currentSprintNo: number
  sprintEndDate?: number
}

export default function SprintBanner({ currentSprintNo, sprintEndDate }: Props) {
  const [dismissed, setDismissed] = useState(false)
  const [tasks, setTasks] = useState<CachedWorkPackage[]>([])
  const [expanded, setExpanded] = useState(false)
  const [show, setShow] = useState(false)

  useEffect(() => {
    const key = `sprint_banner_dismissed_${currentSprintNo}`
    if (localStorage.getItem(key)) { setDismissed(true); return }

    if (!sprintEndDate) return
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const end = new Date(sprintEndDate)
    end.setHours(0, 0, 0, 0)
    const daysLeft = Math.round((end.getTime() - today.getTime()) / 86400000)

    if (daysLeft <= 3 && daysLeft >= 0) {
      setShow(true)
      // Load open tasks from cache
      fetch('/api/op/cache')
        .then(r => r.json())
        .then(d => setTasks((d.myOpenTasks ?? []).slice(0, 10)))
        .catch(() => {})
    }
  }, [currentSprintNo, sprintEndDate])

  function dismiss() {
    localStorage.setItem(`sprint_banner_dismissed_${currentSprintNo}`, '1')
    setDismissed(true)
  }

  if (!show || dismissed) return null

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const end = sprintEndDate ? new Date(sprintEndDate) : null
  if (end) end.setHours(0, 0, 0, 0)
  const daysLeft = end ? Math.round((end.getTime() - today.getTime()) / 86400000) : null

  const isUrgent = daysLeft !== null && daysLeft <= 1
  const bgClass = isUrgent
    ? 'bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800'
    : 'bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800'
  const textClass = isUrgent ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'

  return (
    <div className={`border-b ${bgClass} px-4 lg:px-6 py-2.5`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-sm flex-shrink-0">{isUrgent ? '🔴' : '🟡'}</span>
          <p className={`text-xs font-semibold ${textClass}`}>
            Sprint {currentSprintNo} berakhir dalam {daysLeft === 0 ? 'hari ini!' : `${daysLeft} hari`}
            {tasks.length > 0 && <span className="font-normal text-gray-500 dark:text-gray-400"> · {tasks.length} task terbuka</span>}
          </p>
          {tasks.length > 0 && (
            <button onClick={() => setExpanded(!expanded)}
              className="text-[10px] text-gray-500 dark:text-gray-400 underline flex-shrink-0">
              {expanded ? 'Sembunyikan' : 'Lihat daftar'}
            </button>
          )}
        </div>
        <button onClick={dismiss} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xs flex-shrink-0 px-1" title="Tutup (tidak muncul lagi sprint ini)">✕</button>
      </div>

      {expanded && tasks.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
          {tasks.map(t => (
            <span key={t.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
              <span className="text-gray-400">#{t.id}</span>
              <span className="truncate max-w-[180px]">{t.subject}</span>
              <span className="text-gray-400 text-[9px]">{t.project}</span>
            </span>
          ))}
          <span className="text-[10px] text-gray-400 flex items-center">→ Pertimbangkan move ke sprint berikutnya jika belum bisa selesai</span>
        </div>
      )}
    </div>
  )
}
