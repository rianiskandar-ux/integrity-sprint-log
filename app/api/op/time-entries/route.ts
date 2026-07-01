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

export async function GET(req: Request) {
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { opToken, opBaseUrl } = ctx
  const wpId = new URL(req.url).searchParams.get('wpId')
  if (!wpId) return NextResponse.json({ error: 'wpId required' }, { status: 400 })

  const filters  = encodeURIComponent(JSON.stringify([{ workPackage: { operator: '=', values: [wpId] } }]))
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
  const { entryId, minutes, date, comment } = await req.json()
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
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { opToken, opBaseUrl } = ctx
  const { entryId } = await req.json()
  if (!entryId) return NextResponse.json({ error: 'entryId required' }, { status: 400 })

  const res = await fetch(`${opBaseUrl}/api/v3/time_entries/${entryId}`, {
    method: 'DELETE',
    headers: { Authorization: authHeader(opToken) },
  })
  if (!res.ok && res.status !== 204 && res.status !== 200) {
    return NextResponse.json({ error: await res.text() }, { status: res.status })
  }
  return NextResponse.json({ ok: true })
}
