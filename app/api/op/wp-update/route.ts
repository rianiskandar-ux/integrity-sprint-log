import { NextResponse } from 'next/server'

function toISODuration(minutes: number): string {
  const h = Math.floor(minutes / 60), m = minutes % 60
  return h > 0 ? `PT${h}H${m > 0 ? m + 'M' : ''}` : `PT${m}M`
}

function timeToMinutes(t: string): number {
  const m = t.match(/(\d{1,2})[:.h](\d{2})/)
  return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : 0
}

export async function POST(req: Request) {
  const { wpId, statusId, percentDone, spentTimeStr, userSettings } = await req.json()
  const token = userSettings?.opApiToken || process.env.OP_API_TOKEN
  const base  = process.env.OP_BASE_URL
  if (!token || !base || !wpId) return NextResponse.json({ error: 'Missing config' }, { status: 400 })

  const headers = {
    Authorization: 'Basic ' + Buffer.from(`apikey:${token}`).toString('base64'),
    'Content-Type': 'application/json',
  }

  // 1. Get current WP to calculate remaining work
  const wpRes = await fetch(`${base}/api/v3/work_packages/${wpId}`, { headers })
  if (!wpRes.ok) return NextResponse.json({ error: 'WP not found' }, { status: 404 })
  const wp = await wpRes.json()

  // Calculate remaining work
  const estimatedMin = wp.estimatedTime ? (() => {
    const m = wp.estimatedTime.match(/PT(?:(\d+)H)?(?:(\d+)M)?/)
    return m ? (parseInt(m[1] ?? '0') * 60 + parseInt(m[2] ?? '0')) : 0
  })() : 0

  const spentMin = spentTimeStr ? timeToMinutes(spentTimeStr) : 0
  const currentSpentMin = wp.spentTime ? (() => {
    const m = wp.spentTime.match(/PT(?:(\d+)H)?(?:(\d+)M)?/)
    return m ? (parseInt(m[1] ?? '0') * 60 + parseInt(m[2] ?? '0')) : 0
  })() : 0

  const totalSpentMin = currentSpentMin + spentMin
  const remainingMin = Math.max(0, estimatedMin - totalSpentMin)
  const autoPct = estimatedMin > 0 ? Math.min(100, Math.round((totalSpentMin / estimatedMin) * 100)) : percentDone

  // 2. PATCH the work package
  const body: Record<string, unknown> = {
    lockVersion: wp.lockVersion,
  }
  if (statusId) body._links = { status: { href: `/api/v3/statuses/${statusId}` } }
  if (percentDone !== undefined) body.percentageDone = percentDone ?? autoPct
  if (estimatedMin > 0) body.remainingTime = toISODuration(remainingMin)

  const patchRes = await fetch(`${base}/api/v3/work_packages/${wpId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  })

  if (!patchRes.ok) {
    const err = await patchRes.text()
    return NextResponse.json({ error: err }, { status: patchRes.status })
  }

  return NextResponse.json({ ok: true, percentDone: autoPct, remainingMin })
}
