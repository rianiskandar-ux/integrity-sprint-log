import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { users, userSettings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'
import { rebuildCache } from '@/lib/op-cache'
import { getRequestContext } from '@/lib/request-auth'
import { getOpBaseUrl } from '@/lib/user-config'

export const runtime = 'nodejs'

const DEFAULT_PROJECTS = ['integritys-websites', 'know-your-vendor-kyv', 'scrum-project']

// POST /api/team/board/sync — refresh EVERY teammate's OP cache using their
// own stored token, not just whoever is currently logged in. This is what
// makes the board honest for someone who hasn't opened ISL in weeks: the
// "Sync now" button doesn't wait for them to log in, it pulls their data
// directly from OP using the token they already saved once during setup.
// Any logged-in teammate can trigger it — the board is shared, two-way.
export async function POST() {
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = await db
    .select({
      uid:      users.id,
      name:     users.name,
      opUserId: userSettings.opUserId,
      opName:   userSettings.opUserName,
      token:    userSettings.opApiToken,
      projects: userSettings.watchedProjects,
    })
    .from(users)
    .leftJoin(userSettings, eq(userSettings.userId, users.id))

  const opBaseUrl = getOpBaseUrl() || process.env.OP_BASE_URL || 'https://tokek.integrity-asia.com'

  const results = await Promise.allSettled(
    rows.map(async r => {
      const opToken = r.token ? decrypt(r.token) : ''
      if (!opToken || !r.opUserId) throw new Error('no OP token saved')
      const projects = (r.projects as string[] | null)?.length ? (r.projects as string[]) : DEFAULT_PROJECTS
      const cache = await rebuildCache(opToken, opBaseUrl, projects, r.opUserId, r.opName ?? r.name, r.uid)
      return { uid: r.uid, name: r.name, openCount: cache.myOpenTasks.length }
    }),
  )

  const summary = rows.map((r, i) => {
    const res = results[i]
    return res.status === 'fulfilled'
      ? { uid: r.uid, name: r.name, ok: true, openCount: res.value.openCount }
      : { uid: r.uid, name: r.name, ok: false, error: res.reason instanceof Error ? res.reason.message : String(res.reason) }
  })

  return NextResponse.json({ ok: true, synced: summary })
}
