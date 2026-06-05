import { NextResponse } from 'next/server'
import { parseSprintFile } from '@/lib/parser'

export async function GET(_req: Request, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params
  const data = parseSprintFile(date)
  if (!data) return NextResponse.json(null, { status: 404 })
  return NextResponse.json(data)
}
