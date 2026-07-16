import { NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/request-auth'
import { fetchInquiries, type OpInquiryElement } from '@/lib/op-inquiries'

export const runtime = 'nodejs'

// OP saved query id=112 — "tickets created by others, across the whole team,
// not yet worked on". ISL adds ZERO extra filtering — this route is a pure
// read-only mirror of whatever that query returns on the OP side.
//
// Fetch logic lives in lib/op-inquiries.ts (shared with Tika's Phase 0 shadow
// intake, lib/helpdesk.ts) — extracted 2026-07-16, behavior here unchanged.
export type InquiryItem = OpInquiryElement

// In-memory cache, keyed PER USER. This used to be a single global entry on
// the assumption query 112 renders identically for everyone — wrong twice
// over: the query runs under the caller's own OP token (visibility/filters
// can differ per account), and the first user to load within the TTL window
// was serving THEIR result to every other account (found in the first real
// 2-account test).
const TTL_MS = 5 * 60 * 1000
const cacheByUid = new Map<number, { at: number; items: InquiryItem[] }>()

export async function GET() {
  const ctx = await getRequestContext()
  if (process.env.ISL_MULTIUSER === '1' && !ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = ctx?.opToken || process.env.OP_API_TOKEN || ''
  const base  = ctx?.opBaseUrl || process.env.OP_BASE_URL || ''
  if (!token || !base) return NextResponse.json({ error: 'OP not configured' }, { status: 500 })

  const cacheKey = ctx?.uid ?? 0  // 0 = single-user/env-token mode
  const cached = cacheByUid.get(cacheKey)
  if (cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json({
      ok: true,
      items: cached.items,
      fetchedAt: cached.at,
      currentUserId: ctx?.opUserId ?? null,
    })
  }

  const auth = 'Basic ' + Buffer.from(`apikey:${token}`).toString('base64')
  const items = await fetchInquiries(base, auth)

  const fresh = { at: Date.now(), items }
  cacheByUid.set(cacheKey, fresh)

  return NextResponse.json({
    ok: true,
    items,
    fetchedAt: fresh.at,
    currentUserId: ctx?.opUserId ?? null,
  })
}
