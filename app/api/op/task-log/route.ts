import { NextResponse } from 'next/server'
import { getAllSessions } from '@/lib/session-store'
import { getRequestContext } from '@/lib/request-auth'

export const runtime = 'nodejs'

function parseIsoDurationHours(dur: string): number {
  const m = dur.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/)
  if (!m) return 0
  return (Number(m[1] ?? 0) * 24) + Number(m[2] ?? 0) + (Number(m[3] ?? 0) / 60) + (Number(m[4] ?? 0) / 3600)
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const taskId = Number(searchParams.get('taskId'))
  if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })

  const ctx = await getRequestContext()

  const islSessions = (await getAllSessions(ctx?.uid))
    .filter(s => s.opTaskId === taskId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(s => ({
      id:            s.id,
      date:          s.date,
      title:         s.title,
      bullets:       s.bullets,
      actualMins:    s.actualMins,
      estimatedMins: s.estimatedMins,
      pushStatus:    s.pushStatus,
      createdAt:     s.createdAt,
    }))

  let opEntries: { id: number; hours: number; comment: string; date: string; user: string; ongoing: boolean }[] = []
  if (ctx) {
    const { opToken: OP_TOKEN, opBaseUrl: OP_BASE } = ctx
    try {
      const auth    = 'Basic ' + Buffer.from(`apikey:${OP_TOKEN}`).toString('base64')
      const filters = encodeURIComponent(JSON.stringify([
        { entity_type: { operator: '=', values: ['WorkPackage'] } },
        { entity_id:   { operator: '=', values: [String(taskId)] } },
      ]))
      const res = await fetch(
        `${OP_BASE}/api/v3/time_entries?filters=${filters}&pageSize=50`,
        { headers: { Authorization: auth }, signal: AbortSignal.timeout(8000) }
      )
      if (res.ok) {
        const data = await res.json()
        opEntries = (data._embedded?.elements ?? []).map((e: Record<string, unknown>) => {
          const links = (e._links ?? {}) as Record<string, { title?: string } | null>
          const hours = parseIsoDurationHours(String(e.hours ?? ''))
          const comment = typeof e.comment === 'object' && e.comment !== null
            ? (e.comment as { raw?: string }).raw ?? ''
            : String(e.comment ?? '')
          return {
            id:      e.id as number,
            hours,
            comment,
            date:    e.spentOn as string,
            user:    links.user?.title ?? 'Unknown',
            ongoing: e.ongoing === true,
          }
        })
      }
    } catch { /* non-fatal */ }
  }

  return NextResponse.json({ taskId, islSessions, opEntries })
}
