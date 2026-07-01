import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sessions, kbEntries, taskMemory, dailyLogs } from '@/lib/db/schema'
import { getRequestContext } from '@/lib/request-auth'
import { sql, and, eq } from 'drizzle-orm'

export const runtime = 'nodejs'

export interface SearchResult {
  type: 'session' | 'kb' | 'task_memory' | 'daily_log'
  id: string
  title: string
  snippet: string
  date: string
  rank: number
  meta?: Record<string, unknown>
}

// GET /api/isl/search?q=text&limit=10&types=session,kb,task_memory,daily_log
export async function GET(req: Request) {
  try {
    const ctx = await getRequestContext()
    const { searchParams } = new URL(req.url)
    const q = searchParams.get('q')?.trim()
    if (!q || q.length < 2) {
      return NextResponse.json({ results: [] })
    }

    const limit = Math.min(Number(searchParams.get('limit') ?? '10'), 30)
    const types = (searchParams.get('types') ?? 'session,kb,task_memory,daily_log').split(',')

    // plainto_tsquery handles multi-word queries safely (no special char injection)
    const tsq = sql`plainto_tsquery('simple', ${q})`
    const uid = ctx?.uid ?? null
    const results: SearchResult[] = []

    // ── sessions ──────────────────────────────────────────────────────────────
    if (types.includes('session')) {
      const tsv = sql`to_tsvector('simple', ${sessions.title} || ' ' || COALESCE(${sessions.bullets}::text, ''))`
      const rows = await db.select({
        id:       sessions.id,
        title:    sessions.title,
        bullets:  sessions.bullets,
        date:     sessions.date,
        opTaskId: sessions.opTaskId,
        rank:     sql<number>`ts_rank(${tsv}, ${tsq})`,
      }).from(sessions)
        .where(and(
          uid ? eq(sessions.userId, uid) : sql`true`,
          sql`${tsv} @@ ${tsq}`,
        ))
        .orderBy(sql`ts_rank(${tsv}, ${tsq}) DESC`)
        .limit(limit)

      for (const r of rows) {
        results.push({
          type: 'session',
          id: r.id,
          title: r.title,
          snippet: (r.bullets as string[] ?? []).slice(0, 2).join(' · ') || r.title,
          date: r.date,
          rank: r.rank,
          meta: { opTaskId: r.opTaskId },
        })
      }
    }

    // ── kb_entries ────────────────────────────────────────────────────────────
    if (types.includes('kb')) {
      const tsv = sql`to_tsvector('simple', ${kbEntries.title} || ' ' || ${kbEntries.summary} || ' ' || COALESCE(${kbEntries.keyPoints}::text, ''))`
      const rows = await db.select({
        id:      kbEntries.id,
        title:   kbEntries.title,
        summary: kbEntries.summary,
        date:    kbEntries.date,
        rank:    sql<number>`ts_rank(${tsv}, ${tsq})`,
      }).from(kbEntries)
        .where(and(
          uid ? eq(kbEntries.userId, uid) : sql`true`,
          sql`${tsv} @@ ${tsq}`,
        ))
        .orderBy(sql`ts_rank(${tsv}, ${tsq}) DESC`)
        .limit(limit)

      for (const r of rows) {
        results.push({
          type: 'kb',
          id: r.id,
          title: r.title,
          snippet: r.summary.slice(0, 120),
          date: r.date,
          rank: r.rank,
        })
      }
    }

    // ── task_memory ───────────────────────────────────────────────────────────
    if (types.includes('task_memory')) {
      const tsv = sql`to_tsvector('simple', ${taskMemory.title} || ' ' || COALESCE(${taskMemory.bullets}::text, ''))`
      const rows = await db.select({
        id:        taskMemory.id,
        title:     taskMemory.title,
        bullets:   taskMemory.bullets,
        date:      taskMemory.date,
        opTaskId:  taskMemory.opTaskId,
        rank:      sql<number>`ts_rank(${tsv}, ${tsq})`,
      }).from(taskMemory)
        .where(and(
          uid ? eq(taskMemory.userId, uid) : sql`true`,
          sql`${tsv} @@ ${tsq}`,
        ))
        .orderBy(sql`ts_rank(${tsv}, ${tsq}) DESC`)
        .limit(limit)

      for (const r of rows) {
        results.push({
          type: 'task_memory',
          id: r.id,
          title: r.title,
          snippet: (r.bullets as string[] ?? []).slice(0, 2).join(' · ') || r.title,
          date: r.date,
          rank: r.rank,
          meta: { opTaskId: r.opTaskId },
        })
      }
    }

    // ── daily_logs ────────────────────────────────────────────────────────────
    if (types.includes('daily_log')) {
      const tsv = sql`to_tsvector('simple', ${dailyLogs.title} || ' ' || COALESCE(${dailyLogs.bullets}::text, ''))`
      const rows = await db.select({
        id:      dailyLogs.id,
        title:   dailyLogs.title,
        bullets: dailyLogs.bullets,
        date:    dailyLogs.date,
        rank:    sql<number>`ts_rank(${tsv}, ${tsq})`,
      }).from(dailyLogs)
        .where(and(
          uid ? eq(dailyLogs.userId, uid) : sql`true`,
          sql`${tsv} @@ ${tsq}`,
        ))
        .orderBy(sql`ts_rank(${tsv}, ${tsq}) DESC`)
        .limit(limit)

      for (const r of rows) {
        results.push({
          type: 'daily_log',
          id: r.id,
          title: r.title,
          snippet: (r.bullets as string[] ?? []).slice(0, 2).join(' · ') || r.title,
          date: r.date,
          rank: r.rank,
        })
      }
    }

    // merge + re-rank by ts_rank score
    results.sort((a, b) => b.rank - a.rank)

    return NextResponse.json({ results: results.slice(0, limit), query: q })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
