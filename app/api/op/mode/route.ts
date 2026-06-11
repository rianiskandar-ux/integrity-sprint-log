import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const DATA_DIR  = process.env.CACHE_DATA_DIR ?? process.cwd()
const MODE_FILE = path.join(DATA_DIR, 'op-mode.json')

// TEST sandbox — fixed, always scrum-project
const TEST_CONFIG = {
  mode:    'test',
  project: 'scrum-project',
  epicId:  7255,
  stories: { isl: 7256, kyv: 7257, verif: 7258, phoenix: 7259, general: 7260 },
}

function readMode() {
  try { return JSON.parse(fs.readFileSync(MODE_FILE, 'utf-8')) }
  catch { return TEST_CONFIG }
}

export async function GET() {
  return NextResponse.json(readMode())
}

// PATCH — update only specific fields (e.g. autoSync, mode) without full reset
export async function PATCH(req: Request) {
  const body    = await req.json()
  const current = readMode()
  const updated = { ...current, ...body, updatedAt: new Date().toISOString() }
  fs.writeFileSync(MODE_FILE, JSON.stringify(updated, null, 2), 'utf-8')
  return NextResponse.json({ ok: true, ...updated })
}

// POST body for TEST:  { mode: 'test' }
// POST body for LIVE:  { mode: 'live', project: string, userId: number, epicId?: number, stories?: {...} }
// POST body for flags: { mode: 'live'|'test', autoSync: true } — partial update supported
export async function POST(req: Request) {
  const body    = await req.json()
  const current = readMode()
  const { mode } = body

  // If only updating autoSync or other flags without full reconfiguration
  if (mode === current.mode || (!body.project && mode === 'live')) {
    const updated = { ...current, ...body, updatedAt: new Date().toISOString() }
    fs.writeFileSync(MODE_FILE, JSON.stringify(updated, null, 2), 'utf-8')
    return NextResponse.json({ ok: true, ...updated })
  }

  if (mode !== 'test' && mode !== 'live') {
    return NextResponse.json({ error: 'mode must be test or live' }, { status: 400 })
  }

  let payload: Record<string, unknown>

  if (mode === 'test') {
    payload = { ...TEST_CONFIG, autoSync: body.autoSync ?? current.autoSync ?? false, updatedAt: new Date().toISOString() }
  } else {
    payload = {
      mode:      'live',
      project:   body.project  ?? current.project,
      userId:    body.userId   ?? current.userId ?? null,
      epicId:    body.epicId   ?? current.epicId ?? null,
      stories:   body.stories  ?? current.stories ?? null,
      autoSync:  body.autoSync ?? current.autoSync ?? false,
      updatedAt: new Date().toISOString(),
    }
  }

  fs.writeFileSync(MODE_FILE, JSON.stringify(payload, null, 2), 'utf-8')
  return NextResponse.json({ ok: true, ...payload })
}
