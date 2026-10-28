import { NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/request-auth'
import { wibDate, opStartTime } from '@/lib/op-time'

export const runtime = 'nodejs'

function durationToMinutes(d: string | number): number {
  if (typeof d === 'number') return d
  const s = String(d).trim()
  const hm = s.match(/(\d+(?:\.\d+)?)\s*h(?:\s*(\d+)\s*m)?/)
  if (hm) return Math.round(parseFloat(hm[1]) * 60) + (hm[2] ? parseInt(hm[2]) : 0)
  const m = s.match(/^(\d+)\s*m/)
  if (m) return parseInt(m[1])
  const n = parseFloat(s)
  if (!isNaN(n)) return Math.round(n * 60)  // bare number treated as hours
  return 0
}

function toISODuration(minutes: number): string {
  const h = Math.floor(minutes / 60), m = minutes % 60
  return h > 0 ? `PT${h}H${m > 0 ? m + 'M' : ''}` : `PT${m}M`
}

export async function POST(req: Request) {
  try {
    const { wpId, duration, date, title, userSettings } = await req.json()
    const ctx   = await getRequestContext()
    // Session identity only — ignore any client-supplied OP token override.
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    void userSettings
    const token = ctx.opToken
    const base  = ctx.opBaseUrl
    if (!token || !base) return NextResponse.json({ error: 'OP not configured' }, { status: 500 })
    if (!wpId) return NextResponse.json({ error: 'wpId required' }, { status: 400 })

    const spentMin = durationToMinutes(duration ?? 30)
    if (spentMin === 0) return NextResponse.json({ error: 'Invalid duration' }, { status: 400 })

    // tanggal WIB (bukan UTC) + startTime wajib OP; jam mulai = sekarang − durasi bila log hari ini
    const spentOn = date ?? wibDate()
    const startTime = opStartTime(spentOn, new Date(Date.now() - spentMin * 60000))

    const res = await fetch(`${base}/api/v3/time_entries`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`apikey:${token}`).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        hours:   toISODuration(spentMin),
        spentOn,
        startTime,
        comment: { format: 'plain', raw: title ?? '' },
        _links:  { workPackage: { href: `/api/v3/work_packages/${wpId}` } },
      }),
    })

    if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: res.status })
    const data = await res.json()
    return NextResponse.json({ ok: true, timeEntryId: data.id, opUrl: `${base}/work_packages/${wpId}`, spentMin })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
