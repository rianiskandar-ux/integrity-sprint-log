import fs from 'fs'
import path from 'path'

const CACHE_DIR = process.env.CACHE_DATA_DIR ?? process.cwd()
const CACHE_FILE = path.join(CACHE_DIR, 'op-cache.json')

export interface CachedUserStory {
  id: number
  subject: string
  status: string
  project: string
  projectId: number
  href: string
}

export interface CachedWorkPackage {
  id: number
  subject: string
  status: string
  type: string
  project: string
  projectId: number
  userStoryId: number | null
  href: string
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

export interface OPCache {
  lastSync: string | null
  userStories: CachedUserStory[]
  myOpenTasks: CachedWorkPackage[]
  sprints: CachedSprint[]
}

const EMPTY: OPCache = { lastSync: null, userStories: [], myOpenTasks: [], sprints: [] }

export function loadCache(): OPCache {
  try {
    if (!fs.existsSync(CACHE_FILE)) return EMPTY
    return { ...EMPTY, ...JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) }
  } catch { return EMPTY }
}

export function saveCache(cache: OPCache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8')
}

async function opGet(base: string, token: string, path: string) {
  const res = await fetch(`${base}/api/v3${path}`, {
    headers: {
      Authorization: 'Basic ' + Buffer.from(`apikey:${token}`).toString('base64'),
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) throw new Error(`OP ${res.status} ${path}`)
  return res.json()
}

export async function rebuildCache(
  token: string,
  base: string,
  projectIdentifiers: string[],
  userId: number
): Promise<OPCache> {
  const today = new Date().toISOString().slice(0, 10)
  const userStories: CachedUserStory[] = []
  const myOpenTasks: CachedWorkPackage[] = []
  const sprints: CachedSprint[] = []

  for (const identifier of projectIdentifiers) {
    // Get project ID
    let projectId: number
    try {
      const proj = await opGet(base, token, `/projects/${identifier}`)
      projectId = proj.id
    } catch { continue }

    // User Stories (open, not closed/rejected)
    try {
      const filters = encodeURIComponent(JSON.stringify([
        { project: { operator: '=', values: [String(projectId)] } },
        { type: { operator: '=', values: ['6'] } },
        { status: { operator: '!', values: ['12', '14'] } },
      ]))
      const res = await opGet(base, token, `/work_packages?filters=${filters}&pageSize=30&sortBy=${encodeURIComponent('[["updatedAt","desc"]]')}`)
      for (const wp of res._embedded?.elements ?? []) {
        userStories.push({
          id: wp.id,
          subject: wp.subject,
          status: wp._links.status?.title ?? '',
          project: identifier,
          projectId,
          href: `/api/v3/work_packages/${wp.id}`,
        })
      }
    } catch { /* skip */ }

    // My open tasks assigned to me
    try {
      const filters = encodeURIComponent(JSON.stringify([
        { project: { operator: '=', values: [String(projectId)] } },
        { type: { operator: '=', values: ['1', '7', '4'] } },
        { assignee: { operator: '=', values: [String(userId)] } },
        { status: { operator: '!', values: ['12', '14'] } },
      ]))
      const res = await opGet(base, token, `/work_packages?filters=${filters}&pageSize=30&sortBy=${encodeURIComponent('[["updatedAt","desc"]]')}`)
      for (const wp of res._embedded?.elements ?? []) {
        const parentHref: string = wp._links?.parent?.href ?? ''
        const parentId = parentHref ? parseInt(parentHref.split('/').pop()!) : null
        myOpenTasks.push({
          id: wp.id,
          subject: wp.subject,
          status: wp._links.status?.title ?? '',
          type: wp._links.type?.title ?? 'Task',
          project: identifier,
          projectId,
          userStoryId: parentId,
          href: `/api/v3/work_packages/${wp.id}`,
        })
      }
    } catch { /* skip */ }

    // Sprints/versions
    try {
      const res = await opGet(base, token, `/projects/${identifier}/versions?pageSize=20&sortBy=${encodeURIComponent('[["id","desc"]]')}`)
      for (const v of (res._embedded?.elements ?? []).slice(0, 10)) {
        sprints.push({
          id: v.id,
          name: v.name,
          startDate: v.startDate,
          endDate: v.endDate,
          status: v.status,
          projectIdentifier: identifier,
          isCurrent: v.startDate <= today && v.endDate >= today,
        })
      }
    } catch { /* skip */ }
  }

  const cache: OPCache = {
    lastSync: new Date().toISOString(),
    userStories,
    myOpenTasks,
    sprints,
  }
  saveCache(cache)
  return cache
}
