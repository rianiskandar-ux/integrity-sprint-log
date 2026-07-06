import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sessions, kbEntries, dailyLogs, embeddings } from '@/lib/db/schema'
import { sql } from 'drizzle-orm'
import { upsertEmbedding, hybridSearch, type EmbeddingSourceType } from '@/lib/embeddings'

export const runtime = 'nodejs'
export const maxDuration = 300

const KAFI_KEY = process.env.KAFI_API_KEY || 'kafi-bridge-2026'

function authed(req: Request): boolean {
  const url = new URL(req.url)
  return req.headers.get('x-kafi-key') === KAFI_KEY || url.searchParams.get('key') === KAFI_KEY
}

// POST /api/internal/backfill-embeddings?key=...&q=optional-test-query
// Embed semua sessions + kb_entries + daily_logs yang belum punya embedding.
export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const url = new URL(req.url)

  const joinBullets = (b: unknown) => (Array.isArray(b) ? b.filter(Boolean).join('\n') : '')
  let done = 0, skipped = 0

  async function embedAll(rows: Array<{ id: string; userId: number | null; title: string; chunk: string }>, type: EmbeddingSourceType) {
    for (const r of rows) {
      if (!r.title?.trim()) { skipped++; continue }
      const before = done
      await upsertEmbedding({ userId: r.userId, sourceType: type, sourceId: r.id, title: r.title, chunk: r.chunk })
      // upsertEmbedding silent — verifikasi via count nanti; asumsikan sukses
      done = before + 1
    }
  }

  const [sess, kbs, logs] = await Promise.all([
    db.select().from(sessions),
    db.select().from(kbEntries),
    db.select().from(dailyLogs),
  ])

  await embedAll(sess.map(s => ({ id: s.id, userId: s.userId, title: s.title, chunk: joinBullets(s.bullets) })), 'session')
  await embedAll(kbs.map(k => ({ id: String(k.id), userId: k.userId, title: k.title, chunk: `${k.summary ?? ''}\n${joinBullets(k.keyPoints)}` })), 'kb')
  await embedAll(logs.map(l => ({ id: l.id, userId: l.userId, title: l.title, chunk: joinBullets(l.bullets) })), 'daily_log')

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(embeddings)

  // Optional: test semantic search langsung dari sini (internal, ber-key)
  const q = url.searchParams.get('q')
  const testResults = q ? await hybridSearch(q, 1, 5) : undefined

  return NextResponse.json({
    ok: true,
    attempted: done,
    skippedEmptyTitle: skipped,
    embeddingsInDb: count,
    ...(testResults ? { testQuery: q, testResults } : {}),
  })
}
