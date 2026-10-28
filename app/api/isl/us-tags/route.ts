import { NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/request-auth'
import { suggestUsTag } from '@/lib/us-tag'
import { getCachedTag, setCachedTag } from '@/lib/us-tag-store'

export const runtime = 'nodejs'

// POST /api/isl/us-tags  { items: [{ id: number, subject: string }] }
// Batch-resolve short display tags for SprintRecap's parent (User Story/
// Feature) rows. Cache-first — the LLM call only ever runs once per unique
// (id, subject) pair, in parallel across the batch so a sprint with several
// User Stories doesn't serialize N slow local-LLM calls.
export async function POST(req: Request) {
  const ctx = await getRequestContext()
  if (process.env.ISL_MULTIUSER === '1' && !ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await req.json().catch(() => ({})) as { items?: unknown }
  const items = Array.isArray(body.items)
    ? body.items.filter((i): i is { id: number; subject: string } =>
        !!i && typeof i.id === 'number' && typeof i.subject === 'string' && i.subject.trim().length > 0)
    : []
  if (!items.length) return NextResponse.json({ tags: {} })

  const results = await Promise.all(items.map(async ({ id, subject }) => {
    const cached = getCachedTag(id, subject)
    if (cached) return [id, cached] as const
    const tag = await suggestUsTag(subject)
    setCachedTag(id, subject, tag)
    return [id, tag] as const
  }))

  return NextResponse.json({ tags: Object.fromEntries(results) })
}
