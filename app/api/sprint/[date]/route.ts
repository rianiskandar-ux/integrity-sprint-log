import { NextResponse } from 'next/server'
import { parseSprintFile } from '@/lib/parser'
import { getSprintDayFromDB } from '@/lib/sprint-from-db'
import { getRequestContext } from '@/lib/request-auth'
import { isOwnerUid } from '@/lib/auth'

export async function GET(_req: Request, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params
  const ctx = await getRequestContext()
  const uid = ctx?.uid ?? 0
  const data = isOwnerUid(uid) ? parseSprintFile(date) : await getSprintDayFromDB(uid, date)
  if (!data) return NextResponse.json(null, { status: 404 })
  return NextResponse.json(data)
}
