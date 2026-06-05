import { NextResponse } from 'next/server'
import { loadCache, rebuildCache } from '@/lib/op-cache'

// GET — return current cache
export async function GET() {
  return NextResponse.json(loadCache())
}

// POST — rebuild cache
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const token = process.env.OP_API_TOKEN
  const base  = process.env.OP_BASE_URL

  if (!token || !base) return NextResponse.json({ error: 'OP not configured' }, { status: 500 })

  // Projects to watch — from request body or default
  const projects: string[] = body.projects ?? [
    'integritys-websites',
    'know-your-vendor-kyv',
  ]
  const userId: number = body.userId ?? 8

  try {
    const cache = await rebuildCache(token, base, projects, userId)
    return NextResponse.json({ ok: true, ...cache })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
