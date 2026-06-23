import { NextResponse } from 'next/server'
import { ISL_TO_OP_STATUS, updateCachedWPStatus } from '@/lib/op-cache'
import { getRequestContext } from '@/lib/request-auth'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  try {
    const { wpId, islStatus } = await req.json()
    if (!wpId || !islStatus) return NextResponse.json({ error: 'wpId and islStatus required' }, { status: 400 })

    const opStatusId = ISL_TO_OP_STATUS[islStatus]
    if (!opStatusId) return NextResponse.json({ error: `Unknown islStatus: ${islStatus}` }, { status: 400 })

    const ctx = await getRequestContext()
    if (!ctx) {
      updateCachedWPStatus(wpId, opStatusId)
      return NextResponse.json({ ok: true, synced: false, note: 'Unauthorized, local cache updated only' })
    }
    const { opToken: OP_TOKEN, opBaseUrl: OP_BASE, uid } = ctx

    const mkHeaders = () => ({
      Authorization: 'Basic ' + Buffer.from(`apikey:${OP_TOKEN}`).toString('base64'),
      'Content-Type': 'application/json',
    })

    const wpRes = await fetch(`${OP_BASE}/api/v3/work_packages/${wpId}`, { headers: mkHeaders() })
    if (!wpRes.ok) return NextResponse.json({ error: `WP ${wpId} not found in OP` }, { status: 404 })
    const wp = await wpRes.json()

    const patchRes = await fetch(`${OP_BASE}/api/v3/work_packages/${wpId}`, {
      method: 'PATCH',
      headers: mkHeaders(),
      body: JSON.stringify({
        lockVersion: wp.lockVersion,
        _links: { status: { href: `/api/v3/statuses/${opStatusId}` } },
      }),
    })

    updateCachedWPStatus(wpId, opStatusId, uid)

    if (!patchRes.ok) {
      const err = await patchRes.text()
      return NextResponse.json({ ok: true, synced: false, opError: err })
    }

    return NextResponse.json({ ok: true, synced: true, opStatusId })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
