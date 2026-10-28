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

  // ticket_drafts (Okt 2026) dibuat dengan drizzle-kit push di mesin Rian — tidak ada migrasinya, dan
  // docker/init-db.sql hanya jalan saat volume Postgres pertama kali dibuat. Instalasi tim yang
  // update lewat `git pull` + `docker compose up -d --build` tidak akan punya tabel ini → tab Sprint
  // (draf tiket) 500. DDL di bawah = salinan persis tabel live; aman diulang tiap startup.
  // Blok terpisah: kegagalan indeks FTS di atas tidak boleh mencegah tabel ini dibuat.
  try {
    const { db } = await import('./lib/db')
    const { sql } = await import('drizzle-orm')
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ticket_drafts (
        id text PRIMARY KEY,
        user_id integer NOT NULL,
        sprint_id integer,
        parent_id integer,
        type_id integer NOT NULL DEFAULT 1,
        subject text NOT NULL,
        description text,
        estimated_mins integer,
        status text NOT NULL DEFAULT 'draft',
        op_wp_id integer,
        push_error text,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now(),
        pushed_at timestamp,
        target_status text NOT NULL DEFAULT 'new',
        time_logs jsonb NOT NULL DEFAULT '[]'::jsonb,
        check_ok boolean NOT NULL DEFAULT false,
        check_issues jsonb NOT NULL DEFAULT '[]'::jsonb,
        checked_at timestamp,
        kind text NOT NULL DEFAULT 'create',
        target_wp_id integer,
        target_snapshot jsonb,
        activity jsonb NOT NULL DEFAULT '[]'::jsonb,
        auto_matched boolean NOT NULL DEFAULT false
      );
      CREATE INDEX IF NOT EXISTS ticket_drafts_user_sprint_idx ON ticket_drafts (user_id, sprint_id, status);
    `)
  } catch { /* non-fatal — DB belum siap; dicoba lagi di startup berikutnya */ }
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
