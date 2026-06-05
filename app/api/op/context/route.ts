import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const DRAFT_FILE = path.join(process.env.CACHE_DATA_DIR ?? process.cwd(), 'context-draft.json')

export interface ContextDraft {
  title: string
  bullets: string[]
  estimatedMins: number
  startedAt: string   // ISO timestamp
  updatedAt: string
  source: string      // conversation summary / topic
  suggestedTaskId?: number
  suggestedStoryId?: number
  pushed: boolean
}

export async function GET() {
  try {
    if (!fs.existsSync(DRAFT_FILE)) return NextResponse.json({ draft: null })
    const draft: ContextDraft = JSON.parse(fs.readFileSync(DRAFT_FILE, 'utf-8'))
    if (draft.pushed) return NextResponse.json({ draft: null })
    return NextResponse.json({ draft })
  } catch { return NextResponse.json({ draft: null }) }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    let draft: ContextDraft | null = null

    // Load existing draft to preserve startedAt if same topic continues
    if (fs.existsSync(DRAFT_FILE)) {
      try { draft = JSON.parse(fs.readFileSync(DRAFT_FILE, 'utf-8')) } catch { draft = null }
    }

    const now = new Date().toISOString()
    const isSameTopic = draft && !draft.pushed &&
      body.title && draft.title &&
      (body.title.toLowerCase().includes(draft.title.toLowerCase().split(' ')[0]) ||
       draft.title.toLowerCase().includes((body.title ?? '').toLowerCase().split(' ')[0]))

    const updated: ContextDraft = {
      title: body.title ?? draft?.title ?? 'Untitled Session',
      bullets: body.bullets ?? draft?.bullets ?? [],
      estimatedMins: body.estimatedMins ?? draft?.estimatedMins ?? 30,
      startedAt: isSameTopic ? (draft?.startedAt ?? now) : now,
      updatedAt: now,
      source: body.source ?? '',
      suggestedTaskId: body.suggestedTaskId ?? draft?.suggestedTaskId,
      suggestedStoryId: body.suggestedStoryId ?? draft?.suggestedStoryId,
      pushed: false,
    }

    fs.writeFileSync(DRAFT_FILE, JSON.stringify(updated, null, 2), 'utf-8')
    return NextResponse.json({ ok: true, draft: updated })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    if (fs.existsSync(DRAFT_FILE)) {
      const draft: ContextDraft = JSON.parse(fs.readFileSync(DRAFT_FILE, 'utf-8'))
      fs.writeFileSync(DRAFT_FILE, JSON.stringify({ ...draft, pushed: true }, null, 2), 'utf-8')
    }
    return NextResponse.json({ ok: true })
  } catch { return NextResponse.json({ ok: true }) }
}
