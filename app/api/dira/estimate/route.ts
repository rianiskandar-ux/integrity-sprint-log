import { NextResponse } from 'next/server'
import { callLLM, getLLMConfig } from '@/lib/llm'
import { estimateTask } from '@/lib/dira-estimate'
import { getRequestContext, type RequestContext } from '@/lib/request-auth'
import { isOwnerUid } from '@/lib/auth'
import { db, userSettings } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'

export const runtime = 'nodejs'

// ── Dira, pilot #1 of the agent-taxonomy roadmap (2026-07-15 discussion) ─────
// Dira's existing job (timer tracking, auto-push on stop) is pure automation —
// zero judgment. This is Dira's first REAL agentic capability: read a ticket's
// title/description and suggest a time estimate, instead of the hardcoded
// 60-minute default used everywhere a task gets logged with no estimate
// (see components/IncomingTasksPanel.tsx's onAddToQueue). Deliberately narrow
// scope per the roadmap: one ticket in, one number + one-line reasoning out.
// Never auto-applies — the human reads the suggestion and decides, same
// human-in-the-loop pattern as Arka's task-matching.
//
// Core judgment logic lives in lib/dira-estimate.ts so Luna's session-
// structuring pipeline (/api/luna/structure) can call the SAME capability
// instead of duplicating it under a different name.

/** Same shape/logic as the other routes' getPersonalLLM (duplicated per-route
 *  in this codebase rather than shared — matching existing convention). */
async function getPersonalLLM(ctx: RequestContext | null): Promise<{ provider: string; apiKey: string; model: string | null; baseUrl: string | null } | null> {
  if (!ctx) return null
  const row = (await db.select().from(userSettings).where(eq(userSettings.userId, ctx.uid)).limit(1))[0]
  if (!row?.personalLlmProvider || row.personalLlmProvider === 'claude-cli') return null
  if (row.personalLlmProvider === 'ollama') {
    if (!row.personalLlmBaseUrl) return null
    return { provider: 'ollama', apiKey: '', model: row.personalLlmModel, baseUrl: row.personalLlmBaseUrl }
  }
  const apiKey = row.personalLlmApiKey ? decrypt(row.personalLlmApiKey) : ''
  if (!apiKey) return null
  if (row.personalLlmProvider === 'custom') {
    if (!row.personalLlmBaseUrl) return null
    return { provider: 'custom', apiKey, model: row.personalLlmModel, baseUrl: row.personalLlmBaseUrl }
  }
  return { provider: row.personalLlmProvider, apiKey, model: row.personalLlmModel, baseUrl: null }
}

export async function POST(req: Request) {
  const ctx = await getRequestContext()
  if (process.env.ISL_MULTIUSER === '1' && !ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({})) as { title?: string; description?: string; bullets?: string[] }
  const title = (body.title ?? '').trim()
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 })
  const description = (body.description ?? '').trim()
  const bullets = Array.isArray(body.bullets) ? body.bullets.filter(Boolean) : []

  // 2) Fallback: caller's own personal provider (non-owner) or owner's global
  //    engine config (owner) — same isolation pattern as chat/extract's fix.
  const owner = process.env.ISL_MULTIUSER === '1' ? isOwnerUid(ctx?.uid) : true
  const personal = owner ? null : await getPersonalLLM(ctx)

  if (!owner && !personal) {
    return NextResponse.json({ error: 'AI not configured — set provider + API key sendiri di Settings.' }, { status: 400 })
  }

  const fallbackCfg = owner
    ? getLLMConfig()
    : { provider: personal!.provider as Parameters<typeof callLLM>[1]['provider'], apiKey: personal!.apiKey, model: personal!.model ?? undefined, baseUrl: personal!.baseUrl ?? undefined }

  if (owner && !fallbackCfg) {
    return NextResponse.json({ error: 'AI not configured. Go to Settings and add an API key.' }, { status: 400 })
  }

  try {
    const parsed = await estimateTask(title, description, bullets, fallbackCfg ?? null)
    if (!parsed) return NextResponse.json({ error: 'AI tidak memberikan estimasi yang valid, coba lagi.' }, { status: 502 })
    const { usedLocal, ...rest } = parsed
    return NextResponse.json({ ...rest, source: usedLocal ? 'ollama' : (owner ? 'owner-engine' : personal!.provider) })
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 300) }, { status: 500 })
  }
}
