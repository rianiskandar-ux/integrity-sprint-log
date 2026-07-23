/**
 * Dira — Timekeeper estimate loop (v1, 2026-07-23).
 *
 * Estimates a task's duration from how long SIMILAR past work ACTUALLY took,
 * instead of only fixed keyword buckets (60/120/240m). Same retrieval-not-
 * training philosophy as Arka/Tika: learn from real outcomes, useful from the
 * first handful of records.
 *
 * No new storage: sessions are ALREADY embedded (sourceType 'session', keyed
 * by session row id) and the sessions table already holds actual_mins — so
 * this just finds semantically-similar past sessions and takes the median of
 * their real actual durations. Falls back cleanly (suggestedMins=null) when
 * there isn't enough close history, so callers keep their keyword estimate.
 */
import { db, sessions } from './db'
import { inArray } from 'drizzle-orm'
import { hybridSearch } from './embeddings'

// Only sessions genuinely close in meaning inform the estimate. hybridSearch
// distance: keyword hits ~0-0.1, semantic hits are cosine-ish; 0.45 keeps it
// to real matches, not vaguely-related work.
const CLOSE_DISTANCE = 0.45
const MIN_SAMPLES = 2          // need at least a couple of comparable tasks
const MIN_REAL_MINS = 3        // ignore trivial/noise durations
const MAX_REAL_MINS = 480      // clamp outliers (a single 8h+ session shouldn't skew)

export interface DiraEstimate {
  suggestedMins: number | null
  sampleCount: number
  basis: { min: number; median: number; max: number } | null
}

export async function estimateFromHistory(title: string, bullets: string[]): Promise<DiraEstimate> {
  const query = [title, ...(bullets ?? [])].filter(Boolean).join(' ').trim()
  if (!query) return { suggestedMins: null, sampleCount: 0, basis: null }

  let hits
  try { hits = await hybridSearch(query, null, 25) } catch { return { suggestedMins: null, sampleCount: 0, basis: null } }

  const ids = hits
    .filter(h => h.sourceType === 'session' && h.distance <= CLOSE_DISTANCE)
    .map(h => h.sourceId)
  if (ids.length < MIN_SAMPLES) return { suggestedMins: null, sampleCount: ids.length, basis: null }

  let rows
  try {
    rows = await db.select({ actualMins: sessions.actualMins }).from(sessions).where(inArray(sessions.id, ids))
  } catch { return { suggestedMins: null, sampleCount: 0, basis: null } }

  const mins = rows
    .map(r => r.actualMins)
    .filter((m): m is number => typeof m === 'number' && m >= MIN_REAL_MINS)
    .map(m => Math.min(m, MAX_REAL_MINS))
    .sort((a, b) => a - b)

  if (mins.length < MIN_SAMPLES) return { suggestedMins: null, sampleCount: mins.length, basis: null }

  const median = mins[Math.floor(mins.length / 2)]
  return {
    suggestedMins: median,
    sampleCount: mins.length,
    basis: { min: mins[0], median, max: mins[mins.length - 1] },
  }
}
