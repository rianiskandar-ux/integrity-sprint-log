import { NextResponse } from 'next/server'
import { db, users, userSettings } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { encrypt } from '@/lib/crypto'
import { makeUserToken, USER_COOKIE, USER_TTL_MS } from '@/lib/auth'
import { getOpBaseUrl } from '@/lib/user-config'
import { loadCache, rebuildCache } from '@/lib/op-cache'

export const runtime = 'nodejs'

// POST { opToken } — login multi-user pakai OP API token sendiri.
// Verify ke OP /users/me → upsert users + userSettings (token terenkripsi) → set session cookie.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { opToken?: string }
  const opToken = (body.opToken ?? '').trim()
  if (!opToken) return NextResponse.json({ ok: false, error: 'OP token wajib' }, { status: 400 })

  const base = (getOpBaseUrl() || '').replace(/\/$/, '')
  if (!base) return NextResponse.json({ ok: false, error: 'OP base URL belum dikonfigurasi' }, { status: 400 })

  // 1) Verify token ke OP — distinguish a network/DNS failure from an invalid token,
  // and retry once on transient connection errors (Docker DNS can flake).
  const auth = 'Basic ' + Buffer.from(`apikey:${opToken}`).toString('base64')
  let meRes: Response | null = null
  for (let attempt = 0; attempt < 2 && !meRes; attempt++) {
    meRes = await fetch(`${base}/api/v3/users/me`, {
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(12000),
    }).catch(() => null)
    if (!meRes && attempt === 0) await new Promise(r => setTimeout(r, 800))
  }
  if (!meRes) {
    return NextResponse.json({
      ok: false,
      error: `Tidak bisa terhubung ke OpenProject (${base}). Pastikan kamu terhubung ke jaringan/VPN kantor, lalu coba lagi.`,
    }, { status: 503 })
  }
  if (!meRes.ok) {
    return NextResponse.json({
      ok: false,
      error: `OP token tidak valid (OP ${meRes.status}). Cek/buat ulang token: OpenProject → My Account → Access Tokens → API.`,
    }, { status: 401 })
  }
  const me = await meRes.json() as { id: number; name?: string; email?: string; login?: string }
  const opUserId = me.id
  const name = me.name ?? me.login ?? `User ${opUserId}`
  const email = me.email ?? `op-${opUserId}@local`

  // 2) Upsert users (by opUserId)
  let userRow = (await db.select().from(users).where(eq(users.opUserId, opUserId)).limit(1))[0]
  if (!userRow) {
    // email unik — pakai email OP, fallback ke op-<id>@local
    const existingByEmail = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0]
    if (existingByEmail) {
      userRow = (await db.update(users).set({ opUserId, name }).where(eq(users.id, existingByEmail.id)).returning())[0]
    } else {
      userRow = (await db.insert(users).values({ email, name, opUserId, role: 'member' }).returning())[0]
    }
  }

  // 2.5) Auto-derive the user's OWN watched projects from their OP memberships,
  // so a teammate lands in a populated, usable app without visiting Settings.
  // Previously first-login always used the OWNER's hardcoded project list, so a
  // teammate working on other projects saw an empty Incoming/task list.
  let derivedProjects: string[] = []
  try {
    const filters = encodeURIComponent(JSON.stringify([{ member: { operator: '=', values: [String(opUserId)] } }]))
    const projRes = await fetch(`${base}/api/v3/projects?filters=${filters}&pageSize=50`, {
      headers: { Authorization: auth }, signal: AbortSignal.timeout(10000),
    }).catch(() => null)
    if (projRes?.ok) {
      const data = await projRes.json() as { _embedded?: { elements?: { identifier?: string }[] } }
      derivedProjects = (data._embedded?.elements ?? []).map(p => p.identifier).filter((x): x is string => !!x)
    }
  } catch { /* fall back below */ }

  // 3) Upsert userSettings (simpan token terenkripsi). Only overwrite
  // watchedProjects on FIRST setup (empty) — never clobber a returning user's
  // manual project choices.
  const encToken = encrypt(opToken)
  const existingSettings = (await db.select().from(userSettings).where(eq(userSettings.userId, userRow.id)).limit(1))[0]
  const existingWatched = (existingSettings?.watchedProjects as string[] | null) ?? []
  const watchedToSet = existingWatched.length ? existingWatched : derivedProjects
  if (existingSettings) {
    await db.update(userSettings).set({ opApiToken: encToken, opUserId, opUserName: name, setupDone: true, watchedProjects: watchedToSet, updatedAt: new Date() }).where(eq(userSettings.userId, userRow.id))
  } else {
    await db.insert(userSettings).values({ userId: userRow.id, opApiToken: encToken, opUserId, opUserName: name, setupDone: true, watchedProjects: watchedToSet })
  }

  // 4) Set session cookie
  const token = await makeUserToken({ uid: userRow.id, name, opUserId })
  const res = NextResponse.json({ ok: true, user: { id: userRow.id, name, opUserId } })
  res.cookies.set(USER_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: false, path: '/',
    maxAge: Math.floor(USER_TTL_MS / 1000),
  })

  // 5) Auto-rebuild cache in background on first login (non-blocking), using
  // the user's OWN projects (their memberships). Fall back to the common shared
  // projects only if OP returned no memberships, so the app is never empty.
  const existingCache = loadCache(userRow.id)
  if (!existingCache.lastSync) {
    const projectsForCache = watchedToSet.length ? watchedToSet : ['integritys-websites', 'know-your-vendor-kyv', 'scrum-project']
    setImmediate(() => {
      rebuildCache(opToken, base, projectsForCache, opUserId, name, userRow.id).catch(() => {/* silent */})
    })
  }

  return res
}
