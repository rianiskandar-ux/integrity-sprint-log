import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { getRequestContext } from '@/lib/request-auth'

export const runtime = 'nodejs'

const DATA_DIR    = process.env.CACHE_DATA_DIR ?? process.cwd()
const DRAFTS_FILE = path.join(DATA_DIR, 'context-drafts.json')
const MODE_FILE   = path.join(DATA_DIR, 'op-mode.json')

function isTestMode(): boolean {
  try {
    const raw = JSON.parse(fs.readFileSync(MODE_FILE, 'utf-8'))
    return raw.mode !== 'live'
  } catch { return true }
}

async function moveToBacklog(base: string, token: string, wpId: number): Promise<{ ok: boolean; error?: string }> {
  const headers = { Authorization: 'Basic ' + Buffer.from(`apikey:${token}`).toString('base64'), 'Content-Type': 'application/json' }
  try {
    const wpRes = await fetch(`${base}/api/v3/work_packages/${wpId}`, { headers })
    if (!wpRes.ok) return { ok: false, error: `WP not found: ${wpRes.status}` }
    const wp = await wpRes.json()

    const patchRes = await fetch(`${base}/api/v3/work_packages/${wpId}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({
        lockVersion: wp.lockVersion,
        subject: wp.subject.startsWith('[REVIEW] ') ? wp.subject : `[REVIEW] ${wp.subject}`,
        _links: { status: { href: '/api/v3/statuses/1' }, version: { href: null } },
      }),
    })
    if (!patchRes.ok) return { ok: false, error: `Patch failed: ${patchRes.status}` }

    fetch(`${base}/api/v3/work_packages/${wpId}/activities`, {
      method: 'POST', headers,
      body: JSON.stringify({ comment: { format: 'markdown', raw: `⚠️ **[ISL Review]** Task ini ditandai untuk ditinjau ulang.\n\nAuto-generated oleh Claude Code. Harap rename/reassign atau pindahkan ke sprint yang relevan.` } }),
    }).catch(() => {})

    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

async function hardDelete(base: string, token: string, wpId: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${base}/api/v3/work_packages/${wpId}`, {
      method: 'DELETE',
      headers: { Authorization: 'Basic ' + Buffer.from(`apikey:${token}`).toString('base64') },
    })
    if (res.status === 204 || res.status === 404) return { ok: true }
    return { ok: false, error: `Delete failed: ${res.status}` }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function DELETE(req: Request) {
  if (!(await getRequestContext())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { searchParams } = new URL(req.url)
    const draftId = searchParams.get('draftId')
    const doHard  = searchParams.get('hard') === '1'

    if (!draftId) return NextResponse.json({ error: 'draftId required' }, { status: 400 })
    if (doHard && !isTestMode()) {
      return NextResponse.json({ error: 'Hard delete hanya diizinkan di mode TEST' }, { status: 403 })
    }

    const raw    = fs.existsSync(DRAFTS_FILE) ? JSON.parse(fs.readFileSync(DRAFTS_FILE, 'utf-8')) : []
    const drafts = Array.isArray(raw) ? raw : (raw.drafts ?? [])
    const idx    = drafts.findIndex((d: { id: string }) => d.id === draftId)
    if (idx < 0) return NextResponse.json({ error: 'draft not found' }, { status: 404 })

    const draft  = drafts[idx]
    const errors: string[] = []

    if (draft.opTaskId) {
      const ctx = await getRequestContext()
      if (ctx) {
        const result = doHard
          ? await hardDelete(ctx.opBaseUrl, ctx.opToken, draft.opTaskId)
          : await moveToBacklog(ctx.opBaseUrl, ctx.opToken, draft.opTaskId)
        if (!result.ok) errors.push(result.error ?? 'Unknown error')
      }
    }

    if (doHard) {
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

export async function PATCH(req: Request) {
  if (!(await getRequestContext())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

export async function GET() {
  if (!(await getRequestContext())) return NextResponse.json({ log: [], total: 0 })
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
