import { getOpBaseUrl, getOpToken } from '@/lib/user-config'
import { NextResponse } from 'next/server'

function getAuth() {
  const base  = getOpBaseUrl() || process.env.OP_BASE_URL!
  const token = getOpToken()   || process.env.OP_API_TOKEN!
  const auth  = Buffer.from(`apikey:${token}`).toString('base64')
  return { base, auth }
}

// POST — create new agenda item
export async function POST(req: Request) {
  const { meetingId, title, notes, durationMins } = await req.json()
  if (!meetingId || !title) return NextResponse.json({ error: 'meetingId and title required' }, { status: 400 })

  const { base, auth } = getAuth()
  const body = {
    title,
    notes:    { format: 'markdown', raw: notes ?? '' },
    duration: durationMins ? `PT${durationMins}M` : 'PT5M',
  }

  const res = await fetch(`${base}/api/v3/meetings/${meetingId}/agenda_items`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: res.status })
  const data = await res.json()
  return NextResponse.json({ ok: true, id: data.id })
}

// PATCH — update existing agenda item by itemId
export async function PATCH(req: Request) {
  const { meetingId, itemId, title, notes, durationMins } = await req.json()
  if (!meetingId || !itemId) return NextResponse.json({ error: 'meetingId and itemId required' }, { status: 400 })

  const { base, auth } = getAuth()

  // First fetch current lockVersion (required by OP for optimistic locking)
  const getRes = await fetch(`${base}/api/v3/meetings/${meetingId}/agenda_items/${itemId}`, {
    headers: { Authorization: `Basic ${auth}` },
  })

  // 404 means item was deleted — signal caller to POST new
  if (getRes.status === 404) return NextResponse.json({ notFound: true }, { status: 404 })
  if (!getRes.ok) return NextResponse.json({ error: await getRes.text() }, { status: getRes.status })

  const existing = await getRes.json()
  const body = {
    lockVersion: existing.lockVersion,
    title:    title ?? existing.title,
    notes:    { format: 'markdown', raw: notes ?? existing.notes?.raw ?? '' },
    duration: durationMins ? `PT${durationMins}M` : (existing.duration ?? 'PT5M'),
  }

  const patchRes = await fetch(`${base}/api/v3/meetings/${meetingId}/agenda_items/${itemId}`, {
    method: 'PATCH',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!patchRes.ok) return NextResponse.json({ error: await patchRes.text() }, { status: patchRes.status })
  const data = await patchRes.json()
  return NextResponse.json({ ok: true, id: data.id })
}
