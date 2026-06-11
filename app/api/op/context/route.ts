import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const DATA_DIR = process.env.CACHE_DATA_DIR ?? process.cwd()
const DRAFTS_FILE = path.join(DATA_DIR, 'context-drafts.json')
const LEGACY_FILE = path.join(DATA_DIR, 'context-draft.json')

export interface ContextDraft {
  id: string
  sessionId?: string     // Claude Code session_id — unique per chat session
  title: string
  bullets: string[]
  estimatedMins: number
  actualMins?: number    // actual session duration from transcript timestamps
  startedAt: string
  updatedAt: string
  source: string
  status: 'pending' | 'pushed' | 'discarded'
  taskStatus?: string    // ISL task status: in_progress | on_hold | done | abandoned
  suggestedTaskId?: number
  suggestedStoryId?: number
  opTaskId?: number      // OP task ID created by auto-push
  opStoryId?: number     // OP user story ID matched by auto-push
  autoPushed?: boolean      // true = pushed automatically by hook, no manual review needed
  isNewTask?: boolean       // true = new task was created in OP; false = activity added to existing
  needsValidation?: boolean  // true = no explicit !command, user should verify AI's status decision
  hasExplicitCmd?: boolean   // true = user typed a !command, status is confirmed
  aiStatus?: string          // status AI tentukan sebelum command override
  tokenUsage?: { inputTokens: number; outputTokens: number } | null
  relatedOldTaskId?: number | null  // related closed task dari sprint sebelumnya
  ticketBinding?: number | null     // !ticket:ID binding
}

function normalizeDraft(d: ContextDraft): ContextDraft {
  return { ...d, bullets: Array.isArray(d.bullets) ? d.bullets : (d.bullets ? [String(d.bullets)] : []) }
}

function loadDrafts(): ContextDraft[] {
  try {
    if (fs.existsSync(DRAFTS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DRAFTS_FILE, 'utf-8'))
      const arr: ContextDraft[] = Array.isArray(raw) ? raw : (raw.drafts ?? [])
      return arr.map(normalizeDraft)
    }
    // Migrate from legacy single-draft file
    if (fs.existsSync(LEGACY_FILE)) {
      const old = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf-8'))
      if (old && !old.pushed) {
        return [normalizeDraft({
          id: 'legacy-' + Date.now(),
          sessionId: undefined,
          title: old.title,
          bullets: old.bullets ?? [],
          estimatedMins: old.estimatedMins ?? 30,
          startedAt: old.startedAt ?? new Date().toISOString(),
          updatedAt: old.updatedAt ?? new Date().toISOString(),
          source: old.source ?? '',
          status: 'pending',
          suggestedTaskId: old.suggestedTaskId,
          suggestedStoryId: old.suggestedStoryId,
        })]
      }
    }
    return []
  } catch { return [] }
}

function saveDrafts(drafts: ContextDraft[]) {
  fs.writeFileSync(DRAFTS_FILE, JSON.stringify(drafts, null, 2), 'utf-8')
}

function pending(drafts: ContextDraft[]) {
  return drafts.filter(d => d.status === 'pending')
}

function cleanup(drafts: ContextDraft[]): ContextDraft[] {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  return drafts.filter(d => d.status === 'pending' || new Date(d.updatedAt).getTime() > cutoff)
}

// GET — return all pending drafts
export async function GET() {
  try {
    let drafts = loadDrafts()
    const cleaned = cleanup(drafts)
    if (cleaned.length !== drafts.length) { drafts = cleaned; saveDrafts(drafts) }
    const pendingDrafts = pending(drafts)
    return NextResponse.json({
      drafts: pendingDrafts,
      draft: pendingDrafts[0] ?? null,  // backward compat for DraftCard polling
      count: pendingDrafts.length,
    })
  } catch { return NextResponse.json({ drafts: [], draft: null, count: 0 }) }
}

