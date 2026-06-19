/**
 * One-time migration: flat JSON files → Postgres
 * Run: npx tsx scripts/migrate-json-to-pg.ts
 *
 * Safe to run multiple times — uses upsert (onConflictDoNothing).
 */
import fs from 'fs'
import path from 'path'
import { db, sessions, kbEntries, processedSessions } from '../lib/db'

const DATA_DIR = process.env.CACHE_DATA_DIR ?? process.cwd()

// ── Migrate sessions ───────────────────────────────────────────────────────────
async function migrateSessions() {
  const dir = path.join(DATA_DIR, 'session-logs')
  if (!fs.existsSync(dir)) { console.log('No session-logs dir, skipping'); return }

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
  console.log(`Migrating ${files.length} session files…`)
  let ok = 0, skip = 0

  for (const f of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))
      await db.insert(sessions).values({
        id:               raw.id,
        sessionId:        raw.sessionId ?? null,
        userId:           null, // users table empty at import time — FK would fail
        date:             raw.date,
        title:            raw.title,
        bullets:          raw.bullets ?? [],
        source:           raw.source ?? null,
        startedAt:        raw.startedAt,
        endedAt:          raw.endedAt ?? null,
        actualMins:       raw.actualMins ?? null,
        estimatedMins:    raw.estimatedMins ?? 30,
        opTaskId:         raw.opTaskId ?? null,
        opStoryId:        raw.opStoryId ?? null,
        opEpicId:         raw.opEpicId ?? null,
        isNewTask:        raw.isNewTask ?? false,
        taskStatus:       raw.taskStatus ?? null,
        aiStatus:         raw.aiStatus ?? null,
        hasExplicitCmd:   raw.hasExplicitCmd ?? false,
        needsValidation:  raw.needsValidation ?? false,
        command:          raw.command ?? null,
        ticketBinding:    raw.ticketBinding ?? null,
        relatedOldTaskId: raw.relatedOldTaskId ?? null,
        tokenUsage:       raw.tokenUsage ?? null,
        pushStatus:       raw.pushStatus ?? 'pending',
        autoPushed:       raw.autoPushed ?? false,
        undoneAt:         raw.undoneAt ?? null,
        createdAt:        new Date(raw.createdAt),
        updatedAt:        new Date(raw.updatedAt),
      }).onConflictDoNothing()
      ok++
    } catch (e) {
      console.error(`  ✗ ${f}:`, e)
      skip++
    }
  }
  console.log(`  Sessions: ${ok} migrated, ${skip} skipped`)
}

// ── Migrate KB entries ─────────────────────────────────────────────────────────
async function migrateKBEntries() {
  const file = path.join(DATA_DIR, 'daily-hub', 'kb-entries.json')
  if (!fs.existsSync(file)) { console.log('No kb-entries.json, skipping'); return }

  const entries: Record<string, unknown>[] = JSON.parse(fs.readFileSync(file, 'utf-8'))
  console.log(`Migrating ${entries.length} KB entries…`)
  let ok = 0

  for (const e of entries) {
    try {
      await db.insert(kbEntries).values({
        id:            e.id as string,
        sessionId:     (e.sessionId as string) ?? null,
        userId:        (e.userId as number) ?? null,
        date:          e.date as string,
        title:         e.title as string,
        summary:       e.summary as string,
        keyPoints:     (e.keyPoints as string[]) ?? [],
        suggestedTask: (e.suggestedTask as string) ?? null,
        estimatedMins: (e.estimatedMins as number) ?? null,
        triageStatus:  (e.triageStatus as string) ?? 'hub',
        sprintTarget:  (e.sprintTarget as string) ?? null,
        createdAt:     new Date(e.createdAt as string),
        updatedAt:     new Date(e.updatedAt as string),
      }).onConflictDoNothing()
      ok++
    } catch (e) { console.error('  ✗ KB entry:', e) }
  }
  console.log(`  KB entries: ${ok} migrated`)
}

// ── Migrate processed sessions ─────────────────────────────────────────────────
async function migrateProcessed() {
  const file = path.join(DATA_DIR, 'processed-sessions.json')
  if (!fs.existsSync(file)) { console.log('No processed-sessions.json, skipping'); return }

  const raw: Record<string, unknown> = JSON.parse(fs.readFileSync(file, 'utf-8'))
  const ids = Array.isArray(raw) ? raw : Object.keys(raw)
  console.log(`Migrating ${ids.length} processed session IDs…`)

  for (const sid of ids) {
    await db.insert(processedSessions).values({ sessionId: String(sid) }).onConflictDoNothing()
  }
  console.log(`  Processed: ${ids.length} migrated`)
}

// ── Run ────────────────────────────────────────────────────────────────────────
;(async () => {
  console.log('Starting JSON → Postgres migration…')
  await migrateSessions()
  await migrateKBEntries()
  await migrateProcessed()
  console.log('Migration complete.')
  process.exit(0)
})()
