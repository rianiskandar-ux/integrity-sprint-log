'use client'

import { useState } from 'react'
import type { SprintDay, Session } from '@/lib/parser'
import type { Project } from '@/lib/projects'
import { tagSessionToProject, getProjectById } from '@/lib/projects'
import SessionDetailModal from './SessionDetailModal'
import { useI18n } from '@/lib/i18n'

function inlineMarkdown(text: string) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code class="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs font-mono">$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" class="text-indigo-600 underline" target="_blank">$1</a>')
}

interface Props {
  dayData: SprintDay | null
  projects: Project[]
  isToday?: boolean
  onAddSession?: () => void
}

export default function DailyView({ dayData, projects, isToday, onAddSession }: Props) {
  const { t, lang } = useI18n()
  const [detailSession, setDetailSession] = useState<(Session & { date?: string }) | null>(null)
  const detailProject = detailSession
    ? getProjectById(tagSessionToProject(detailSession.title, detailSession.bullets.join(' ')))
    : null

  if (!dayData) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3 text-gray-400">
        <span className="text-3xl">📭</span>
        <p className="text-sm">{t('daily.no_data')}</p>
      </div>
    )
  }

  const { sessions, op_done, open_tasks } = dayData
  const empty = !sessions.length && !op_done.length && !open_tasks.length

  if (empty) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-gray-400">
        <span className="text-4xl">{isToday ? '☀️' : '🌿'}</span>
        <div className="text-center">
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            {isToday ? t('daily.no_activity_today') : t('daily.no_activity_date')}
          </p>
          {isToday && (
            <p className="text-xs text-gray-400 mt-1">{t('daily.start_hint')}</p>
          )}
        </div>
        {isToday && onAddSession && (
          <button
            onClick={onAddSession}
            className="px-4 py-2 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
          >
            {t('header.add_session')}
          </button>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* My Sessions */}
        <Column
          title={t('daily.col_activities')}
          count={sessions.length}
          colorClass="bg-indigo-50 dark:bg-indigo-950 border-indigo-100 dark:border-indigo-900 text-indigo-600 dark:text-indigo-400"
          badgeClass="bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300"
          empty={t('daily.no_activity_today')}
        >
          {sessions.map((s, i) => {
            const proj = getProjectById(tagSessionToProject(s.title, s.bullets.join(' ')))
            return (
              <button
                key={i}
                onClick={() => setDetailSession(s)}
                className="w-full text-left rounded-lg border border-gray-100 dark:border-gray-700 p-3 bg-white dark:bg-gray-800 hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-sm transition"
              >
                <div className="flex items-start gap-2 mb-1">
                  <span className="text-sm">{proj.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 leading-snug"
                      dangerouslySetInnerHTML={{ __html: inlineMarkdown(s.title) }} />
                    {s.time && <p className="text-[10px] text-gray-400 mt-0.5">{s.time}</p>}
                  </div>
                  <span className="text-[10px] text-gray-300 dark:text-gray-600 flex-shrink-0">›</span>
                </div>
                {s.bullets.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {s.bullets.slice(0, 3).map((b, j) => (
                      <li
                        key={j}
                        className="text-[11px] text-gray-600 dark:text-gray-400 pl-3 border-l-2 border-gray-200 dark:border-gray-600 leading-relaxed"
                        dangerouslySetInnerHTML={{ __html: inlineMarkdown(b) }}
                      />
                    ))}
                    {s.bullets.length > 3 && (
                      <li className="text-[10px] text-indigo-400 pl-3">+{s.bullets.length - 3} {t('daily.more')}</li>
                    )}
                  </ul>
                )}
                <div className="mt-2">
                  <span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full text-white" style={{ background: proj.color }}>
                    {proj.name}
                  </span>
                </div>
              </button>
            )
          })}
        </Column>

        {/* OpenProject Done */}
        <Column
          title={t('daily.col_op')}
          count={op_done.length}
          colorClass="bg-emerald-50 dark:bg-emerald-950 border-emerald-100 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400"
          badgeClass="bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300"
          empty={t('daily.empty_op')}
        >
          {op_done.map((item, i) => (
            <div key={i} className="text-xs text-gray-700 dark:text-gray-300 py-2 px-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700"
              dangerouslySetInnerHTML={{ __html: inlineMarkdown(item) }} />
          ))}
        </Column>

        {/* Open Tasks */}
        <Column
          title={t('daily.col_tasks')}
          count={open_tasks.length}
          colorClass="bg-amber-50 dark:bg-amber-950 border-amber-100 dark:border-amber-900 text-amber-700 dark:text-amber-400"
          badgeClass="bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300"
          empty={t('daily.empty_tasks')}
        >
          {open_tasks.map((tk, i) => (
            <div key={i} className="text-xs text-gray-700 dark:text-gray-300 py-2 px-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700"
              dangerouslySetInnerHTML={{ __html: inlineMarkdown(tk) }} />
          ))}
        </Column>
      </div>

      {/* Session detail modal */}
      {detailSession && detailProject && (
        <SessionDetailModal
          session={detailSession}
          project={detailProject}
          onClose={() => setDetailSession(null)}
        />
      )}
    </>
  )
}

function Column({ title, count, colorClass, badgeClass, empty, children }: {
  title: string; count: number; colorClass: string; badgeClass: string; empty: string; children: React.ReactNode
}) {
  return (
    <div className="bg-gray-50 dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <div className={`px-4 py-3 border-b ${colorClass} flex items-center justify-between`}>
        <span className="text-xs font-bold uppercase tracking-wide">{title}</span>
        {count > 0 && <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${badgeClass}`}>{count}</span>}
      </div>
      <div className="p-3 space-y-2">
        {count === 0 ? <p className="text-xs text-gray-400 italic py-4 text-center">{empty}</p> : children}
      </div>
    </div>
  )
}
