import fs from 'fs'
import path from 'path'

const CACHE_DIR  = process.env.CACHE_DATA_DIR ?? process.cwd()

// IMPORTANT: no shared/global cache file. If we don't know which user this is
// (unresolved session), we must NOT fall back to anyone's data — return null so
// loadCache yields EMPTY and saveCache is a no-op. This structurally prevents
// one user's OP cache from ever leaking to another (e.g. an unauthenticated or
// before-login request hitting the dashboard).
function cacheFileFor(userId?: number | null): string | null {
  if (!userId) return null
  return path.join(CACHE_DIR, `op-cache-${userId}.json`)
}

// OP status ID → ISL status label mapping
export const OP_STATUS_MAP: Record<number, { isl: string; label: string; color: string }> = {
  1:  { isl: 'new',         label: 'New',         color: '#6b7280' },
  7:  { isl: 'in_progress', label: 'In Progress',  color: '#3b82f6' },
  8:  { isl: 'on_hold',     label: 'On Hold',      color: '#f59e0b' },
  12: { isl: 'done',        label: 'Closed',       color: '#10b981' },
  14: { isl: 'rejected',    label: 'Rejected',     color: '#ef4444' },
  6:  { isl: 'rejected',    label: 'Rejected',     color: '#ef4444' },
}

// ISL task status → OP status ID
export const ISL_TO_OP_STATUS: Record<string, number> = {
  'new':         1,
  'in-progress': 7,
  'in_progress': 7,
  'on-hold':     8,
  'on_hold':     8,
  'done':        12,
  'rejected':    14,
  'abandoned':   1,  // abandoned in ISL = moved to New (backlog) in OP
}

export interface CachedUserStory {
  id: number
  subject: string
  status: string
  project: string
  projectId: number
  href: string
  epicId?: number | null
}

export type TaskSource = 'assigned' | 'accountable' | 'authored'

export interface CachedWorkPackage {
  id: number
  subject: string
  status: string         // OP status label
  opStatusId: number | null
  islStatus: string      // mapped ISL status key
  type: string
  project: string
  projectId: number
  userStoryId: number | null
  sprintId: number | null
  sprintName: string | null
  href: string
  assignee: string | null
  assigneeId: number | null
  isOwn: boolean         // I am the assignee
  createdAt: string | null
  updatedAt: string | null
  createdBy: string | null
  createdById: number | null
  source: TaskSource[]   // how this WP relates to me
  isClosed: boolean
  dueDate: string | null        // YYYY-MM-DD, OP's own field — null if not set
  estimatedHours: number | null
}

export interface CachedSprint {
  id: number
  name: string
  startDate: string
  endDate: string
  status: string
  projectIdentifier: string
  isCurrent: boolean
}

export interface CachedEpic {
  id: number
  subject: string
  status: string
  project: string
  projectId: number
  href: string
  description?: string
}

export interface CachedProject {
  id: number
  name: string
  identifier: string
}

export interface OPCache {
  lastSync: string | null
  userId: number | null
  userName: string | null
  userStories: CachedUserStory[]
  epics: CachedEpic[]
  myOpenTasks: CachedWorkPackage[]      // open tasks I'm involved in
  myClosedTasks: CachedWorkPackage[]    // closed/done tasks (last sprint)
  incomingTasks: CachedWorkPackage[]    // open tasks from others (assigned TO me, created by others)
  sprints: CachedSprint[]
  watchedProjects: CachedProject[]
  // Each per-project/per-filter OP fetch below is independently try/caught so
  // one flaky call doesn't kill the whole sync — correct, but it used to mean
  // a TOTAL failure of one fetch (e.g. one of the 6 assignee/accountable/author
  // x open/closed queries) silently produced an incomplete-but-plausible task
  // count with zero trace anywhere (found 2026-08-18, same failure shape as
  // the sprint-retention and Team-Board-sync-wipe bugs the same day — a wrong
  // non-zero number is far harder to notice than an empty one). This just
  // makes those catches visible instead of silent; nothing here changes
  // resilience behavior, still skip-and-continue, just no longer mute.
  fetchWarnings: string[]
}

const EMPTY: OPCache = {
  lastSync: null,
  userId: null,
  userName: null,
  userStories: [],
  epics: [],
  myOpenTasks: [],
  myClosedTasks: [],
  incomingTasks: [],
  sprints: [],
  watchedProjects: [],
  fetchWarnings: [],
}

