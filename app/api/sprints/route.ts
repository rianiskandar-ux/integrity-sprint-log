import { NextResponse } from 'next/server'
import { getAllSprintDays, getSprintDates } from '@/lib/parser'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('mode')

  if (mode === 'dates') {
    return NextResponse.json(getSprintDates())
  }

  return NextResponse.json(getAllSprintDays())
}
