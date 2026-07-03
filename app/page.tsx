import { getSprintNumber, getSprintWindow } from '@/lib/parser'
import { getSprintDaysFromDB, getSprintDatesFromDB, getSprintDayFromDB } from '@/lib/sprint-from-db'
import { getRequestContext } from '@/lib/request-auth'
import { PROJECTS, tagSessionToProject } from '@/lib/projects'
import AppShell from '@/components/AppShell'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string; sprint?: string }>
}) {
  const sp = await searchParams
  if (sp.view === 'daily') {
    const date = sp.date ? `&date=${sp.date}` : ''
    redirect(`/?view=dailyhub${date}`)
  }
  const view = sp.view ?? 'isldash'
  const today = new Date().toISOString().slice(0, 10)
  const selectedDate = sp.date ?? today
  const selectedSprint = sp.sprint ? parseInt(sp.sprint) : undefined

  // All users (including owner) read from Postgres — single source of truth since 2026-07-01.
  // uid 0 (unauthenticated) yields empty from DB, never exposes other users' data.
  const ctx = await getRequestContext()
  const uid = ctx?.uid ?? 0

  const dates   = await getSprintDatesFromDB(uid)
  const dayData = await getSprintDayFromDB(uid, selectedDate)
  const allDays = await getSprintDaysFromDB(uid)

  const currentSprintNo = getSprintNumber(Date.now())
  const viewSprintNo = selectedSprint ?? currentSprintNo

  type SprintSession = { title: string; time: string; bullets: string[]; date: string; islSessionId: string | null }
  type SprintMeta = { start: number; end: number; dates: string[]; sessions: number }
  const projectSprints: Record<string, Record<number, SprintSession[]>> = {}
  const sprintMeta: Record<number, SprintMeta> = {}

  for (const day of allDays) {
    const sprintNo = getSprintNumber(new Date(day.date + 'T12:00:00').getTime())
    if (!sprintMeta[sprintNo]) {
      const [start, end] = getSprintWindow(sprintNo)
      sprintMeta[sprintNo] = { start, end, dates: [], sessions: 0 }
    }
    if (!sprintMeta[sprintNo].dates.includes(day.date)) {
      sprintMeta[sprintNo].dates.push(day.date)
    }
    for (const s of day.sessions) {
      const projId = tagSessionToProject(s.title, s.bullets.join(' '))
      if (!projectSprints[projId]) projectSprints[projId] = {}
      if (!projectSprints[projId][sprintNo]) projectSprints[projId][sprintNo] = []
      projectSprints[projId][sprintNo].push({ ...s, date: day.date })
      sprintMeta[sprintNo].sessions++
    }
  }

  // Ensure current sprint always appears in selector even with zero sessions
  if (!sprintMeta[currentSprintNo]) {
    const [start, end] = getSprintWindow(currentSprintNo)
    sprintMeta[currentSprintNo] = { start, end, dates: [], sessions: 0 }
  }

  const monthMap: Record<string, typeof allDays> = {}
  for (const day of allDays) {
    const month = day.date.slice(0, 7)
    if (!monthMap[month]) monthMap[month] = []
    monthMap[month].push(day)
  }

  const allTopics = allDays.flatMap((d) =>
    d.sessions.map((s) => ({ ...s, date: d.date }))
  )

  return (
    <AppShell
      view={view}
      today={today}
      selectedDate={selectedDate}
      dates={dates}
      dayData={dayData}
      allDays={allDays}
      projects={PROJECTS}
      projectSprints={projectSprints}
      sprintMeta={sprintMeta}
      currentSprintNo={currentSprintNo}
      viewSprintNo={viewSprintNo}
      monthMap={monthMap}
      allTopics={allTopics}
    />
  )
}
