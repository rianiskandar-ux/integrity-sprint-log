import { NextResponse } from 'next/server'
import { getAllSessions, saveSession } from '@/lib/session-store'
import { getOpToken, getOpBaseUrl } from '@/lib/user-config'

const CLOSED_STATUSES = new Set(['Closed', 'Rejected', 'Done', 'Won\'t fix', 'Duplicate', 'Cancelled'])

async function fetchOPStatus(base: string, token: string, taskId: number): Promise<string | null> {
  try {
    const url = `${base}/api/v3/work_packages/${taskId}`
    const res = await fetch(url, {
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

// GET /api/op/status-sync
export async function GET() {
  const token = getOpToken()
  const base  = getOpBaseUrl()

  if (!token || !base) {
    return NextResponse.json({ error: 'OP not configured' }, { status: 500 })
  }

  const sessions = getAllSessions()
  // Only sessions that were pushed to OP, have an opTaskId, and aren't already done
  const candidates = sessions.filter(
    s => s.opTaskId && s.pushStatus === 'pushed' && s.taskStatus !== 'done' && s.taskStatus !== 'abandoned'
  )

  let checked = 0
  let synced  = 0

  for (const session of candidates) {
    const opStatus = await fetchOPStatus(base, token, session.opTaskId!)
    if (!opStatus) continue
    checked++

    if (CLOSED_STATUSES.has(opStatus)) {
      const updated = {
        ...session,
        taskStatus: 'done' as const,
        updatedAt: new Date().toISOString(),
      }
      saveSession(updated)
      synced++
    }
  }

  return NextResponse.json({ synced, checked, candidates: candidates.length })
}
