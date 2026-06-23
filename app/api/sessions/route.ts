import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { getSprintDir } from '@/lib/parser'
import { getRequestContext } from '@/lib/request-auth'
import { isOwnerUid } from '@/lib/auth'
import { getAllSessions, saveSession, updateSession, createSessionId, type SessionLog } from '@/lib/session-store'

// Build an ISO startedAt from a date + a "HH:MM" (or "HH.MM WIB") time label.
function startedAtFrom(date: string, time?: string): string {
  const m = (time ?? '').match(/(\d{1,2})[:.](\d{2})/)
  if (m) return `${date}T${m[1].padStart(2, '0')}:${m[2]}:00.000Z`
  return new Date().toISOString()
}

// ── Owner writes the shared markdown; team members are DB-backed (no pollution) ──

export async function POST(req: Request) {
  const { date, title, time, bullets } = await req.json()
  if (!date || !title) return NextResponse.json({ error: 'date and title required' }, { status: 400 })

  const ctx = await getRequestContext()
  if (!isOwnerUid(ctx?.uid)) {
    // Team member → persist to the per-user DB instead of the owner's markdown
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const dup = (await getAllSessions(ctx.uid)).find(s => s.date === date && s.title === title && s.pushStatus !== 'discarded')
    if (dup) return NextResponse.json({ error: 'Session with this title already exists' }, { status: 409 })
    const now = new Date().toISOString()
    await saveSession({
      id:            createSessionId(),
      userId:        ctx.uid,
      date,
      title,
      bullets:       (bullets as string[] ?? []).filter(Boolean),
      source:        'manual',
      startedAt:     startedAtFrom(date, time),
      estimatedMins: 30,
      pushStatus:    'hub',
      createdAt:     now,
      updatedAt:     now,
    } as SessionLog)
    return NextResponse.json({ ok: true })
  }

  const dir = getSprintDir()
  const filePath = path.join(dir, `${date}.md`)

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  // Create file if missing
  if (!fs.existsSync(filePath)) {
    const dayName = new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    })
    const stub = `# Daily Sprint - ${dayName}\n\n> Generated: (manual)\n\n## Dikerjakan Hari Ini\n\n_Tidak ada activity OpenProject hari ini._\n\n## Open Tasks (Next 3 Days)\n\n_Tidak ada open tasks._\n\n## Technical Notes\n\n_Tambahkan catatan teknis di sini._\n\n---\n_Auto-generated oleh Daily Sprint App_\n`
    fs.writeFileSync(filePath, stub, 'utf-8')
  }

  let content = fs.readFileSync(filePath, 'utf-8')

  // Avoid duplicate
  if (content.includes(`### ${title}`)) {
    return NextResponse.json({ error: 'Session with this title already exists' }, { status: 409 })
  }

  const timeStr = time || new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB'
  const bulletLines = (bullets as string[]).filter(Boolean).map((b: string) => `- ${b}`).join('\n')
  const entry = `\n### ${title} — ${timeStr}\n\n${bulletLines}\n`

  // Insert before the closing ---
  if (content.includes('\n---\n')) {
    content = content.replace('\n---\n', `${entry}\n---\n`)
  } else {
    content += entry
  }

  fs.writeFileSync(filePath, content, 'utf-8')
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const { date, title } = await req.json()
  if (!date || !title) return NextResponse.json({ error: 'date and title required' }, { status: 400 })

  const ctx = await getRequestContext()
  if (!isOwnerUid(ctx?.uid)) {
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const target = (await getAllSessions(ctx.uid)).find(s => s.date === date && s.title === title && s.pushStatus !== 'discarded')
    if (!target) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    await updateSession(target.id, { pushStatus: 'discarded', undoneAt: new Date().toISOString() })
    return NextResponse.json({ ok: true })
  }

  const filePath = path.join(getSprintDir(), `${date}.md`)
  if (!fs.existsSync(filePath)) return NextResponse.json({ error: 'File not found' }, { status: 404 })

  let content = fs.readFileSync(filePath, 'utf-8')
  // Remove session block: from "### Title" to next "###" or "---" (non-inclusive)
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const blockRe = new RegExp(`\n### ${escaped}[^\n]*\n[\\s\\S]*?(?=\n### |\n---\n|$)`, 'g')
  const newContent = content.replace(blockRe, '')
  if (newContent === content) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  fs.writeFileSync(filePath, newContent, 'utf-8')
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: Request) {
  const { date, oldTitle, newTitle, time, bullets } = await req.json()
  if (!date || !oldTitle) return NextResponse.json({ error: 'date and oldTitle required' }, { status: 400 })

  const ctx = await getRequestContext()
  if (!isOwnerUid(ctx?.uid)) {
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const target = (await getAllSessions(ctx.uid)).find(s => s.date === date && s.title === oldTitle && s.pushStatus !== 'discarded')
    if (!target) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    await updateSession(target.id, {
      title:     newTitle ?? oldTitle,
      bullets:   (bullets as string[] ?? []).filter(Boolean),
      startedAt: startedAtFrom(date, time),
      updatedAt: new Date().toISOString(),
    })
    return NextResponse.json({ ok: true })
  }

  const filePath = path.join(getSprintDir(), `${date}.md`)
  if (!fs.existsSync(filePath)) return NextResponse.json({ error: 'File not found' }, { status: 404 })

  let content = fs.readFileSync(filePath, 'utf-8')

  // Find the session block
  const escaped = oldTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const blockRe = new RegExp(`(\n### ${escaped}[^\n]*\n)[\\s\\S]*?(?=\n### |\n---\n|$)`)
  if (!blockRe.test(content)) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const finalTitle = newTitle ?? oldTitle
  const timeStr = time || new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB'
  const bulletLines = (bullets as string[] ?? []).filter(Boolean).map((b: string) => `- ${b}`).join('\n')
  const newBlock = `\n### ${finalTitle} — ${timeStr}\n\n${bulletLines}\n`

  content = content.replace(blockRe, newBlock)
  fs.writeFileSync(filePath, content, 'utf-8')
  return NextResponse.json({ ok: true })
}
