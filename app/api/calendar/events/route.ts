import { NextResponse } from 'next/server'
import { getValidToken, loadToken } from '@/lib/google-auth'

export interface CalendarEvent {
  id: string
  summary: string
  start: string
  end: string
  description?: string
  calendarName?: string
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const days = parseInt(searchParams.get('days') ?? '30')

  const token = await getValidToken()
  if (!token) {
    return NextResponse.json({ connected: false, events: [] })
  }

  const now = new Date()
  const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)

  try {
    // Get all calendars first
    const calRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const calData = await calRes.json()
    const calendars: Array<{ id: string; summary: string }> = calData.items ?? []

    // Fetch events from all calendars, filter Sprint Review
    const allEvents: CalendarEvent[] = []

    await Promise.all(calendars.map(async (cal) => {
      const params = new URLSearchParams({
        timeMin:      now.toISOString(),
        timeMax:      future.toISOString(),
        singleEvents: 'true',
        orderBy:      'startTime',
        maxResults:   '50',
        q:            'Sprint Review',
      })
      const evRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const evData = await evRes.json()
      for (const ev of evData.items ?? []) {
        if (!ev.summary?.toLowerCase().includes('sprint')) continue
        allEvents.push({
          id:           ev.id,
          summary:      ev.summary,
          start:        ev.start?.dateTime ?? ev.start?.date,
          end:          ev.end?.dateTime ?? ev.end?.date,
          description:  ev.description,
          calendarName: cal.summary,
        })
      }
    }))

    // Sort by start
    allEvents.sort((a, b) => a.start.localeCompare(b.start))

    return NextResponse.json({ connected: true, events: allEvents })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Calendar error'
    return NextResponse.json({ connected: false, error: msg, events: [] })
  }
}

export async function DELETE() {
  // Disconnect — delete token file
  const { loadToken } = await import('@/lib/google-auth')
  const fs = await import('fs')
  const path = await import('path')
  const tokenFile = path.join(process.env.AUTH_DATA_DIR ?? process.cwd(), 'google-token.json')
  if (fs.existsSync(tokenFile)) fs.unlinkSync(tokenFile)
  return NextResponse.json({ ok: true })
}
