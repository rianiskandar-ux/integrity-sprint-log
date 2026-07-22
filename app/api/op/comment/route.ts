import { NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/request-auth'
import { isRateLimited } from '@/lib/rate-limit'

export const runtime = 'nodejs'

// Max 5 comments per user per 5 minutes. Generous for a human reviewing
// tickets (the "Tanya ke pelapor" flow), tight enough to stop a runaway
// script or a stuck client-side retry loop from spamming OP.
const MAX_COMMENTS = 5
const WINDOW_MS = 5 * 60 * 1000

export async function POST(req: Request) {
  const { wpId, comment, userSettings } = await req.json()
  if (!wpId || !comment) return NextResponse.json({ error: 'wpId and comment required' }, { status: 400 })

  const ctx = await getRequestContext()
  // Session identity only. Honoring body.userSettings.opApiToken let a crafted
  // request comment in OP under any token; the session token is the real user.
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  void userSettings  // accepted for backward-compat but intentionally ignored

  if (isRateLimited(`op-comment:${ctx.uid}`, MAX_COMMENTS, WINDOW_MS)) {
    return NextResponse.json({ error: 'Terlalu banyak komentar dalam waktu singkat — coba lagi beberapa menit lagi' }, { status: 429 })
  }

  const token = ctx.opToken
  const base  = ctx.opBaseUrl
  const auth  = Buffer.from(`apikey:${token}`).toString('base64')

  const res = await fetch(`${base}/api/v3/work_packages/${wpId}/activities`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment: { format: 'plain', raw: comment } }),
  })

  if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: res.status })
  return NextResponse.json({ ok: true })
}
