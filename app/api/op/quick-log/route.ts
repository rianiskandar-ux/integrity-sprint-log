import { NextResponse } from 'next/server'
import { saveSession, createSessionId } from '@/lib/session-store'

const OP_BASE  = process.env.OP_BASE_URL ?? ''
const OP_TOKEN = process.env.OP_API_TOKEN ?? ''

function toISODuration(minutes: number): string {
  const h = Math.floor(minutes / 60), m = minutes % 60
  return h > 0 ? `PT${h}H${m > 0 ? m + 'M' : ''}` : `PT${m}M`
}

function opHeaders() {
  return {
    Authorization: 'Basic ' + Buffer.from(`apikey:${OP_TOKEN}`).toString('base64'),
    'Content-Type': 'application/json',
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      title: string
      durationMins: number
      opTaskId?: number | null
      date?: string
      note?: string
    }

    const { title, durationMins, opTaskId, note } = body
    const date = body.date ?? new Date().toISOString().slice(0, 10)

    if (!title?.trim()) return NextResponse.json({ error: 'title required' }, { status: 400 })
    if (!durationMins || durationMins <= 0) return NextResponse.json({ error: 'durationMins must be > 0' }, { status: 400 })

    const now = new Date().toISOString()
    const id  = createSessionId()

    // Save to ISL DB — pushed immediately (no queue, it's manual)
    const bullets = note?.trim() ? [note.trim()] : ['Manual quick log — no automated session']
    await saveSession({
      id,
      date,
      title: title.trim(),
      bullets,
      source:        'quicklog',
      startedAt:     `${date}T09:00:00.000Z`,
      endedAt:       now,
      actualMins:    durationMins,
      estimatedMins: durationMins,
      opTaskId:      opTaskId ?? null,
      pushStatus:    'pushed',
      autoPushed:    false,
      hasExplicitCmd: true,
      createdAt:     now,
      updatedAt:     now,
    })

    // Push time entry to OP if task linked and OP is configured
    if (opTaskId && OP_BASE && OP_TOKEN) {
      const headers = opHeaders()
      const h = Math.floor(durationMins / 60), m = durationMins % 60
      const durLabel = durationMins >= 60 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${durationMins}m`

      await fetch(`${OP_BASE}/api/v3/time_entries`, {
        method: 'POST', headers,
        body: JSON.stringify({
          hours:   toISODuration(durationMins),
          spentOn: date,
          comment: { format: 'markdown', raw: `**${title.trim()}**\n\n${note?.trim() ? note.trim() + '\n\n' : ''}⏱ ${durLabel} | ✍️ ISL Quick Log` },
          _links: { workPackage: { href: `/api/v3/work_packages/${opTaskId}` }, activity: { href: '/api/v3/time_entries/activities/1' } },
        }),
      }).catch(() => {})

      await fetch(`${OP_BASE}/api/v3/work_packages/${opTaskId}/activities`, {
        method: 'POST', headers,
        body: JSON.stringify({ comment: { format: 'markdown', raw: `**Quick Log — ${date}** | ${durLabel}\n\n${bullets.map(b => `- ${b}`).join('\n')}\n\n*Logged via ISL Quick Log*` } }),
      }).catch(() => {})
    }

    return NextResponse.json({ ok: true, id, opPushed: !!(opTaskId && OP_BASE && OP_TOKEN) })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