// POST — create new draft or update existing draft by sessionId
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const drafts = cleanup(loadDrafts())
    const now = new Date().toISOString()

    // Normalize bullets from hook (may arrive as string in edge cases)
    if (body.bullets && !Array.isArray(body.bullets)) body.bullets = [String(body.bullets)]

    // Match by sessionId — same Claude session updates same draft
    const existingIdx = body.sessionId
      ? drafts.findIndex(d => d.sessionId === body.sessionId && d.status === 'pending')
      : -1

    if (existingIdx >= 0) {
      // Update existing draft from same session
      drafts[existingIdx] = {
        ...drafts[existingIdx],
        title: body.title ?? drafts[existingIdx].title,
        bullets: body.bullets ?? drafts[existingIdx].bullets,
        estimatedMins: body.estimatedMins ?? drafts[existingIdx].estimatedMins,
        actualMins: body.actualMins ?? drafts[existingIdx].actualMins,
        updatedAt: now,
        source: body.source ?? drafts[existingIdx].source,
        taskStatus: body.taskStatus ?? drafts[existingIdx].taskStatus,
        opTaskId: body.opTaskId ?? drafts[existingIdx].opTaskId,
        opStoryId: body.opStoryId ?? drafts[existingIdx].opStoryId,
        autoPushed: body.autoPushed ?? drafts[existingIdx].autoPushed,
        isNewTask: body.isNewTask ?? drafts[existingIdx].isNewTask,
        needsValidation: body.needsValidation ?? drafts[existingIdx].needsValidation,
        hasExplicitCmd: body.hasExplicitCmd ?? drafts[existingIdx].hasExplicitCmd,
        aiStatus: body.aiStatus ?? drafts[existingIdx].aiStatus,
        tokenUsage: body.tokenUsage ?? drafts[existingIdx].tokenUsage,
        relatedOldTaskId: 'relatedOldTaskId' in body ? body.relatedOldTaskId : drafts[existingIdx].relatedOldTaskId,
        ticketBinding: body.ticketBinding ?? drafts[existingIdx].ticketBinding,
      }
    } else {
      // New session = new draft entry
      const newDraft: ContextDraft = {
        id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        sessionId: body.sessionId,
        title: body.title ?? 'Work Session',
        bullets: body.bullets ?? [],
        estimatedMins: body.estimatedMins ?? 30,
        actualMins: body.actualMins,
        startedAt: now,
        updatedAt: now,
        source: body.source ?? '',
        status: 'pending',
        taskStatus: body.taskStatus,
        suggestedTaskId: body.suggestedTaskId,
        suggestedStoryId: body.suggestedStoryId,
        opTaskId: body.opTaskId,
        opStoryId: body.opStoryId,
        autoPushed: body.autoPushed,
        isNewTask: body.isNewTask,
        needsValidation: body.needsValidation,
        hasExplicitCmd: body.hasExplicitCmd,
        aiStatus: body.aiStatus,
        tokenUsage: body.tokenUsage,
        relatedOldTaskId: body.relatedOldTaskId,
        ticketBinding: body.ticketBinding,
      }

      // Cap at 15 pending drafts — discard oldest if over
      const currentPending = pending(drafts)
      if (currentPending.length >= 15) {
        const oldestIdx = drafts.findIndex(d => d.status === 'pending')
        if (oldestIdx >= 0) drafts[oldestIdx].status = 'discarded'
      }

      drafts.push(newDraft)
    }

    saveDrafts(drafts)
    const pendingDrafts = pending(drafts)
    return NextResponse.json({ ok: true, drafts: pendingDrafts, count: pendingDrafts.length })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// PATCH — update specific draft by id (for editing in DraftCard modal)
export async function PATCH(req: Request) {
  try {
    const body = await req.json()
    const { id, ...updates } = body
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const drafts = loadDrafts()
    const idx = drafts.findIndex(d => d.id === id)
    if (idx < 0) return NextResponse.json({ error: 'not found' }, { status: 404 })

    drafts[idx] = { ...drafts[idx], ...updates, updatedAt: new Date().toISOString() }
    saveDrafts(drafts)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// DELETE — discard specific draft (?id=xxx) or all pending (no params)
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    const drafts = loadDrafts()

    if (id) {
      const idx = drafts.findIndex(d => d.id === id)
      if (idx >= 0) drafts[idx].status = 'pushed'  // mark pushed so it won't show
    } else {
      // Legacy: mark all pending as pushed
      for (const d of drafts) { if (d.status === 'pending') d.status = 'pushed' }
    }

    saveDrafts(drafts)
    return NextResponse.json({ ok: true })
  } catch { return NextResponse.json({ ok: true }) }
}
