import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { getSession, updateSession, SESSION_LOGS_DIR } from '@/lib/session-store'
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
    const updated = updateSession(id, body)
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

    const session = getSession(id)
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
          await fetch(`${OP_BASE}/api/v3/work_packages/${session.opTaskId}`, {
            method: 'PATCH', headers: opHeaders(),
            body: JSON.stringify({
              lockVersion: wp.lockVersion,
              subject: wp.subject.startsWith('[REVIEW] ') ? wp.subject : `[REVIEW] ${wp.subject}`,
              _links: { status: { href: '/api/v3/statuses/1' }, version: { href: null } },
            }),
          }).catch(() => {})
        }
      }
    }

    if (doHard) {
      // Remove the session file entirely
      const files = fs.readdirSync(SESSION_LOGS_DIR).filter(f => f.endsWith('.json'))
      for (const f of files) {
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(SESSION_LOGS_DIR, f), 'utf-8'))
          if (raw.id === id) { fs.unlinkSync(path.join(SESSION_LOGS_DIR, f)); break }
        } catch {}
      }
    } else {
      updateSession(id, { pushStatus: 'discarded', undoneAt: new Date().toISOString() })
    }

    return NextResponse.json({ ok: true, errors })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
