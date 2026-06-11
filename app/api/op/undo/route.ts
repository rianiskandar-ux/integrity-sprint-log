import { getOpToken, getOpBaseUrl } from '@/lib/user-config'
import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const DATA_DIR    = process.env.CACHE_DATA_DIR ?? process.cwd()
const DRAFTS_FILE = path.join(DATA_DIR, 'context-drafts.json')
const MODE_FILE   = path.join(DATA_DIR, 'op-mode.json')
const OP_BASE = getOpBaseUrl()
const OP_TOKEN    = getOpToken()

function opHeaders() {
  return {
    Authorization: 'Basic ' + Buffer.from(`apikey:${OP_TOKEN}`).toString('base64'),
    'Content-Type': 'application/json',
  }
}

function isTestMode(): boolean {
  try {
    const raw = JSON.parse(fs.readFileSync(MODE_FILE, 'utf-8'))
    return raw.mode !== 'live'
  } catch { return true }
}

async function opPatch(wpPath: string, body: object) {
  return fetch(`${OP_BASE}${wpPath}`, {
    method: 'PATCH',
    headers: opHeaders(),
    body: JSON.stringify(body),
  })
}

async function opPost(wpPath: string, body: object) {
  return fetch(`${OP_BASE}${wpPath}`, {
    method: 'POST',
    headers: opHeaders(),
    body: JSON.stringify(body),
  })
}

// Move task to backlog (remove sprint) + add [REVIEW] comment
async function moveToBacklog(wpId: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const wpRes = await fetch(`${OP_BASE}/api/v3/work_packages/${wpId}`, { headers: opHeaders() })
    if (!wpRes.ok) return { ok: false, error: `WP not found: ${wpRes.status}` }
    const wp = await wpRes.json()

    const patchBody: Record<string, unknown> = {
      lockVersion: wp.lockVersion,
      subject: wp.subject.startsWith('[REVIEW] ') ? wp.subject : `[REVIEW] ${wp.subject}`,
      _links: {
        status:  { href: '/api/v3/statuses/1' },
        version: { href: null },
      },
    }
    const patchRes = await opPatch(`/api/v3/work_packages/${wpId}`, patchBody)
    if (!patchRes.ok) return { ok: false, error: `Patch failed: ${patchRes.status}` }

    await opPost(`/api/v3/work_packages/${wpId}/activities`, {
      comment: {
        format: 'markdown',
        raw: `⚠️ **[ISL Review]** Task ini ditandai untuk ditinjau ulang.\n\nAuto-generated oleh Claude Code. Harap rename/reassign atau pindahkan ke sprint yang relevan.`,
      },
    }).catch(() => {})

    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// Hard delete — only allowed in TEST mode
async function hardDelete(wpId: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${OP_BASE}/api/v3/work_packages/${wpId}`, {
      method: 'DELETE',
      headers: opHeaders(),
    })
    // 204 = deleted, 404 = already gone — both are fine
    if (res.status === 204 || res.status === 404) return { ok: true }
    return { ok: false, error: `Delete failed: ${res.status}` }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// DELETE /api/op/undo?draftId=xxx         → move to backlog [REVIEW]
// DELETE /api/op/undo?draftId=xxx&hard=1  → hard delete (TEST mode only)
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const draftId  = searchParams.get('draftId')
    const doHard   = searchParams.get('hard') === '1'

    if (!draftId) return NextResponse.json({ error: 'draftId required' }, { status: 400 })

    // Hard delete only allowed in TEST mode
    if (doHard && !isTestMode()) {
      return NextResponse.json({ error: 'Hard delete hanya diizinkan di mode TEST' }, { status: 403 })
    }

    const raw    = fs.existsSync(DRAFTS_FILE) ? JSON.parse(fs.readFileSync(DRAFTS_FILE, 'utf-8')) : []
    const drafts = Array.isArray(raw) ? raw : (raw.drafts ?? [])
    const idx    = drafts.findIndex((d: { id: string }) => d.id === draftId)
    if (idx < 0) return NextResponse.json({ error: 'draft not found' }, { status: 404 })

    const draft  = drafts[idx]
    const errors: string[] = []

    if (draft.opTaskId && OP_BASE && OP_TOKEN) {
      if (doHard) {
        const result = await hardDelete(draft.opTaskId)
        if (!result.ok) errors.push(result.error ?? 'Delete failed')
      } else {
        const result = await moveToBacklog(draft.opTaskId)
        if (!result.ok) errors.push(result.error ?? 'Unknown error')
      }
    }

    if (doHard) {
      // Remove from log entirely
      drafts.splice(idx, 1)
    } else {
      drafts[idx] = { ...draft, status: 'discarded', undoneAt: new Date().toISOString() }
    }
    fs.writeFileSync(DRAFTS_FILE, JSON.stringify(drafts, null, 2), 'utf-8')

    return NextResponse.json({
      ok: true, errors,
      note: doHard ? 'Task deleted from OP and removed from log' : 'Task moved to backlog for review',
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// PATCH /api/op/undo — update taskStatus field
// Body: { draftId: string, taskStatus: 'in-progress' | 'on-hold' | 'done' | 'abandoned' }
export async function PATCH(req: Request) {
  try {
    const { draftId, taskStatus } = await req.json()
    if (!draftId || !taskStatus) return NextResponse.json({ error: 'draftId and taskStatus required' }, { status: 400 })
    const valid = ['in-progress', 'on-hold', 'done', 'abandoned']
    if (!valid.includes(taskStatus)) return NextResponse.json({ error: 'invalid taskStatus' }, { status: 400 })

    const raw    = fs.existsSync(DRAFTS_FILE) ? JSON.parse(fs.readFileSync(DRAFTS_FILE, 'utf-8')) : []
    const drafts = Array.isArray(raw) ? raw : (raw.drafts ?? [])
    const idx    = drafts.findIndex((d: { id: string }) => d.id === draftId)
    if (idx < 0) return NextResponse.json({ error: 'draft not found' }, { status: 404 })

    drafts[idx] = { ...drafts[idx], taskStatus, updatedAt: new Date().toISOString() }
    fs.writeFileSync(DRAFTS_FILE, JSON.stringify(drafts, null, 2), 'utf-8')
    return NextResponse.json({ ok: true, taskStatus })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// GET /api/op/undo
export async function GET() {
  try {
    const raw    = fs.existsSync(DRAFTS_FILE) ? JSON.parse(fs.readFileSync(DRAFTS_FILE, 'utf-8')) : []
    const drafts = Array.isArray(raw) ? raw : (raw.drafts ?? [])
    const log    = drafts
      .filter((d: { autoPushed?: boolean }) => d.autoPushed)
      .sort((a: { startedAt: string }, b: { startedAt: string }) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      )
    return NextResponse.json({ log, total: log.length })
  } catch {
    return NextResponse.json({ log: [], total: 0 })
  }
}
