import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { users, userPresence } from '@/lib/db/schema'
import { getRequestContext } from '@/lib/request-auth'
import { loadCache, type CachedWorkPackage } from '@/lib/op-cache'

export const runtime = 'nodejs'

const PRESENCE_ONLINE_MS  = 90_000       // > 3 missed 30s pings = not "online" anymore
const PRESENCE_OFFLINE_MS = 15 * 60_000  // heartbeat exists but this old = tab is closed

export type PresenceStatus = 'online' | 'idle' | 'offline' | 'no-data'

// GET /api/team/board — one card per registered user. Two independent signals,
// deliberately not blended into one score:
//
//  1. Workload — from each person's own OP cache file (op-cache-<uid>.json).
//     True even for someone who hasn't opened ISL in weeks; it's read straight
//     from OP, not from anything the browser reports.
//  2. Presence — from the browser heartbeat (user_presence table). This one IS
//     allowed to say "no data": if nobody ever pinged for a user, we show
//     'no-data', never a guessed 'offline'/'idle' — see the 2026-08-05 design
//     rule: a wrong guess costs more trust than an honest "we don't know".
//
// `lastActivity` merges presence with the most recent OP task update on any
// of their own tasks, so "hasn't touched ISL" doesn't read as "hasn't worked" —
// an OP status change from any device still counts as real activity.
//
// Open to every logged-in teammate, not owner-only — the board is only
// trustworthy if it's two-way (everyone sees everyone, including themselves).
export async function GET() {
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows      = await db.select().from(users).orderBy(users.id)
  const presRows  = await db.select().from(userPresence)
  const presence  = new Map(presRows.map(p => [p.userId, p]))

  const soon = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10)
  const now  = Date.now()

  const board = rows.map(u => {
    const cache = loadCache(u.id)
    const open: CachedWorkPackage[] = (cache.myOpenTasks ?? []).filter(t => t.isOwn)
    const allOwn = [...open, ...(cache.myClosedTasks ?? []).filter(t => t.isOwn)]

    const wip     = open.filter(t => t.islStatus === 'in_progress')
    const dueSoon = open.filter(t => t.dueDate && t.dueDate <= soon)
    const stale   = open.filter(t =>
      t.islStatus === 'in_progress' &&
      t.updatedAt &&
      now - new Date(t.updatedAt).getTime() > 5 * 86400_000,
    )

    const p = presence.get(u.id)
    let presenceStatus: PresenceStatus = 'no-data'
    if (p) {
      const age = now - new Date(p.lastPingAt).getTime()
      presenceStatus = age > PRESENCE_OFFLINE_MS ? 'offline' : p.idle ? 'idle' : age <= PRESENCE_ONLINE_MS ? 'online' : 'idle'
    }

    const lastOpActivityAt = allOwn.reduce<string | null>((max, t) => {
      if (!t.updatedAt) return max
      return !max || t.updatedAt > max ? t.updatedAt : max
    }, null)
    const lastActivity = [p?.lastPingAt?.toISOString?.() ?? null, lastOpActivityAt]
      .filter((d): d is string => !!d)
      .sort()
      .pop() ?? null

    return {
      uid:            u.id,
      name:           u.name,
      avatar:         u.avatar ?? null,
      openCount:      open.length,
      wipCount:       wip.length,
      incomingCount:  (cache.incomingTasks ?? []).length,
      dueSoonCount:   dueSoon.length,
      staleCount:     stale.length,
      lastSync:       cache.lastSync,
      presenceStatus,
      lastActivity,
      topItems: open
        .slice()
        .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
        .slice(0, 5)
        .map(t => ({
          id: t.id, subject: t.subject, status: t.status, islStatus: t.islStatus,
          dueDate: t.dueDate, sprintName: t.sprintName, updatedAt: t.updatedAt,
        })),
    }
  })

  board.sort((a, b) => b.wipCount - a.wipCount)

  return NextResponse.json({ board, generatedAt: new Date().toISOString() })
}
