import { NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/request-auth'
import { listSummaries, saveSummary, deleteSummary } from '@/lib/sprint-summary-store'

export const runtime = 'nodejs'

export async function GET() {
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ summaries: [] })
  return NextResponse.json({ summaries: listSummaries(ctx.uid) })
}

// POST { sprint, summary } — save (one per sprint)
export async function POST(req: Request) {
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { sprint, summary } = await req.json().catch(() => ({}))
  if (!sprint || !summary?.trim()) return NextResponse.json({ error: 'sprint and summary required' }, { status: 400 })
  const summaries = saveSummary(ctx.uid, { sprint, summary, savedAt: new Date().toISOString() })
  return NextResponse.json({ ok: true, summaries })
}

// DELETE { sprint }
export async function DELETE(req: Request) {
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { sprint } = await req.json().catch(() => ({}))
  if (!sprint) return NextResponse.json({ error: 'sprint required' }, { status: 400 })
  return NextResponse.json({ ok: true, summaries: deleteSummary(ctx.uid, sprint) })
}
