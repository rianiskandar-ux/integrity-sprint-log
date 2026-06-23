import { NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/request-auth'

export const runtime = 'nodejs'

export async function GET() {
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { opToken: token, opBaseUrl: base } = ctx
  const auth = 'Basic ' + Buffer.from(`apikey:${token}`).toString('base64')
  const res  = await fetch(`${base}/api/v3/users/me`, { headers: { Authorization: auth } })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
