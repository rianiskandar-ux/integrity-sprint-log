import { NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/request-auth'

export const runtime = 'nodejs'

function toISODuration(minutes: number): string {
  const h = Math.floor(minutes / 60), m = minutes % 60
  return h > 0 ? `PT${h}H${m > 0 ? m + 'M' : ''}` : `PT${m}M`
}

function timeToMinutes(t: string): number {
  const m = t.match(/(\d{1,2})[:.h](\d{2})/)
  return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : 0
}

export async function POST(req: Request) {
  const { wpId, statusId, percentDone, spentTimeStr, estimatedMins, addSpentMins, userSettings } = await req.json()
  const ctx   = await getRequestContext()
  const token = userSettings?.opApiToken || ctx?.opToken || ''
  const base  = ctx?.opBaseUrl || ''
  if (!token || !base || !wpId) return NextResponse.json({ error: 'Missing config' }, { status: 400 })

  const headers = {
    Authorization: 'Basic ' + Buffer.from(`apikey:${token}`).toString('base64'),
    'Content-Type': 'application/json',
  }

  const wpRes = await fetch(`${base}/api/v3/work_packages/${wpId}`, { headers })
  if (!wpRes.ok) return NextResponse.json({ error: 'WP not found' }, { status: 404 })
  const wp = await wpRes.json()

  const currentEstMin = wp.estimatedTime ? (() => {
    const m = wp.estimatedTime.match(/PT(?:(\d+)H)?(?:(\d+)M)?/)
    return m ? (parseInt(m[1] ?? '0') * 60 + parseInt(m[2] ?? '0')) : 0
  })() : 0
  // Allow editing the estimate (Work) from the OP popup
  const estimatedMin = (typeof estimatedMins === 'number' && estimatedMins > 0) ? estimatedMins : currentEstMin

  const spentMin = (typeof addSpentMins === 'number' ? addSpentMins : 0) + (spentTimeStr ? timeToMinutes(spentTimeStr) : 0)
  const currentSpentMin = wp.spentTime ? (() => {
    const m = wp.spentTime.match(/PT(?:(\d+)H)?(?:(\d+)M)?/)
    return m ? (parseInt(m[1] ?? '0') * 60 + parseInt(m[2] ?? '0')) : 0
  })() : 0

  const totalSpentMin = currentSpentMin + spentMin
  const autoPct       = estimatedMin > 0 ? Math.min(100, Math.round((totalSpentMin / estimatedMin) * 100)) : percentDone

  // Detect current status from OP (fallback when statusId not sent = status unchanged)
  const currentStatusHref = (wp._links?.status?.href as string) ?? ''
  const currentStatusId   = parseInt(currentStatusHref.split('/').pop() ?? '0') || 0
  const effectiveStatusId = statusId ?? currentStatusId
  // OP constraint: remainingTime must be 0 when status is Closed/Rejected or task is 100% done.
  const isDoneStatus  = [12, 14].includes(effectiveStatusId)  // 12=Closed, 14=Rejected
  const effectivePct  = isDoneStatus ? 100 : (percentDone ?? autoPct)
  const remainingMin  = isDoneStatus || effectivePct >= 100 ? 0 : Math.max(0, estimatedMin - totalSpentMin)

  // Feature/Epic estimates are managed in OP, not from ISL — never write an estimate to them.
  const wpType = (wp._links?.type?.title ?? '') as string
  const estimateAllowed = !/^(feature|epic)$/i.test(wpType)

  const body: Record<string, unknown> = { lockVersion: wp.lockVersion }
  if (statusId)                               body._links        = { status: { href: `/api/v3/statuses/${statusId}` } }
  if (isDoneStatus || percentDone !== undefined) body.percentageDone = effectivePct
  if (typeof estimatedMins === 'number' && estimatedMins > 0 && estimateAllowed) body.estimatedTime = toISODuration(estimatedMins)
  if (estimatedMin > 0)    body.remainingTime = toISODuration(remainingMin)

  let patchRes = await fetch(`${base}/api/v3/work_packages/${wpId}`, {
    method: 'PATCH', headers, body: JSON.stringify(body),
  })

  // OP in "derived from status" mode rejects percentageDone — retry without it
  if (!patchRes.ok && body.percentageDone !== undefined) {
    const errText = await patchRes.text()
    if (patchRes.status === 422 && (errText.includes('percentageDone') || errText.includes('% Complete'))) {
      delete body.percentageDone
      patchRes = await fetch(`${base}/api/v3/work_packages/${wpId}`, {
        method: 'PATCH', headers, body: JSON.stringify(body),
      })
      if (!patchRes.ok) return NextResponse.json({ error: await patchRes.text() }, { status: patchRes.status })
      return NextResponse.json({ ok: true, percentDone: effectivePct, remainingMin, pctSkipped: true })
    }
    return NextResponse.json({ error: errText }, { status: patchRes.status })
  }

  if (!patchRes.ok) return NextResponse.json({ error: await patchRes.text() }, { status: patchRes.status })
  return NextResponse.json({ ok: true, percentDone: effectivePct, remainingMin })
}
