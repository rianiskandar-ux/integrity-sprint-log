import { NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/request-auth'
import { getGeminiKey, semanticSearch } from '@/lib/embeddings'

export const runtime = 'nodejs'

// GET /api/isl/semantic-search?q=text&k=5
// → { results: SemanticResult[], enabled: boolean }
// enabled=false (with empty results) when GEMINI_API_KEY is not configured.
export async function GET(req: Request) {
  try {
    const ctx = await getRequestContext()
    if (process.env.ISL_MULTIUSER === '1' && !ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const enabled = !!getGeminiKey()
    const { searchParams } = new URL(req.url)
    const q = searchParams.get('q')?.trim()
    if (!q || q.length < 2 || !enabled) {
      return NextResponse.json({ results: [], enabled })
    }

    const k = Math.min(Math.max(Number(searchParams.get('k') ?? '5') || 5, 1), 20)
    const results = await semanticSearch(q, ctx?.uid ?? null, k)

    return NextResponse.json({ results, enabled })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
