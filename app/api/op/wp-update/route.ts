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
  const { wpId, statusId, percentDone, spentTimeStr, estimatedMins, addSpentMins, subject, userSettings } = await req.json()
  const ctx   = await getRequestContext()
  // Session identity only — ignore any client-supplied OP token override.
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  void userSettings
  const token = ctx.opToken
  const base  = ctx.opBaseUrl
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

  void autoPct  // no longer force %done from spent/est ratio — see progress note below

  // Detect current status from OP (fallback when statusId not sent = status unchanged)
  const currentStatusHref = (wp._links?.status?.href as string) ?? ''
  const currentStatusId   = parseInt(currentStatusHref.split('/').pop() ?? '0') || 0
  const effectiveStatusId = statusId ?? currentStatusId
  const isDoneStatus  = [12, 14].includes(effectiveStatusId)  // 12=Closed, 14=Rejected
  const spentAdded    = spentMin > 0
  const estChanged    = typeof estimatedMins === 'number' && estimatedMins > 0 && estimatedMins !== currentEstMin

  // Feature/Epic estimates are managed in OP, not from ISL — never write an estimate to them.
  const wpType = (wp._links?.type?.title ?? '') as string
  const estimateAllowed = !/^(feature|epic)$/i.test(wpType)

  const body: Record<string, unknown> = { lockVersion: wp.lockVersion }
  // Rename the work package (US or Task) — only when a real, changed subject is
  // sent. Lets the "✨ Suggest title" flow rewrite a generic OP title in place.
  if (typeof subject === 'string' && subject.trim() && subject.trim() !== wp.subject) {
    body.subject = subject.trim().slice(0, 255)
  }
  if (statusId)                               body._links        = { status: { href: `/api/v3/statuses/${statusId}` } }
  if (typeof estimatedMins === 'number' && estimatedMins > 0 && estimateAllowed) body.estimatedTime = toISODuration(estimatedMins)

  // ── Progress (remainingTime / percentageDone) ─────────────────────────────
  // This OP derives %done from WORK (spent vs remaining). The old code wrote
  // remainingTime on EVERY save as max(0, est−spent) → whenever spent≥est it
  // sent remainingTime=0, and OP flipped %done to 100% — even for a "New" task,
  // even on a subject-only save (the reported bug: Suggest→Simpan made a New,
  // next-sprint task show 100%). Now progress is touched ONLY when it truly
  // changes, and a non-done task is NEVER forced to 100%:
  //  • Done status (Closed/Rejected) → remaining 0 (OP derives 100%).
  //  • Otherwise, only if the user added spent or changed the estimate: write
  //    the real remaining, but skip writing 0 (which would flip it to 100%).
  //  • Subject/status-only save → progress untouched (no spurious completion).
  if (isDoneStatus) {
    body.remainingTime = 'PT0M'
    if (percentDone !== undefined) body.percentageDone = 100
  } else if (spentAdded || estChanged) {
    const rem = Math.max(0, estimatedMin - totalSpentMin)
    if (rem > 0) body.remainingTime = toISODuration(rem)
    if (percentDone !== undefined) body.percentageDone = percentDone
  }

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
      return NextResponse.json({ ok: true, pctSkipped: true })
    }
    return NextResponse.json({ error: errText }, { status: patchRes.status })
  }

  if (!patchRes.ok) return NextResponse.json({ error: await patchRes.text() }, { status: patchRes.status })
  return NextResponse.json({ ok: true })
}
