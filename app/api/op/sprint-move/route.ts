import { getOpToken, getOpBaseUrl } from '@/lib/user-config'
import { NextResponse } from 'next/server'

const OP_BASE = getOpBaseUrl()
const OP_TOKEN = getOpToken()

export async function POST(req: Request) {
  if (!OP_BASE || !OP_TOKEN) return NextResponse.json({ error: 'OP not configured' }, { status: 500 })

  const { taskIds, targetSprintId, edits } = await req.json() as {
    taskIds: number[]
    targetSprintId: number
    edits?: Record<number, { subject?: string }>
  }

  if (!taskIds?.length || !targetSprintId) {
    return NextResponse.json({ error: 'taskIds and targetSprintId required' }, { status: 400 })
  }

  const auth    = 'Basic ' + Buffer.from(`apikey:${OP_TOKEN}`).toString('base64')
  const headers = { Authorization: auth, 'Content-Type': 'application/json' }

  const results: { id: number; ok: boolean; error?: string }[] = []

  for (const id of taskIds) {
    try {
      // Get current WP for lockVersion
      const wpRes = await fetch(`${OP_BASE}/api/v3/work_packages/${id}`, { headers })
      if (!wpRes.ok) { results.push({ id, ok: false, error: `WP ${id} not found` }); continue }
      const wp = await wpRes.json()

      const body: Record<string, unknown> = {
        lockVersion: wp.lockVersion,
        _links: { version: { href: `/api/v3/versions/${targetSprintId}` } },
      }
      // Optional subject edit
      const subjectEdit = edits?.[id]?.subject
      if (subjectEdit && subjectEdit.trim()) body.subject = subjectEdit.trim()

      const patchRes = await fetch(`${OP_BASE}/api/v3/work_packages/${id}`, {
        method: 'PATCH', headers, body: JSON.stringify(body),
      })

      if (!patchRes.ok) {
        const err = await patchRes.json().catch(() => ({}))
        results.push({ id, ok: false, error: (err as { message?: string }).message ?? `HTTP ${patchRes.status}` })
      } else {
        results.push({ id, ok: true })
      }
    } catch (e) {
      results.push({ id, ok: false, error: String(e) })
    }
  }

  return NextResponse.json({ results })
}
