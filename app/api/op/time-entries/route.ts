import { NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/request-auth'

export const runtime = 'nodejs'

function toISODuration(minutes: number): string {
  const h = Math.floor(minutes / 60), m = minutes % 60
  return h > 0 ? `PT${h}H${m > 0 ? m + 'M' : ''}` : `PT${m}M`
}

function parseDuration(s: string): number {
  const m = s.match(/PT(?:(\d+)H)?(?:(\d+)M)?/)
  return m ? (parseInt(m[1] ?? '0') * 60 + parseInt(m[2] ?? '0')) : 0
}

function authHeader(token: string) {
  return 'Basic ' + Buffer.from(`apikey:${token}`).toString('base64')
}

// After a time entry is added/edited/deleted, the WORK PACKAGE's own
// remainingTime/percentageDone do NOT auto-recalculate in this OP instance —
// they're separate stored fields that only change on an explicit PATCH to the
// work package (confirmed bug 2026-07-24: deleting an entry zeroed spentTime
// but percentageDone stayed stuck at a stale 100%). So every entry mutation
// here re-fetches the TRUE total spent time and re-syncs the parent — same
// progress rule as /api/op/wp-update (Done/Rejected → 100%, otherwise derive
// from spent vs estimate, never force 100% just because remaining hit 0).
async function recalcParentProgress(wpId: string, auth: string, base: string): Promise<void> {
  try {
    const wpRes = await fetch(`${base}/api/v3/work_packages/${wpId}`, { headers: { Authorization: auth } })
    if (!wpRes.ok) return
    const wp = await wpRes.json()
    const estMin = parseDuration(wp.estimatedTime ?? 'PT0H')

    const filters = encodeURIComponent(JSON.stringify([{ entity: { operator: '=', values: [wpId] } }]))
    const teRes = await fetch(`${base}/api/v3/time_entries?filters=${filters}&pageSize=200`, { headers: { Authorization: auth } })
    if (!teRes.ok) return
    const teData = await teRes.json()
    const totalSpentMin = ((teData._embedded?.elements ?? []) as { hours?: string }[])
      .reduce((sum, e) => sum + parseDuration(e.hours ?? 'PT0H'), 0)

    const statusId = parseInt((wp._links?.status?.href as string ?? '').split('/').pop() ?? '0') || 0
    const isDoneStatus = [12, 14].includes(statusId)

    const body: Record<string, unknown> = { lockVersion: wp.lockVersion }
    if (isDoneStatus) {
      body.remainingTime = 'PT0M'
      body.percentageDone = 100
    } else {
      const remainMin = Math.max(0, estMin - totalSpentMin)
      body.remainingTime = toISODuration(remainMin)
      body.percentageDone = estMin > 0 ? Math.min(100, Math.round((totalSpentMin / estMin) * 100)) : 0
    }

    const patchRes = await fetch(`${base}/api/v3/work_packages/${wpId}`, {
      method: 'PATCH', headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    // OP in "derived from status" mode rejects percentageDone — retry without it.
    if (!patchRes.ok) {
      const errText = await patchRes.text()
      if (errText.includes('percentageDone') || errText.includes('% Complete')) {
        delete body.percentageDone
        await fetch(`${base}/api/v3/work_packages/${wpId}`, {
          method: 'PATCH', headers: { Authorization: auth, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).catch(() => {})
      }
    }
  } catch { /* best-effort — the entry mutation itself already succeeded */ }
}

export async function GET(req: Request) {
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { opToken, opBaseUrl } = ctx
  const wpId = new URL(req.url).searchParams.get('wpId')
  if (!wpId) return NextResponse.json({ error: 'wpId required' }, { status: 400 })

  // OP's time_entries filter key for "which work package" is `entity`, NOT
  // `workPackage` (even though the entry's own _links relation IS named
  // workPackage) — this OP instance rejects the latter with "Work package
  // filter does not exist", so the Time Entries list was always empty/erroring
  // (bug found 2026-07-24: Rian couldn't find any entry to reduce/delete).
  // Verified directly against the live OP API before fixing.
  const filters  = encodeURIComponent(JSON.stringify([{ entity: { operator: '=', values: [wpId] } }]))
  const sortBy   = encodeURIComponent(JSON.stringify([['spentOn', 'desc']]))
  const res = await fetch(
    `${opBaseUrl}/api/v3/time_entries?filters=${filters}&pageSize=50&sortBy=${sortBy}`,
    { headers: { Authorization: authHeader(opToken) } },
  )
  if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: res.status })

  const data = await res.json()
  const entries = (data._embedded?.elements ?? []).map((e: Record<string, unknown>) => {
    const links = e._links as Record<string, { title?: string }> | undefined
    const comment = e.comment as { raw?: string } | undefined
    return {
      id:          e.id,
      minutes:     parseDuration((e.hours as string) ?? 'PT0H'),
      spentOn:     e.spentOn,
      comment:     comment?.raw ?? '',
      user:        links?.user?.title ?? '',
      lockVersion: e.lockVersion,
    }
  })
  return NextResponse.json({ entries })
}

export async function PATCH(req: Request) {
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { opToken, opBaseUrl } = ctx
  const { entryId, minutes, date, comment, wpId } = await req.json()
  if (!entryId) return NextResponse.json({ error: 'entryId required' }, { status: 400 })

  const auth = authHeader(opToken)
  const getRes = await fetch(`${opBaseUrl}/api/v3/time_entries/${entryId}`, { headers: { Authorization: auth } })
  if (!getRes.ok) return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
  const entry = await getRes.json()

  const body: Record<string, unknown> = { lockVersion: entry.lockVersion }
  if (typeof minutes === 'number') body.hours = toISODuration(minutes)
  if (date) body.spentOn = date
  if (typeof comment === 'string') body.comment = { format: 'plain', raw: comment }

  const patchRes = await fetch(`${opBaseUrl}/api/v3/time_entries/${entryId}`, {
    method: 'PATCH',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!patchRes.ok) return NextResponse.json({ error: await patchRes.text() }, { status: patchRes.status })
  if (wpId) await recalcParentProgress(String(wpId), auth, opBaseUrl)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { opToken, opBaseUrl } = ctx
  const { entryId, wpId } = await req.json()
  if (!entryId) return NextResponse.json({ error: 'entryId required' }, { status: 400 })

  const auth = authHeader(opToken)
  const res = await fetch(`${opBaseUrl}/api/v3/time_entries/${entryId}`, {
    method: 'DELETE',
    headers: { Authorization: auth },
  })
  if (!res.ok && res.status !== 204 && res.status !== 200) {
    return NextResponse.json({ error: await res.text() }, { status: res.status })
  }
  if (wpId) await recalcParentProgress(String(wpId), auth, opBaseUrl)
  return NextResponse.json({ ok: true })
}
