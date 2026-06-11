import { getOpToken } from '@/lib/user-config'
import { NextResponse } from 'next/server'
import { ISL_TO_OP_STATUS, updateCachedWPStatus } from '@/lib/op-cache'

const OP_BASE  = process.env.OP_BASE_URL  ?? ''
const OP_TOKEN = getOpToken()

function opHeaders() {
  return {
    Authorization: 'Basic ' + Buffer.from(`apikey:${OP_TOKEN}`).toString('base64'),
    'Content-Type': 'application/json',
  }
}

// POST /api/op/status
// Body: { wpId: number, islStatus: string }
// Maps ISL status → OP status ID → PATCH OP work package → update local cache
export async function POST(req: Request) {
  try {
    const { wpId, islStatus } = await req.json()
    if (!wpId || !islStatus) return NextResponse.json({ error: 'wpId and islStatus required' }, { status: 400 })

    const opStatusId = ISL_TO_OP_STATUS[islStatus]
    if (!opStatusId) return NextResponse.json({ error: `Unknown islStatus: ${islStatus}` }, { status: 400 })

    if (!OP_BASE || !OP_TOKEN) {
      // OP not configured — still update local cache
      updateCachedWPStatus(wpId, opStatusId)
      return NextResponse.json({ ok: true, synced: false, note: 'OP not configured, local cache updated only' })
    }

    // Get current WP for lockVersion
    const wpRes = await fetch(`${OP_BASE}/api/v3/work_packages/${wpId}`, { headers: opHeaders() })
    if (!wpRes.ok) return NextResponse.json({ error: `WP ${wpId} not found in OP` }, { status: 404 })
    const wp = await wpRes.json()

    // PATCH status in OP
    const patchRes = await fetch(`${OP_BASE}/api/v3/work_packages/${wpId}`, {
      method: 'PATCH',
      headers: opHeaders(),
      body: JSON.stringify({
        lockVersion: wp.lockVersion,
        _links: { status: { href: `/api/v3/statuses/${opStatusId}` } },
      }),
    })

    if (!patchRes.ok) {
      const err = await patchRes.text()
      // Still update local cache even if OP fails (offline mode)
      updateCachedWPStatus(wpId, opStatusId)
      return NextResponse.json({ ok: true, synced: false, opError: err })
    }

    // Update local cache to reflect new status
    updateCachedWPStatus(wpId, opStatusId)
    return NextResponse.json({ ok: true, synced: true, opStatusId })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
