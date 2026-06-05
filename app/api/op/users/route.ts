import { NextResponse } from 'next/server'
import { TEAM_MEMBERS } from '@/lib/op-config'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const search = (searchParams.get('q') ?? '').toLowerCase().trim()
  const token = process.env.OP_API_TOKEN
  const base  = process.env.OP_BASE_URL

  // Try OP API via /principals (accessible to non-admin users)
  if (token && base) {
    try {
      const params = new URLSearchParams({ pageSize: '200', sortBy: JSON.stringify([['name', 'asc']]) })
      if (search) params.set('filters', JSON.stringify([{ name: { operator: '~', values: [search] } }]))

      const res = await fetch(`${base}/api/v3/principals?${params}`, {
        headers: { Authorization: 'Basic ' + Buffer.from(`apikey:${token}`).toString('base64') },
      })
      if (res.ok) {
        const data = await res.json()
        const users = (data._embedded?.elements ?? [])
          .filter((u: { _type: string }) => u._type === 'User')
          .map((u: { id: number; name: string; login: string; avatar?: string }) => ({
            id: u.id, name: u.name, login: u.login ?? '', avatar: u.avatar ?? null,
          }))
        if (users.length > 0) return NextResponse.json({ users, source: 'op' })
      }
    } catch { /* fall through to hardcoded list */ }
  }

  // Fallback: hardcoded team members
  const members = TEAM_MEMBERS.map(m => ({
    id: m.id,
    name: m.name,
    login: m.name.toLowerCase().replace(/\s+/g, '.'),
    avatar: null,
  }))
  const filtered = search
    ? members.filter(m => m.name.toLowerCase().includes(search))
    : members

  return NextResponse.json({ users: filtered, source: 'local' })
}