export function loadCache(userId?: number | null): OPCache {
  const file = cacheFileFor(userId)
  if (!file) return EMPTY   // unknown user → empty, never another user's cache
  try {
    if (!fs.existsSync(file)) return EMPTY
    return { ...EMPTY, ...JSON.parse(fs.readFileSync(file, 'utf-8')) }
  } catch { return EMPTY }
}

export function saveCache(cache: OPCache, userId?: number | null) {
  const file = cacheFileFor(userId)
  if (!file) return         // never write a shared/global cache
  fs.writeFileSync(file, JSON.stringify(cache, null, 2), 'utf-8')
}

// Update a single WP's status in the local cache (after OP PATCH)
export function updateCachedWPStatus(wpId: number, opStatusId: number, userId?: number | null) {
  const cache = loadCache(userId)
  const mapped = OP_STATUS_MAP[opStatusId]
  const update = (wp: CachedWorkPackage) =>
    wp.id === wpId
      ? { ...wp, opStatusId, status: mapped?.label ?? wp.status, islStatus: mapped?.isl ?? wp.islStatus }
      : wp
  cache.myOpenTasks  = cache.myOpenTasks.map(update)
  cache.myClosedTasks = cache.myClosedTasks.map(update)
  cache.incomingTasks = cache.incomingTasks.map(update)
  saveCache(cache, userId)
}

