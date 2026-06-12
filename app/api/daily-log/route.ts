import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const SPRINT_DIR = process.env.SPRINT_OUTPUT_DIR
  ?? path.join(process.env.CACHE_DATA_DIR ?? process.cwd(), 'daily-sprints')

export interface DailyLogEntry {
  date: string        // YYYY-MM-DD
  label: string       // "Senin, 10 Jun 2026"
  generated: string   // time string from file
  sections: {
    worked: string[]   // "Dikerjakan Hari Ini" bullets
    tasks: string[]    // "Open Tasks" bullets
    notes: string[]    // "Technical Notes" blocks
  }
  raw: string
}

function parseMarkdown(raw: string, date: string): DailyLogEntry {
  const lines = raw.split('\n')

  // Extract generated time
  const genLine = lines.find(l => l.startsWith('> Generated:'))
  const generated = genLine ? genLine.replace('> Generated:', '').trim() : ''

  // Parse sections
  type SectionKey = 'worked' | 'tasks' | 'notes' | null
  let currentSection: SectionKey = null
  const sections = { worked: [] as string[], tasks: [] as string[], notes: [] as string[] }
  const noteBuffer: string[] = []

  for (const line of lines) {
    if (line.startsWith('## Dikerjakan')) { currentSection = 'worked'; continue }
    if (line.startsWith('## Open Tasks')) { currentSection = 'tasks'; continue }
    if (line.startsWith('## Technical')) { currentSection = 'notes'; continue }
    if (line.startsWith('## ') || line.startsWith('# ') || line.startsWith('---')) {
      if (currentSection === 'notes' && noteBuffer.length) {
        sections.notes.push(noteBuffer.join('\n').trim())
        noteBuffer.length = 0
      }
      if (line.startsWith('## ') && !line.includes('Dikerjakan') && !line.includes('Open') && !line.includes('Technical')) {
        currentSection = null
      }
      continue
    }

    if (currentSection === 'worked') {
      const t = line.trim()
      if (t && t !== '_Tidak ada activity hari ini._') sections.worked.push(t)
    } else if (currentSection === 'tasks') {
      const t = line.trim()
      if (t && t !== '_Tidak ada open tasks._') sections.tasks.push(t)
    } else if (currentSection === 'notes') {
      const t = line.trimEnd()
      if (t && t !== '_Tambahkan catatan teknis di sini._') noteBuffer.push(t)
    }
  }
  if (noteBuffer.length) sections.notes.push(noteBuffer.join('\n').trim())

  const d = new Date(date + 'T12:00:00')
  const label = d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })

  return { date, label, generated, sections, raw }
}

export async function GET(req: Request) {
  const url    = new URL(req.url)
  const date   = url.searchParams.get('date')   // specific date
  const limit  = parseInt(url.searchParams.get('limit') ?? '14')

  if (!fs.existsSync(SPRINT_DIR)) {
    return NextResponse.json({ entries: [], dir: SPRINT_DIR })
  }

  const files = fs.readdirSync(SPRINT_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort()
    .reverse()  // newest first

  if (date) {
    const file = path.join(SPRINT_DIR, `${date}.md`)
    if (!fs.existsSync(file)) return NextResponse.json({ entry: null })
    const raw = fs.readFileSync(file, 'utf-8')
    return NextResponse.json({ entry: parseMarkdown(raw, date) })
  }

  const entries = files.slice(0, limit).map(f => {
    const d   = f.replace('.md', '')
    const raw = fs.readFileSync(path.join(SPRINT_DIR, f), 'utf-8')
    return parseMarkdown(raw, d)
  })

  return NextResponse.json({ entries, total: files.length })
}
