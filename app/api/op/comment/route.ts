import { NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/request-auth'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const { wpId, comment, userSettings } = await req.json()
  if (!wpId || !comment) return NextResponse.json({ error: 'wpId and comment required' }, { status: 400 })

  const ctx = await getRequestContext()
  const token = userSettings?.opApiToken || ctx?.opToken || process.env.OP_API_TOKEN!
  const base  = ctx?.opBaseUrl || process.env.OP_BASE_URL!
  const auth  = Buffer.from(`apikey:${token}`).toString('base64')

  const res = await fetch(`${base}/api/v3/work_packages/${wpId}/activities`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment: { format: 'plain', raw: comment } }),
  })

  if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: res.status })
  return NextResponse.json({ ok: true })
}