async function opGet(base: string, token: string, opPath: string) {
  const res = await fetch(`${base}/api/v3${opPath}`, {
    headers: {
      Authorization: 'Basic ' + Buffer.from(`apikey:${token}`).toString('base64'),
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) throw new Error(`OP ${res.status} ${opPath}`)
  return res.json()
}

function parseWP(
  wp: Record<string, unknown>,
  identifier: string,
  projectId: number,
  source: TaskSource,
): CachedWorkPackage {
  const links = (wp._links ?? {}) as Record<string, { href?: string; title?: string } | null>

  const parentHref   = links.parent?.href ?? ''
  const parentId     = parentHref ? parseInt(parentHref.split('/').pop()!) : null
  const versionHref  = links.version?.href ?? ''
  const sprintId     = versionHref ? parseInt(versionHref.split('/').pop()!) : null
  const assigneeHref = links.assignee?.href ?? ''
  const assigneeId   = assigneeHref ? parseInt(assigneeHref.split('/').pop()!) : null
  const authorHref   = links.author?.href ?? ''
  const authorId     = authorHref ? parseInt(authorHref.split('/').pop()!) : null

  const statusHref = links.status?.href ?? ''
  const rawStatusId = statusHref ? parseInt(statusHref.split('/').pop()!) : null
  const opStatusId  = rawStatusId && !isNaN(rawStatusId) ? rawStatusId : null
  const mapped      = opStatusId ? OP_STATUS_MAP[opStatusId] : null

  const isClosed = opStatusId === 12 || opStatusId === 14 || opStatusId === 6

  const estMatch = typeof wp.estimatedTime === 'string' ? wp.estimatedTime.match(/PT(?:(\d+)H)?(?:(\d+)M)?/) : null
  const estimatedHours = estMatch ? Math.round(((parseInt(estMatch[1] ?? '0') * 60 + parseInt(estMatch[2] ?? '0')) / 60) * 10) / 10 : null

  return {
    id:          wp.id as number,
    subject:     wp.subject as string,
    status:      links.status?.title ?? '',
    opStatusId,
    islStatus:   mapped?.isl ?? 'new',
    type:        links.type?.title ?? 'Task',
    project:     identifier,
    projectId,
    userStoryId: parentId,
    sprintId,
    sprintName:  links.version?.title ?? null,
    href:        `/api/v3/work_packages/${wp.id}`,
    assignee:    links.assignee?.title ?? null,
    assigneeId,
    isOwn:       source === 'assigned',
    createdAt:   (wp.createdAt as string) ?? null,
    updatedAt:   (wp.updatedAt as string) ?? null,
    createdBy:   links.author?.title ?? null,
    createdById: authorId,
    source:      [source],
    isClosed,
    dueDate:     (wp.dueDate as string) ?? null,
    estimatedHours,
  }
}

export async function rebuildCache(
  token: string,
  base: string,
  projectIdentifiers: string[],
  userId: number,          // OP user id — drives assignee/accountable/author filters
  userName?: string,
  saveUserId?: number,     // internal app uid — file key for saveCache; defaults to userId
): Promise<OPCache> {
  const today         = new Date().toISOString().slice(0, 10)
  // Use sprint start date for closed task lookback — falls back to 30 days if no sprint
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  // Will be updated after sprints are fetched — used for closed tasks cutoff
  let sprintStartCutoff = thirtyDaysAgo

  const userStories:      CachedUserStory[]   = []
  const epics:            CachedEpic[]        = []
  const openTasks:        Map<number, CachedWorkPackage> = new Map()
  const closedTasks:      Map<number, CachedWorkPackage> = new Map()
  const sprints:          CachedSprint[]      = []
  const watchedProjects:  CachedProject[]     = []
  const fetchWarnings:    string[]            = []
  const warn = (msg: string) => { fetchWarnings.push(msg); console.warn(`[op-cache] ${msg}`) }

  for (const identifier of projectIdentifiers) {
    let projectId: number
    try {
      const proj = await opGet(base, token, `/projects/${identifier}`)
      projectId = proj.id
      watchedProjects.push({ id: projectId, name: proj.name as string, identifier })
    } catch (e) { warn(`project '${identifier}' unreachable, skipping entirely: ${e instanceof Error ? e.message : String(e)}`); continue }

    // ── Epics (all, not just open — for !ticket:ID lookup) ──────────────
    try {
      const filters = encodeURIComponent(JSON.stringify([
        { project: { operator: '=', values: [String(projectId)] } },
        { type:    { operator: '=', values: ['5'] } },  // type 5 = Epic
      ]))
      const res = await opGet(base, token, `/work_packages?filters=${filters}&pageSize=100&sortBy=${encodeURIComponent('[["updatedAt","desc"]]')}`)
      for (const wp of res._embedded?.elements ?? []) {
        epics.push({
          id:          wp.id,
          subject:     wp.subject,
          status:      wp._links?.status?.title ?? '',
          project:     identifier,
          projectId,
          href:        `/api/v3/work_packages/${wp.id}`,
          description: (wp.description?.raw ?? '').slice(0, 200),
        })
      }
    } catch (e) { warn(`epics fetch failed for '${identifier}': ${e instanceof Error ? e.message : String(e)}`) }

    // ── User Stories (open) ──────────────────────────────────────────────
    try {
      const filters = encodeURIComponent(JSON.stringify([
        { project: { operator: '=', values: [String(projectId)] } },
        { type:    { operator: '=', values: ['6'] } },
        { status:  { operator: '!', values: ['12', '14', '6'] } },
      ]))
      const res = await opGet(base, token, `/work_packages?filters=${filters}&pageSize=50&sortBy=${encodeURIComponent('[["updatedAt","desc"]]')}`)
      for (const wp of res._embedded?.elements ?? []) {
        const parentHref = wp._links?.parent?.href ?? ''
        const parentId   = parentHref ? parseInt(parentHref.split('/').pop()!) : null
        userStories.push({
          id:        wp.id,
          subject:   wp.subject,
          status:    wp._links.status?.title ?? '',
          project:   identifier,
          projectId,
          href:      `/api/v3/work_packages/${wp.id}`,
          epicId:    parentId,
        })
      }
    } catch (e) { warn(`user stories fetch failed for '${identifier}': ${e instanceof Error ? e.message : String(e)}`) }

    // ── My tasks: assignee + accountable + author ────────────────────────
    // We fetch open and recent-closed separately
    const principalSources: Array<[string, TaskSource]> = [
      ['assignee',    'assigned'],
      ['accountable', 'accountable'],
      ['author',      'authored'],
    ]

    for (const [principalFilter, source] of principalSources) {
      // Open tasks
      try {
        const filters = encodeURIComponent(JSON.stringify([
          { project:          { operator: '=', values: [String(projectId)] } },
          { type:             { operator: '=', values: ['1', '7', '4'] } },
          { [principalFilter]:{ operator: '=', values: [String(userId)] } },
          { status:           { operator: '!', values: ['12', '14', '6'] } },
        ]))
        const res = await opGet(base, token, `/work_packages?filters=${filters}&pageSize=50&sortBy=${encodeURIComponent('[["updatedAt","desc"]]')}`)
        for (const wp of res._embedded?.elements ?? []) {
          if (openTasks.has(wp.id)) {
            // Merge source list
            const existing = openTasks.get(wp.id)!
            if (!existing.source.includes(source)) existing.source.push(source)
            if (source === 'assigned') existing.isOwn = true
          } else {
            openTasks.set(wp.id, parseWP(wp, identifier, projectId, source))
          }
        }
      } catch (e) { warn(`open tasks (${principalFilter}) fetch failed for '${identifier}': ${e instanceof Error ? e.message : String(e)}`) }

      // Recent closed tasks (last 30 days)
      try {
        const filters = encodeURIComponent(JSON.stringify([
          { project:          { operator: '=', values: [String(projectId)] } },
          { type:             { operator: '=', values: ['1', '7', '4'] } },
          { [principalFilter]:{ operator: '=', values: [String(userId)] } },
          { status:           { operator: '=', values: ['12', '14', '6'] } },
          { updatedAt:        { operator: '>=d', values: [sprintStartCutoff] } },
        ]))
        const res = await opGet(base, token, `/work_packages?filters=${filters}&pageSize=30&sortBy=${encodeURIComponent('[["updatedAt","desc"]]')}`)
        for (const wp of res._embedded?.elements ?? []) {
          if (closedTasks.has(wp.id)) {
            const existing = closedTasks.get(wp.id)!
            if (!existing.source.includes(source)) existing.source.push(source)
          } else {
            closedTasks.set(wp.id, parseWP(wp, identifier, projectId, source))
          }
        }
      } catch (e) { warn(`closed tasks (${principalFilter}) fetch failed for '${identifier}': ${e instanceof Error ? e.message : String(e)}`) }
    }

    // ── Sprints/versions ─────────────────────────────────────────────────
    try {
      const res = await opGet(base, token, `/projects/${identifier}/versions?pageSize=200`)
      // Lower bound was 14 days — OP already returns the FULL version list in
      // the one call above (no date filter in the OP query itself), so pruning
      // here only threw away metadata we'd already paid for. That pruning is
      // what made Sprint View's older tabs show a generic "S14" instead of the
      // real OP name, AND (worse) made the Sprint Plan tab silently fall back
      // to the CURRENT sprint's data for any old tab — sprint-plan/route.ts
      // needs a matching id in this list to serve historical data at all
      // (found 2026-08-18, reported as "S14 shows Sprint #121's data"). 400
      // days covers ISL's whole practical history while still bounding growth
      // if OP accumulates years of versions.
      const lookback       = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const sixMonthsAhead = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      for (const v of res._embedded?.elements ?? []) {
        if (!v.startDate || !v.endDate) continue
        if (v.endDate < lookback || v.startDate > sixMonthsAhead) continue
        const isCurrent = v.startDate <= today && v.endDate >= today
        sprints.push({
          id:                v.id,
          name:              v.name,
          startDate:         v.startDate,
          endDate:           v.endDate,
          status:            v.status,
          projectIdentifier: identifier,
          isCurrent,
        })
        // Use current sprint start as cutoff for closed tasks search
        if (isCurrent && v.startDate < sprintStartCutoff) {
          sprintStartCutoff = v.startDate
        }
      }
    } catch (e) { warn(`sprints/versions fetch failed for '${identifier}': ${e instanceof Error ? e.message : String(e)}`) }
  }

  // Every per-project fetch above is wrapped in its own try/catch (skip on
  // failure, so one flaky project doesn't kill the whole sync) — but that
  // means a totally invalid token (e.g. undecryptable after an
  // ISL_ENCRYPTION_KEY rotation — found 2026-08-05: Zaky & Ijal's saved
  // tokens fail AES-GCM auth with the current key, so opGet() 401s on every
  // single call) silently produces an EMPTY cache that still looks like a
  // successful sync. Without this guard, saveCache() below would overwrite a
  // real, merely-stale cache with a fake "zero tasks" one — read by
  // /api/team/board as "not busy" when the truth is "we never asked OP".
  // Refuse instead: 0/N projects reachable = hard failure, existing cache on
  // disk is left untouched.
  if (projectIdentifiers.length > 0 && watchedProjects.length === 0) {
    throw new Error(`OP unreachable for all ${projectIdentifiers.length} project(s) — token likely invalid/undecryptable; refusing to overwrite existing cache`)
  }

  const allOpen   = Array.from(openTasks.values())
  const allClosed = Array.from(closedTasks.values())

  // "Incoming" = open tasks where I'm the assignee but I did NOT create it
  const incomingTasks = allOpen.filter(t =>
    t.isOwn && t.createdById !== null && t.createdById !== userId
  )

  const cache: OPCache = {
    lastSync:        new Date().toISOString(),
    userId,
    userName:        userName ?? null,
    userStories,
    epics,
    myOpenTasks:     allOpen,
    myClosedTasks:   allClosed,
    incomingTasks,
    sprints,
    watchedProjects,
    fetchWarnings,
  }
  if (fetchWarnings.length > 0) {
    console.warn(`[op-cache] uid=${saveUserId ?? userId}: ${fetchWarnings.length} fetch(es) failed this sync — see warnings above. Numbers in this cache may be incomplete, not just stale.`)
  }
  saveCache(cache, saveUserId ?? userId)
  return cache
}
