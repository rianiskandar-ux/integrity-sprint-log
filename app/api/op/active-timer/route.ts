import { getOpToken, getOpBaseUrl } from '@/lib/user-config'
import { NextResponse } from 'next/server'

const OP_BASE = getOpBaseUrl()
const OP_TOKEN = getOpToken()

export async function GET() {
  if (!OP_BASE || !OP_TOKEN) return NextResponse.json({ active: null })
  const auth = 'Basic ' + Buffer.from(`apikey:${OP_TOKEN}`).toString('base64')

  try {
    const filters = encodeURIComponent(JSON.stringify([{ ongoing: { operator: '=', values: ['t'] } }]))
    const res  = await fetch(`${OP_BASE}/api/v3/time_entries?filters=${filters}&pageSize=1`, { headers: { Authorization: auth } })
    if (!res.ok) return NextResponse.json({ active: null })

    const data = await res.json()
    const entry = data._embedded?.elements?.[0]
    if (!entry?.ongoing) return NextResponse.json({ active: null })

    const wpHref  = entry._links?.workPackage?.href ?? ''
    const wpId    = wpHref ? parseInt(wpHref.split('/').pop()!) : null
    const wpTitle = entry._links?.workPackage?.title ?? null
    const since   = entry.createdAt ?? null

    return NextResponse.json({ active: { taskId: wpId, taskTitle: wpTitle, since, timeEntryId: entry.id } })
  } catch {
    return NextResponse.json({ active: null })
  }
}
