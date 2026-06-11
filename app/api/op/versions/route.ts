import { getOpToken, getOpBaseUrl } from '@/lib/user-config'
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('project') ?? 'integritys-websites'
  const token = process.env.OP_API_TOKEN
  const base = process.env.OP_BASE_URL

  if (!token || !base) return NextResponse.json({ error: 'OP not configured' }, { status: 500 })

  const res = await fetch(`${base}/api/v3/projects/${projectId}/versions?pageSize=30&sortBy=[["id","desc"]]`, {
    headers: {
      Authorization: 'Basic ' + Buffer.from(`apikey:${token}`).toString('base64'),
      'Content-Type': 'application/json',
    },
  })

  if (!res.ok) return NextResponse.json({ error: 'OP error' }, { status: res.status })

  const data = await res.json()
  const today = new Date().toISOString().slice(0, 10)

  const versions = (data._embedded?.elements ?? []).map((v: Record<string, string>) => ({
    id: v.id,
    name: v.name,
    startDate: v.startDate,
    endDate: v.endDate,
    status: v.status,
    isCurrent: v.startDate <= today && v.endDate >= today,
  }))

  return NextResponse.json({ versions })
}
