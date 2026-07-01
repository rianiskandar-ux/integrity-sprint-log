// Next.js instrumentation — tangkap SEMUA error server-side secara terpusat.
// onRequestError dipanggil tiap ada error di route/server component.

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  try {
    const { logger } = await import('./lib/logger')
    logger.info('isl-startup', { at: new Date().toISOString() })
  } catch { /* ignore */ }

  // Ensure FTS indexes exist — safe to run every startup (IF NOT EXISTS)
  // Drizzle doesn't support expression indexes natively so we manage them here.
  try {
    const { db } = await import('./lib/db')
    const { sql } = await import('drizzle-orm')
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS sessions_fts_idx ON sessions
        USING gin(to_tsvector('simple', title || ' ' || COALESCE(bullets::text, '')));
      CREATE INDEX IF NOT EXISTS kb_entries_fts_idx ON kb_entries
        USING gin(to_tsvector('simple', title || ' ' || summary || ' ' || COALESCE(key_points::text, '')));
      CREATE INDEX IF NOT EXISTS task_memory_fts_idx ON task_memory
        USING gin(to_tsvector('simple', title || ' ' || COALESCE(bullets::text, '')));
      CREATE INDEX IF NOT EXISTS daily_logs_fts_idx ON daily_logs
        USING gin(to_tsvector('simple', title || ' ' || COALESCE(bullets::text, '')));
    `)
  } catch { /* non-fatal — indexes already exist or DB not ready yet */ }
}

export async function onRequestError(
  err: unknown,
  request: { path?: string; method?: string },
  context: { routeType?: string },
) {
  // Hanya di runtime nodejs (logger pakai fs)
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  try {
    const { logger, alertCritical } = await import('./lib/logger')
    const e = err as Error
    const title = `${request?.method ?? '?'} ${request?.path ?? '?'}`
    logger.error('request-error', {
      path: request?.path,
      method: request?.method,
      routeType: context?.routeType,
      message: e?.message,
      stack: e?.stack,
    })
    // Alert kritis hanya untuk API routes (bukan tiap render glitch)
    if (context?.routeType === 'route') {
      await alertCritical(title, e?.message ?? String(err))
    }
  } catch { /* never throw from error handler */ }
}
