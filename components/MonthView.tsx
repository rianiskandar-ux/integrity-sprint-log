'use client'

import { format, parseISO } from 'date-fns'
import type { SprintDay } from '@/lib/parser'
import type { Project } from '@/lib/projects'
import { tagSessionToProject, getProjectById } from '@/lib/projects'

interface Props {
  monthMap: Record<string, SprintDay[]>
  projects: Project[]
}

export default function MonthView({ monthMap, projects }: Props) {
  const months = Object.keys(monthMap).sort().reverse()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">Monthly Log</h2>
        <p className="text-xs text-gray-400">{months.length} months recorded</p>
      </div>

      {months.map((month) => {
        const days = monthMap[month]
        const totalSessions = days.reduce((n, d) => n + d.sessions.length, 0)
        const activeDays = days.filter((d) => d.sessions.length > 0).length

        const projCount: Record<string, number> = {}
        for (const day of days) {
          for (const s of day.sessions) {
            const pid = tagSessionToProject(s.title, s.bullets.join(' '))
            projCount[pid] = (projCount[pid] ?? 0) + 1
          }
        }
        const topProjects = Object.entries(projCount).sort((a, b) => b[1] - a[1]).slice(0, 5)

        return (
          <div key={month} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                {format(parseISO(month + '-01'), 'MMMM yyyy')}
              </h3>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400">{activeDays} active days</span>
                <span className="text-xs font-semibold bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded-full">
                  {totalSessions} sessions
                </span>
              </div>
            </div>

            {topProjects.length > 0 && (
              <div className="px-5 py-3 flex flex-wrap gap-1.5 border-b border-gray-50 dark:border-gray-800">
                {topProjects.map(([pid, count]) => {
                  const proj = getProjectById(pid)
                  return (
                    <span
                      key={pid}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full text-white"
                      style={{ background: proj.color }}
                    >
                      {proj.icon} {proj.name} <span className="opacity-75">× {count}</span>
                    </span>
                  )
                })}
              </div>
            )}

            <div className="divide-y divide-gray-50 dark:divide-gray-800">
              {days.filter((d) => d.sessions.length > 0).map((day) => (
                <div key={day.date} className="px-5 py-3">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 w-28 flex-shrink-0">
                      {format(parseISO(day.date), 'EEE, d MMM')}
                    </span>
                    <span className="text-[10px] text-gray-400">{day.sessions.length} session{day.sessions.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {day.sessions.map((s, i) => {
                      const proj = getProjectById(tagSessionToProject(s.title, s.bullets.join(' ')))
                      return (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border font-medium"
                          style={{ borderColor: proj.color + '40', color: proj.color, background: proj.color + '15' }}
                        >
                          {proj.icon} {s.title}
                        </span>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
