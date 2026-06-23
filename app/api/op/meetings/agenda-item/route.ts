import { NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/request-auth'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { opToken: token, opBaseUrl: base } = ctx
  const auth = Buffer.from(`apikey:${token}`).toString('base64')

  const { meetingId, title, notes, durationMins } = await req.json()
  if (!meetingId || !title) return NextResponse.json({ error: 'meetingId and title required' }, { status: 400 })

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

export async function PATCH(req: Request) {
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { opToken: token, opBaseUrl: base } = ctx
  const auth = Buffer.from(`apikey:${token}`).toString('base64')

  const { meetingId, itemId, title, notes, durationMins } = await req.json()
  if (!meetingId || !itemId) return NextResponse.json({ error: 'meetingId and itemId required' }, { status: 400 })

  const getRes = await fetch(`${base}/api/v3/meetings/${meetingId}/agenda_items/${itemId}`, {
    headers: { Authorization: `Basic ${auth}` },
  })
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
