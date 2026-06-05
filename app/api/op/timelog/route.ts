import { NextResponse } from 'next/server'

// Parse duration string like "1h 30m", "45m", "2h", "1.5h", or minutes number
function durationToMinutes(d: string | number): number {
  if (typeof d === 'number') return d
  const s = String(d).trim()
  // "1h 30m" or "1h30m"
  const hm = s.match(/(\d+(?:\.\d+)?)\s*h(?:\s*(\d+)\s*m)?/)
  if (hm) return Math.round(parseFloat(hm[1]) * 60) + (hm[2] ? parseInt(hm[2]) : 0)
  // "45m"
  const m = s.match(/^(\d+)\s*m/)
  if (m) return parseInt(m[1])
  // plain number string
  const n = parseFloat(s)
  if (!isNaN(n)) return Math.round(n)
  return 0
}

function toISODuration(minutes: number): string {
  const h = Math.floor(minutes / 60), m = minutes % 60
  return h > 0 ? `PT${h}H${m > 0 ? m + 'M' : ''}` : `PT${m}M`
}

export async function POST(req: Request) {
  try {
  const { wpId, duration, date, title, userSettings } = await req.json()
  const token = userSettings?.opApiToken || process.env.OP_API_TOKEN
  const base  = process.env.OP_BASE_URL
  if (!token || !base) return NextResponse.json({ error: 'OP not configured' }, { status: 500 })
  if (!wpId) return NextResponse.json({ error: 'wpId required' }, { status: 400 })

  const spentMin = durationToMinutes(duration ?? 30)
  if (spentMin === 0) return NextResponse.json({ error: 'Invalid duration' }, { status: 400 })

  const spentOn = date ?? new Date().toISOString().split('T')[0]

  const res = await fetch(`${base}/api/v3/time_entries`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`apikey:${token}`).toString('base64'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      hours:   toISODuration(spentMin),
      spentOn,
      comment: { format: 'plain', raw: title ?? '' },
      _links:  { workPackage: { href: `/api/v3/work_packages/${wpId}` } },
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    return NextResponse.json({ error: errText }, { status: res.status })
  }
  const data = await res.json()
  return NextResponse.json({ ok: true, timeEntryId: data.id, opUrl: `${base}/work_packages/${wpId}`, spentMin })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
