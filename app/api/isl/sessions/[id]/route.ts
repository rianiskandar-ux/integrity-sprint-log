import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { eq } from 'drizzle-orm'
import { db, sessions as sessionsTable } from '@/lib/db'
import { getSession, updateSession } from '@/lib/session-store'
import { getOpToken } from '@/lib/user-config'

const MODE_FILE = path.join(process.env.CACHE_DATA_DIR ?? process.cwd(), 'op-mode.json')
const OP_BASE   = process.env.OP_BASE_URL ?? ''
const OP_TOKEN  = getOpToken()

function opHeaders() {
  return {
    Authorization: 'Basic ' + Buffer.from(`apikey:${OP_TOKEN}`).toString('base64'),
    'Content-Type': 'application/json',
  }
}
function isTestMode() {
  try { return JSON.parse(fs.readFileSync(MODE_FILE, 'utf-8')).mode !== 'live' } catch { return true }
}

// PATCH /api/isl/sessions/[id]
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    const updated = await updateSession(id, body)
    if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json({ ok: true, session: updated })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// DELETE /api/isl/sessions/[id]?hard=1
// Default: move OP task to backlog [REVIEW] + mark session discarded
// hard=1: hard delete OP task (TEST mode only) + remove session file
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { searchParams } = new URL(req.url)
    const doHard = searchParams.get('hard') === '1'

    if (doHard && !isTestMode()) {
      return NextResponse.json({ error: 'Hard delete only allowed in TEST mode' }, { status: 403 })
    }

    const session = await getSession(id)
    if (!session) return NextResponse.json({ error: 'not found' }, { status: 404 })

    const errors: string[] = []

    if (session.opTaskId && OP_BASE && OP_TOKEN) {
      if (doHard) {
        const res = await fetch(`${OP_BASE}/api/v3/work_packages/${session.opTaskId}`, {
          method: 'DELETE', headers: opHeaders(),
        })
        if (res.status !== 204 && res.status !== 404) errors.push(`Delete failed: ${res.status}`)
      } else {
        // Move to backlog [REVIEW]
        const wpRes = await fetch(`${OP_BASE}/api/v3/work_packages/${session.opTaskId}`, { headers: opHeaders() })
        if (wpRes.ok) {
          const wp = await wpRes.json()
          const patchRes = await fetch(`${OP_BASE}/api/v3/work_packages/${session.opTaskId}`, {
            method: 'PATCH', headers: opHeaders(),
            body: JSON.stringify({
              lockVersion: wp.lockVersion,
              subject: wp.subject.startsWith('[REVIEW] ') ? wp.subject : `[REVIEW] ${wp.subject}`,
              _links: { status: { href: '/api/v3/statuses/1' }, version: { href: null } },
            }),
          }).catch(() => null)
          if (!patchRes?.ok) errors.push(`OP task #${session.opTaskId} could not be moved to [REVIEW]`)
        } else {
          errors.push(`OP task #${session.opTaskId} not accessible`)
        }
      }
    }

    if (doHard) {
      await db.delete(sessionsTable).where(eq(sessionsTable.id, id))
    } else {
      await updateSession(id, { pushStatus: 'discarded', undoneAt: new Date().toISOString() })
    }

    return NextResponse.json({ ok: true, errors })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
