import { NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/request-auth'
import { generateSprintSummary } from '@/lib/sprint-summary'

export const runtime = 'nodejs'
export const maxDuration = 180

// GET ?sprintId=<id> — omit for the current sprint (original button behavior).
// sprintId lets the Agenda tab regenerate a PAST sprint's recap too, which is
// also what the automated sprint-end job (app/api/internal/sprint-summary)
// needs — see lib/sprint-summary.ts for the shared logic.
export async function GET(req: Request) {
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sprintIdParam = new URL(req.url).searchParams.get('sprintId')
  const sprintId = sprintIdParam ? parseInt(sprintIdParam) : undefined

  const result = await generateSprintSummary({
    opToken: ctx.opToken, opBaseUrl: ctx.opBaseUrl, uid: ctx.uid, opUserId: ctx.opUserId, sprintId,
  })
  // Always 200 — this feeds a UI panel, not a hard API contract; an error
  // string in the body degrades gracefully, an HTTP error page would not.
  return NextResponse.json(result)
}
