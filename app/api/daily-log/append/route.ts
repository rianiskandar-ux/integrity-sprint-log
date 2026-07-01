import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { getRequestContext } from '@/lib/request-auth'
import { isOwnerUid } from '@/lib/auth'
import { db } from '@/lib/db'
import { dailyLogs } from '@/lib/db/schema'
import { randomUUID } from 'crypto'

const SPRINT_DIR = process.env.SPRINT_OUTPUT_DIR
  ?? path.join(process.env.CACHE_DATA_DIR ?? process.cwd(), 'daily-sprints')

function timeWIB(): string {
  const d = new Date()
  const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000)
  const hh = String(wib.getUTCHours()).padStart(2, '0')
  const mm = String(wib.getUTCMinutes()).padStart(2, '0')
  return `${hh}.${mm} WIB`
}

function ensureFile(filePath: string, date: string): void {
  if (fs.existsSync(filePath)) return
  const d = new Date(date + 'T12:00:00')
  const label = d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const template = [
    `# Daily Sprint - ${label}`,
    '',
    `> Generated: ${timeWIB()}`,
    '',
    '## Dikerjakan Hari Ini',
    '',
    '_Tidak ada activity hari ini._',
    '',
    '',
    '## Open Tasks (Next 3 Days)',
    '',
    '_Tidak ada open tasks._',
    '',
    '',
    '## Technical Notes',
    '',
    '_Tambahkan catatan teknis di sini._',
    '',
    '---',
    '_Auto-generated oleh Daily Sprint App_',
  ].join('\n')
  fs.mkdirSync(SPRINT_DIR, { recursive: true })
  fs.writeFileSync(filePath, template, 'utf-8')
}

// POST /api/daily-log/append
// Body: { title, bullets, date?, time?, sessionId? }
export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      title: string
      bullets?: string[]
      date?: string
      time?: string       // override timestamp, e.g. "11.29 WIB"
      sessionId?: string
    }

    const { title, bullets = [], date, time } = body
    if (!title?.trim()) return NextResponse.json({ error: 'title required' }, { status: 400 })

    const ctx = await getRequestContext()
    const today = date ?? new Date().toISOString().slice(0, 10)

    // Always write to Postgres (all users)
    const cleanBulletsForDB = (bullets ?? []).filter(b => b.trim())
      .map(b => b.replace(/^\[\d+m\]\s*/, '').trim())
    await db.insert(dailyLogs).values({
      id:        `${today}-${randomUUID().slice(0, 8)}`,
      userId:    ctx?.uid ?? null,
      date:      today,
      title:     title.trim(),
      bullets:   cleanBulletsForDB,
      sessionId: body.sessionId ?? null,
    }).catch(() => {}) // non-fatal — file write is the fallback

    // Only the owner writes the shared markdown file (backward compat for Daily Log view)
    if (!isOwnerUid(ctx?.uid)) {
      return NextResponse.json({ ok: true, db: true, skipped: 'non-owner (DB-backed)' })
    }
    const timestamp = time ?? timeWIB()
    const filePath = path.join(SPRINT_DIR, `${today}.md`)

    ensureFile(filePath, today)

    let content = fs.readFileSync(filePath, 'utf-8')

    // Build the note block
    const noteLines = [`### ${title.trim()} — ${timestamp}`]
    const cleanBullets = bullets.filter(b => b.trim())
    if (cleanBullets.length > 0) {
      for (const b of cleanBullets) {
        // Strip time prefix [Xm] from activity timeline bullets if present
        const clean = b.replace(/^\[\d+m\]\s*/, '').trim()
        if (clean) noteLines.push(`- ${clean}`)
      }
    }
    // Embed sessionId as hidden comment so Daily Log can link back to Push Queue
    if (body.sessionId) noteLines.push(`<!-- isl:${body.sessionId} -->`)
    const block = noteLines.join('\n')

    // Insert BEFORE the final separator ---
    const sepIdx = content.lastIndexOf('\n---')
    if (sepIdx !== -1) {
      content = content.slice(0, sepIdx) + '\n\n' + block + content.slice(sepIdx)
    } else {
      // No separator — just append at end
      content = content.trimEnd() + '\n\n' + block + '\n'
    }

    fs.writeFileSync(filePath, content, 'utf-8')

    return NextResponse.json({ ok: true, date: today, file: filePath })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
