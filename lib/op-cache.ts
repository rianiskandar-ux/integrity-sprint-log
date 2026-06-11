import fs from 'fs'
import path from 'path'

const CACHE_DIR  = process.env.CACHE_DATA_DIR ?? process.cwd()
const CACHE_FILE = path.join(CACHE_DIR, 'op-cache.json')

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
}

export function loadCache(): OPCache {
  try {
    if (!fs.existsSync(CACHE_FILE)) return EMPTY
    return { ...EMPTY, ...JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) }
  } catch { return EMPTY }
}

export function saveCache(cache: OPCache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8')
}

// Update a single WP's status in the local cache (after OP PATCH)
export function updateCachedWPStatus(wpId: number, opStatusId: number) {
  const cache = loadCache()
  const mapped = OP_STATUS_MAP[opStatusId]
  const update = (wp: CachedWorkPackage) =>
    wp.id === wpId
      ? { ...wp, opStatusId, status: mapped?.label ?? wp.status, islStatus: mapped?.isl ?? wp.islStatus }
      : wp
  cache.myOpenTasks  = cache.myOpenTasks.map(update)
  cache.myClosedTasks = cache.myClosedTasks.map(update)
  cache.incomingTasks = cache.incomingTasks.map(update)
  saveCache(cache)
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
  }
}

export async function rebuildCache(
  token: string,
  base: string,
  projectIdentifiers: string[],
  userId: number,
  userName?: string,
): Promise<OPCache> {
  const today         = new Date().toISOString().slice(0, 10)
  // Use sprint start date for closed task lookback — falls back to 30 days if no sprint
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  // Will be updated after sprints are fetched — used for closed tasks cutoff
  let sprintStartCutoff = thirtyDaysAgo

  const userStories:   CachedUserStory[]   = []
  const epics:         CachedEpic[]        = []
  const openTasks:     Map<number, CachedWorkPackage> = new Map()
  const closedTasks:   Map<number, CachedWorkPackage> = new Map()
  const sprints:       CachedSprint[]      = []

  for (const identifier of projectIdentifiers) {
    let projectId: number
    try {
      const proj = await opGet(base, token, `/projects/${identifier}`)
      projectId = proj.id
    } catch { continue }

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
    } catch { /* skip */ }

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
    } catch { /* skip */ }

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
      } catch { /* skip */ }

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
      } catch { /* skip */ }
    }

    // ── Sprints/versions ─────────────────────────────────────────────────
    try {
      const res = await opGet(base, token, `/projects/${identifier}/versions?pageSize=200`)
      const twoWeeksAgo    = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const sixMonthsAhead = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      for (const v of res._embedded?.elements ?? []) {
        if (!v.startDate || !v.endDate) continue
        if (v.endDate < twoWeeksAgo || v.startDate > sixMonthsAhead) continue
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
    } catch { /* skip */ }
  }

  const allOpen   = Array.from(openTasks.values())
  const allClosed = Array.from(closedTasks.values())

  // "Incoming" = open tasks where I'm the assignee but I did NOT create it
  const incomingTasks = allOpen.filter(t =>
    t.isOwn && t.createdById !== null && t.createdById !== userId
  )

  const cache: OPCache = {
    lastSync:       new Date().toISOString(),
    userId,
    userName:       userName ?? null,
    userStories,
    epics,
    myOpenTasks:    allOpen,
    myClosedTasks:  allClosed,
    incomingTasks,
    sprints,
  }
  saveCache(cache)
  return cache
}
