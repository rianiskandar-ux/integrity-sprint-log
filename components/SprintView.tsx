'use client'

import { useState, useEffect } from 'react'
import { format, differenceInDays, parseISO } from 'date-fns'
import type { Session } from '@/lib/parser'
import type { Project } from '@/lib/projects'
import type { CalendarEvent } from '@/app/api/calendar/events/route'

interface Props {
  projectSprints: Record<string, Record<number, Array<Session & { date: string }>>>
  sprintMeta: Record<number, { start: number; end: number; dates: string[]; sessions: number }>
  currentSprintNo: number
  viewSprintNo: number
  projects: Project[]
  onNavigate: (p: Record<string, string>) => void
}

export default function SprintView({ projectSprints, sprintMeta, currentSprintNo, viewSprintNo, projects, onNavigate }: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [reviewEvent, setReviewEvent] = useState<CalendarEvent | null>(null)
  const [agendaOpen, setAgendaOpen] = useState(false)
  const [allEvents, setAllEvents] = useState<CalendarEvent[]>([])

  useEffect(() => {
    fetch('/api/calendar/events?days=30')
      .then(r => r.json())
      .then(d => {
        if (d.connected && d.events?.length) {
          setReviewEvent(d.events[0])
          setAllEvents(d.events)
        }
      })
      .catch(() => {})
  }, [])
  const sprintNos = Object.keys(sprintMeta).map(Number).sort((a, b) => b - a)

  const viewMeta = sprintMeta[viewSprintNo]
  const projectsInSprint = projects.filter((p) => projectSprints[p.id]?.[viewSprintNo]?.length)

  function toggleProject(id: string) {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div>
      {/* Sprint selector */}
      <div className="flex items-center gap-2 flex-wrap mb-6">
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">Sprint</span>
        {sprintNos.map((sno) => {
          const sm = sprintMeta[sno]
          const isView = sno === viewSprintNo
          const isCurrent = sno === currentSprintNo
          return (
            <button
              key={sno}
              onClick={() => onNavigate({ view: 'sprint', sprint: String(sno) })}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                isView
                  ? 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 dark:border-indigo-700'
                  : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400'
              }`}
            >
              S{sno}
              <span className="font-normal text-[10px] ml-1">
                {format(new Date(sm.start), 'd MMM')}–{format(new Date(sm.end), 'd MMM')}
              </span>
              {isCurrent && <span className="ml-1 text-[9px] text-emerald-600 font-bold">NOW</span>}
            </button>
          )
        })}
      </div>

      {/* Sprint Review banner */}
      {reviewEvent && (() => {
        const eventDate = parseISO(reviewEvent.start.substring(0, 10))
        const daysUntil = differenceInDays(eventDate, new Date())
        if (daysUntil < 0 || daysUntil > 7) return null
        const isToday = daysUntil === 0
        const isTomorrow = daysUntil === 1

        // Build agenda from current sprint sessions
        const agendaLines: string[] = []
        projects.forEach(proj => {
          const sessions = projectSprints[proj.id]?.[currentSprintNo] ?? []
          if (!sessions.length) return
          agendaLines.push(`**${proj.name}** (${sessions.length} sesi)`)
          sessions.slice(0, 3).forEach(s => agendaLines.push(`  - ${s.title}`))
          if (sessions.length > 3) agendaLines.push(`  - +${sessions.length - 3} sesi lainnya`)
        })

        return (
          <div className={`mb-5 rounded-xl border p-4 ${isToday ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800' : isTomorrow ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800' : 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800'}`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-start gap-2.5">
                <span className="text-lg">{isToday ? '🔴' : isTomorrow ? '🟡' : '📅'}</span>
                <div>
                  <p className={`text-xs font-bold ${isToday ? 'text-red-700 dark:text-red-300' : isTomorrow ? 'text-amber-700 dark:text-amber-300' : 'text-blue-700 dark:text-blue-300'}`}>
                    {isToday ? 'Sprint Review HARI INI!' : isTomorrow ? 'Sprint Review BESOK — Siapkan agenda!' : `Sprint Review ${daysUntil} hari lagi`}
                  </p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                    {reviewEvent.summary} · {format(eventDate, 'd MMM yyyy')}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setAgendaOpen(!agendaOpen)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${isToday || isTomorrow ? 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50'}`}
              >
                {agendaOpen ? 'Tutup' : '📋 Lihat Agenda'}
              </button>
            </div>

            {agendaOpen && (
              <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Draft Agenda Sprint {currentSprintNo}</p>
                {agendaLines.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">Belum ada sesi di sprint ini.</p>
                ) : (
                  <div className="space-y-1">
                    {agendaLines.map((line, i) => (
                      <p key={i} className={`text-xs ${line.startsWith('**') ? 'font-semibold text-gray-800 dark:text-gray-200' : 'text-gray-500 dark:text-gray-400 pl-2'}`}>
                        {line.replace(/\*\*/g, '')}
                      </p>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => {
                    const text = `Sprint Review S${currentSprintNo} — Agenda\n\n` + agendaLines.map(l => l.replace(/\*\*/g, '')).join('\n')
                    navigator.clipboard.writeText(text)
                  }}
                  className="mt-3 px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                >
                  📋 Copy Agenda
                </button>
              </div>
            )}
          </div>
        )
      })()}

      {/* Sprint header card */}
      {viewMeta && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-5 shadow-sm">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">
                Sprint {viewSprintNo}
                {viewSprintNo === currentSprintNo && (
                  <span className="ml-2 text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 px-2 py-0.5 rounded-full font-semibold">In Progress</span>
                )}
                {viewSprintNo < currentSprintNo && (
                  <span className="ml-2 text-xs bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 px-2 py-0.5 rounded-full font-semibold">Completed</span>
                )}
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {format(new Date(viewMeta.start), 'd MMM yyyy')} – {format(new Date(viewMeta.end), 'd MMM yyyy')}
              </p>
            </div>
            <div className="flex gap-6">
              {[
                { val: viewMeta.sessions, lbl: 'Sessions' },
                { val: viewMeta.dates.length, lbl: 'Active Days' },
                { val: projectsInSprint.length, lbl: 'Projects' },
              ].map(({ val, lbl }) => (
                <div key={lbl} className="text-center">
                  <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{val}</div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide">{lbl}</div>
                </div>
              ))}
            </div>
          </div>

          {viewSprintNo < currentSprintNo && sprintMeta[viewSprintNo + 1] && (
            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-400">
              Sprint {viewSprintNo} reviewed at start of Sprint {viewSprintNo + 1} ({format(new Date(sprintMeta[viewSprintNo + 1].start), 'd MMM')})
            </div>
          )}
        </div>
      )}

      {/* Project cards */}
      {projectsInSprint.length === 0 && (
        <p className="text-sm text-gray-400 italic text-center py-16">Tidak ada session di sprint ini.</p>
      )}

      {/* GCal Events — full cards */}
      {allEvents.length > 0 && (
        <div className="mb-5">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-3">📅 Upcoming Events</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {allEvents.slice(0, 6).map(ev => {
              const evDate = parseISO(ev.start.substring(0, 10))
              const daysUntil = differenceInDays(evDate, new Date())
              const isToday = daysUntil === 0
              const isSoon = daysUntil <= 2
              return (
                <div key={ev.id} className={`rounded-xl border p-3 ${isToday ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800' : isSoon ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800' : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700'}`}>
                  <div className="flex items-start gap-2">
                    <div className="flex-shrink-0 text-center min-w-[36px]">
                      <div className="text-[10px] font-bold text-gray-400 uppercase">{format(evDate, 'MMM')}</div>
                      <div className="text-lg font-bold leading-none text-gray-800 dark:text-gray-200">{format(evDate, 'd')}</div>
                      <div className="text-[9px] text-gray-400">{format(evDate, 'EEE')}</div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 leading-snug">{ev.summary}</p>
                      {ev.start.length > 10 && (
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {new Date(ev.start).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                          {ev.end && ` – ${new Date(ev.end).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`}
                        </p>
                      )}
                      {ev.description && (
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 leading-relaxed line-clamp-2"
                          dangerouslySetInnerHTML={{ __html: ev.description.replace(/<[^>]+>/g, '').substring(0, 120) + (ev.description.length > 120 ? '…' : '') }} />
                      )}
                      {ev.calendarName && <p className="text-[9px] text-gray-400 mt-1">{ev.calendarName}</p>}
                    </div>
                    <div className="flex-shrink-0">
                      {isToday && <span className="text-[9px] font-bold text-red-600 bg-red-100 dark:bg-red-900 px-1.5 py-0.5 rounded-full">TODAY</span>}
                      {!isToday && daysUntil === 1 && <span className="text-[9px] font-bold text-amber-600 bg-amber-100 dark:bg-amber-900 px-1.5 py-0.5 rounded-full">BESOK</span>}
                      {!isToday && daysUntil > 1 && <span className="text-[9px] text-gray-400">{daysUntil}d</span>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="space-y-3">
        {projectsInSprint.map((proj) => {
          const sessions = projectSprints[proj.id]?.[viewSprintNo] ?? []
          const isCollapsed = collapsed[proj.id]
          return (
            <div key={proj.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
              <button
                onClick={() => toggleProject(proj.id)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-750 transition text-left"
              >
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm flex-shrink-0" style={{ background: proj.color }}>
                  {proj.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{proj.name}</p>
                  <p className="text-[11px] text-gray-400">{proj.desc}</p>
                </div>
                <span className="text-xs font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-full">
                  {sessions.length} session{sessions.length !== 1 ? 's' : ''}
                </span>
                <span className="text-gray-400 text-xs ml-1 transition-transform" style={{ transform: isCollapsed ? 'rotate(-90deg)' : '' }}>▾</span>
              </button>

              {!isCollapsed && (
                <div className="px-4 pb-4 space-y-2">
                  {sessions.map((s, i) => (
                    <div key={i} className="rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-700 p-3">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">{s.title}</p>
                        <div className="flex gap-1.5 flex-shrink-0 text-[10px] text-gray-400">
                          <span>{s.date}</span>
                          {s.time && <span>· {s.time}</span>}
                        </div>
                      </div>
                      {s.bullets.length > 0 && (
                        <ul className="space-y-1">
                          {s.bullets.slice(0, 4).map((b, j) => (
                            <li key={j} className="text-[11px] text-gray-600 dark:text-gray-400 pl-3 border-l-2 border-gray-200 dark:border-gray-600 leading-relaxed">{b}</li>
                          ))}
                          {s.bullets.length > 4 && (
                            <li className="text-[10px] text-gray-400 italic pl-3">+{s.bullets.length - 4} more</li>
                          )}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
