import { db, kbEntries } from './db'
import { eq, desc } from 'drizzle-orm'

export interface KBEntry {
  id: string
  sessionId?: string | null
  userId?: number | null
  date: string
  title: string
  summary: string
  keyPoints: string[]
  suggestedTask?: string | null
  estimatedMins?: number | null
  triageStatus: 'hub' | 'queue' | 'backlog' | 'discarded'
  sprintTarget?: 'current' | 'next' | 'backlog' | null
  createdAt: string
  updatedAt: string
}

function rowToEntry(r: typeof kbEntries.$inferSelect): KBEntry {
  return {
    id:            r.id,
    sessionId:     r.sessionId,
    userId:        r.userId,
    date:          r.date,
    title:         r.title,
    summary:       r.summary,
    keyPoints:     (r.keyPoints as string[]) ?? [],
    suggestedTask: r.suggestedTask,
    estimatedMins: r.estimatedMins,
    triageStatus:  (r.triageStatus as KBEntry['triageStatus']) ?? 'hub',
    sprintTarget:  r.sprintTarget as KBEntry['sprintTarget'],
    createdAt:     r.createdAt.toISOString(),
    updatedAt:     r.updatedAt.toISOString(),
  }
}

export async function getAllKBEntries(uid?: number | null): Promise<KBEntry[]> {
  if (uid != null) {
    const rows = await db.select().from(kbEntries)
      .where(eq(kbEntries.userId, uid))
      .orderBy(desc(kbEntries.createdAt))
    return rows.map(rowToEntry)
  }
  const rows = await db.select().from(kbEntries).orderBy(desc(kbEntries.createdAt))
  return rows.map(rowToEntry)
}

export async function saveKBEntry(entry: KBEntry): Promise<void> {
  await db.insert(kbEntries).values({
    id:            entry.id,
    sessionId:     entry.sessionId ?? null,
    userId:        entry.userId ?? null,
    date:          entry.date,
    title:         entry.title,
    summary:       entry.summary,
    keyPoints:     entry.keyPoints,
    suggestedTask: entry.suggestedTask ?? null,
    estimatedMins: entry.estimatedMins ?? null,
    triageStatus:  entry.triageStatus,
    sprintTarget:  entry.sprintTarget ?? null,
    createdAt:     new Date(entry.createdAt),
    updatedAt:     new Date(entry.updatedAt),
  }).onConflictDoUpdate({
    target: kbEntries.id,
    set: {
      title:         entry.title,
      summary:       entry.summary,
      keyPoints:     entry.keyPoints,
      triageStatus:  entry.triageStatus,
      sprintTarget:  entry.sprintTarget ?? null,
      updatedAt:     new Date(entry.updatedAt),
    }
  })
}

export async function updateKBEntry(id: string, updates: Partial<KBEntry>): Promise<KBEntry | null> {
  const patch: Record<string, unknown> = { ...updates, updatedAt: new Date() }
  if (patch.createdAt) patch.createdAt = new Date(patch.createdAt as string)
  delete patch.id

  const rows = await db.update(kbEntries).set(patch).where(eq(kbEntries.id, id)).returning()
  return rows[0] ? rowToEntry(rows[0]) : null
}

export function createKBId(): string {
  return `kb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}
