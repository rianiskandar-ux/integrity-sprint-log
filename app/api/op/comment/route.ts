import { NextResponse } from 'next/server'

const OP_BASE = process.env.OP_BASE_URL!
const OP_TOKEN = process.env.OP_API_TOKEN!

export async function POST(req: Request) {
  const { wpId, comment, userSettings } = await req.json()
  if (!wpId || !comment) return NextResponse.json({ error: 'wpId and comment required' }, { status: 400 })

  const token = userSettings?.opApiToken || OP_TOKEN
  const auth = Buffer.from(`apikey:${token}`).toString('base64')

  const res = await fetch(`${OP_BASE}/api/v3/work_packages/${wpId}/activities`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      comment: { format: 'plain', raw: comment },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    return NextResponse.json({ error: err }, { status: res.status })
  }
  return NextResponse.json({ ok: true })
}
