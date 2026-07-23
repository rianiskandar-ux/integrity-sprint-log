import { NextResponse } from 'next/server'
import { suggestTaskTitle } from '@/lib/task-title'
import { getRequestContext } from '@/lib/request-auth'

export const runtime = 'nodejs'

// POST /api/suggest/title  { bullets: string[], current?: string }
// Click-to-suggest a concise descriptive task title from a session's bullets —
// backs the ✨ Suggest button in the Push Queue create-new form. Suggest-only,
// human decides (same pattern as Dira/Arka). Local LLM (qwen), best-effort:
// always returns a usable string (falls back to first bullet / current title).
export async function POST(req: Request) {
  const ctx = await getRequestContext()
  if (process.env.ISL_MULTIUSER === '1' && !ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await req.json().catch(() => ({})) as { bullets?: unknown; current?: unknown }
  const bullets = Array.isArray(body.bullets) ? body.bullets.map(String).filter(Boolean) : []
  const current = typeof body.current === 'string' ? body.current : ''
  if (!bullets.length) return NextResponse.json({ error: 'bullets required' }, { status: 400 })

  const title = await suggestTaskTitle(bullets, current)
  return NextResponse.json({ ok: true, title })
}
