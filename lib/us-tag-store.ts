/**
 * Cache for User Story short-tags (SprintRecap's compressed prefix, e.g. a US
 * titled "Phoenix v2: interactive system maps (Archify) + presentation wiring"
 * shows as "Phoenix v2: Archify" above each of its child task rows). Same
 * file-cache pattern as sprint-summary-store.ts — one JSON file, no DB table
 * needed for something this disposable (recomputed if the subject changes).
 */
import fs from 'fs'
import path from 'path'

const DIR = process.env.CACHE_DATA_DIR ?? process.cwd()
const FILE = path.join(DIR, 'us-tags.json')

interface Entry { subject: string; tag: string }

function load(): Record<number, Entry> {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf-8')) } catch { return {} }
}

function save(map: Record<number, Entry>) {
  try { fs.writeFileSync(FILE, JSON.stringify(map), 'utf-8') } catch { /* best-effort cache */ }
}

/** Returns the cached tag only if it was computed for THIS exact subject text — a
 *  renamed User Story invalidates automatically instead of showing a stale tag. */
export function getCachedTag(id: number, subject: string): string | null {
  const entry = load()[id]
  return entry && entry.subject === subject ? entry.tag : null
}

export function setCachedTag(id: number, subject: string, tag: string) {
  const map = load()
  map[id] = { subject, tag }
  save(map)
}
