import { NextResponse } from 'next/server'

const OP_BASE = process.env.OP_BASE_URL!
const OP_TOKEN = process.env.OP_API_TOKEN!

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const userToken = searchParams.get('token') ?? ''
  const userId = searchParams.get('userId') ?? ''
  const token = userToken || OP_TOKEN
  const auth = Buffer.from(`apikey:${token}`).toString('base64')

  const filters = userId
    ? encodeURIComponent(JSON.stringify([{ member: { operator: '=', values: [userId] } }]))
    : ''
  const filterParam = filters ? `&filters=${filters}` : ''

  try {
    const res = await fetch(`${OP_BASE}/api/v3/projects?pageSize=100${filterParam}&sortBy=${encodeURIComponent(JSON.stringify([['name', 'asc']]))}`, {
      headers: { Authorization: `Basic ${auth}` },
    })
    if (!res.ok) return NextResponse.json({ projects: [] }, { status: res.status })
    const data = await res.json()
    const projects = (data._embedded?.elements ?? []).map((p: { id: number; name: string; identifier: string }) => ({
      id: p.id,
      name: p.name,
      identifier: p.identifier,
    }))
    return NextResponse.json({ projects })
  } catch {
    return NextResponse.json({ projects: [] })
  }
}
