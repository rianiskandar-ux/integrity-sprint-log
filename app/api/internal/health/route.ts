import { NextResponse } from 'next/server'
import { loadCache } from '@/lib/op-cache'

export const runtime = 'nodejs'

const KAFI_KEY = process.env.KAFI_API_KEY || 'kafi-bridge-2026'
const STALE_HOURS = 26 // alert if OP cache older than this

export async function GET(req: Request) {
  const key = req.headers.get('x-kafi-key') ?? new URL(req.url).searchParams.get('key')
  if (key !== KAFI_KEY) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const ownerUid = Number(process.env.ISL_OWNER_UID ?? 1)
  const cache = loadCache(ownerUid)

  const lastSync = cache.lastSync ? new Date(cache.lastSync) : null
  const ageHours = lastSync ? (Date.now() - lastSync.getTime()) / 3600000 : null
  const isStale  = ageHours === null || ageHours > STALE_HOURS
  const sprintCount = (cache.sprints ?? []).length

  return NextResponse.json({
    ok: true,
    ts: new Date().toISOString(),
    op: {
      lastSync:    lastSync?.toISOString() ?? null,
      ageHours:    ageHours !== null ? Math.round(ageHours * 10) / 10 : null,
      sprintCount,
      taskCount:   (cache.myOpenTasks ?? []).length,
      isStale,
    },
  })
}
