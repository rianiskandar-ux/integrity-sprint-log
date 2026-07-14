import { NextRequest, NextResponse } from 'next/server'
import { hybridSearch } from '@/lib/embeddings'
import { getRequestContext } from '@/lib/request-auth'
import { OWNER_UID } from '@/lib/auth'

export const runtime = 'nodejs'

// ── Arka Correction Loop v1 — retrieval endpoint ──────────────────────────────
// Serves past corrections (sessions where Rian re-assigned a session away from
// Arka's original opTaskId guess) to whoever asks — most importantly the
// HOST-SIDE hook (hooks/isl-context.mjs), which has no direct DB access and
// must call this over HTTP before it runs findMatchingTask again. Retrieval,
// not training: useful from the very first correction ever logged.

// ── Auth: browser session OR machine key (hook calls this headless) ──────────
async function resolveAuth(req: NextRequest): Promise<{ uid: number } | null> {
  const key = process.env.KAFI_API_KEY
  const machineAuth =
    req.headers.get('x-kafi-key') === key ||
    new URL(req.url).searchParams.get('key') === key
  if (machineAuth) return { uid: OWNER_UID }

  const ctx = await getRequestContext()
  if (ctx) return { uid: ctx.uid }
  return null
}

// GET /api/arka/corrections?query=<session title + bullets text>&limit=3
export async function GET(req: NextRequest) {
  const auth = await resolveAuth(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const query = (searchParams.get('query') ?? '').trim()
  const limit = Math.min(10, Math.max(1, Number(searchParams.get('limit')) || 3))

  if (!query) return NextResponse.json({ ok: true, corrections: [] })

  try {
    // hybridSearch has no sourceType filter param (shared by many other callers,
    // not worth risking a signature change for) — over-fetch and post-filter here.
    const results = await hybridSearch(query, null, Math.max(limit * 5, 20))
    const corrections = results
      .filter(r => r.sourceType === 'correction')
      .slice(0, limit)
      .map(r => ({ title: r.title, chunk: r.chunk, distance: r.distance }))

    return NextResponse.json({ ok: true, corrections })
  } catch (e) {
    console.error('[arka-corrections] error:', e)
    return NextResponse.json({ ok: true, corrections: [] })
  }
}
