import { getOpToken, getOpBaseUrl } from '@/lib/user-config'
import { NextResponse } from 'next/server'

export async function GET() {
  const token = getOpToken()
  const base  = getOpBaseUrl()

  if (!token || !base) return NextResponse.json({ error: 'OP not configured' }, { status: 500 })

  const auth = 'Basic ' + Buffer.from(`apikey:${token}`).toString('base64')
  const res  = await fetch(`${base}/api/v3/users/me`, { headers: { Authorization: auth } })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
