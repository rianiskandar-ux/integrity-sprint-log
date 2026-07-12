import { NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/request-auth'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const userId    = searchParams.get('userId') ?? ''

  // Login required. Previously accepted a ?token= query param and fell back to
  // the env owner token — an unauthenticated LAN caller could list the owner's
  // OP projects, and a token in the URL leaks into logs. Use the session only.
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const token = ctx.opToken
  const base  = ctx.opBaseUrl
  const auth  = Buffer.from(`apikey:${token}`).toString('base64')

  const filters = userId
    ? encodeURIComponent(JSON.stringify([{ member: { operator: '=', values: [userId] } }]))
    : ''
  const filterParam = filters ? `&filters=${filters}` : ''

  try {
    const res = await fetch(`${base}/api/v3/projects?pageSize=100${filterParam}&sortBy=${encodeURIComponent(JSON.stringify([['name', 'asc']]))}`, {
      headers: { Authorization: `Basic ${auth}` },
    })
    if (!res.ok) return NextResponse.json({ projects: [] }, { status: res.status })
    const data = await res.json()
    const projects = (data._embedded?.elements ?? []).map((p: { id: number; name: string; identifier: string }) => ({
      id: p.id, name: p.name, identifier: p.identifier,
    }))
    return NextResponse.json({ projects })
  } catch {
    return NextResponse.json({ projects: [] })
  }
}
