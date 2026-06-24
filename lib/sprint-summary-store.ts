/**
 * Per-user archive of sprint summaries. Lets the user save the AI sprint recap
 * "to memory" and look it back up later, one entry per sprint.
 */
import fs from 'fs'
import path from 'path'

const DIR = process.env.CACHE_DATA_DIR ?? process.cwd()
function file(uid: number): string {
  return path.join(DIR, `sprint-summaries-${uid}.json`)
}

export interface SprintSummary {
  sprint: string
  summary: string
  savedAt: string
}

export function listSummaries(uid: number): SprintSummary[] {
  try { return JSON.parse(fs.readFileSync(file(uid), 'utf-8')) as SprintSummary[] } catch { return [] }
}

export function saveSummary(uid: number, s: SprintSummary): SprintSummary[] {
  // One entry per sprint — replace if it already exists, newest first.
  const next = [s, ...listSummaries(uid).filter(x => x.sprint !== s.sprint)].slice(0, 50)
  fs.writeFileSync(file(uid), JSON.stringify(next, null, 2), 'utf-8')
  return next
}

export function deleteSummary(uid: number, sprint: string): SprintSummary[] {
  const next = listSummaries(uid).filter(x => x.sprint !== sprint)
  fs.writeFileSync(file(uid), JSON.stringify(next, null, 2), 'utf-8')
  return next
}
