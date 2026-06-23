import { NextResponse } from 'next/server'
import { getAllSessions, saveSession } from '@/lib/session-store'
import { getRequestContext } from '@/lib/request-auth'

export const runtime = 'nodejs'

const CLOSED_STATUSES = new Set(['Closed', 'Rejected', 'Done', "Won't fix", 'Duplicate', 'Cancelled'])

async function fetchOPStatus(base: string, token: string, taskId: number): Promise<string | null> {
  try {
    const res = await fetch(`${base}/api/v3/work_packages/${taskId}`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`apikey:${token}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
    })
    if (!res.ok) return null
    const data = await res.json()
    return data._links?.status?.title ?? null
  } catch {
    return null
  }
}

export async function GET() {
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { opToken: token, opBaseUrl: base, uid } = ctx

  const sessions = await getAllSessions(uid)
  const candidates = sessions.filter(
    s => s.opTaskId && s.pushStatus === 'pushed' && s.taskStatus !== 'done' && s.taskStatus !== 'abandoned'
      && (process.env.ISL_MULTIUSER !== '1' || s.userId === uid || s.userId == null)
  )

  let checked = 0
  let synced  = 0

  for (const session of candidates) {
    const opStatus = await fetchOPStatus(base, token, session.opTaskId!)
    if (!opStatus) continue
    checked++

    if (CLOSED_STATUSES.has(opStatus)) {
      await saveSession({ ...session, taskStatus: 'done', updatedAt: new Date().toISOString() })
      synced++
    }
  }

  return NextResponse.json({ synced, checked, candidates: candidates.length })
}
