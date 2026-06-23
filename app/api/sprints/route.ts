import { NextResponse } from 'next/server'
import { getAllSprintDays, getSprintDates } from '@/lib/parser'
import { getSprintDaysFromDB, getSprintDatesFromDB } from '@/lib/sprint-from-db'
import { getRequestContext } from '@/lib/request-auth'
import { isOwnerUid } from '@/lib/auth'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('mode')

  const ctx = await getRequestContext()
  const uid = ctx?.uid ?? 0
  const useMarkdown = isOwnerUid(uid)

  if (mode === 'dates') {
    return NextResponse.json(useMarkdown ? getSprintDates() : await getSprintDatesFromDB(uid))
  }

  return NextResponse.json(useMarkdown ? getAllSprintDays() : await getSprintDaysFromDB(uid))
}
