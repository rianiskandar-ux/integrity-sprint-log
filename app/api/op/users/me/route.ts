import { NextResponse } from 'next/server'

const OP_BASE = process.env.OP_BASE_URL!

export async function GET(req: Request) {
  const token = req.headers.get('x-op-token') ?? process.env.OP_API_TOKEN ?? ''
  if (!token) return NextResponse.json({ error: 'No token' }, { status: 401 })

  const auth = Buffer.from(`apikey:${token}`).toString('base64')
  try {
    const res = await fetch(`${OP_BASE}/api/v3/users/me`, {
      headers: { Authorization: `Basic ${auth}` },
    })
    if (!res.ok) return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    const d = await res.json()
    return NextResponse.json({ id: d.id, name: d.name, email: d.email, login: d.login })
  } catch {
    return NextResponse.json({ error: 'Connection failed' }, { status: 500 })
  }
}
