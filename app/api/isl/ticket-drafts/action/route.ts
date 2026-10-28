import { NextResponse } from 'next/server'
import { and, eq, inArray } from 'drizzle-orm'
import { db, ticketDrafts } from '@/lib/db'
import { draftContext } from '@/lib/draft-auth'
import { recheck, sanitizeLogs, MIN_EST_MINS, type TimeLog } from '@/lib/ticket-drafts'

export const runtime = 'nodejs'

// Aksi dari "Saran" di wadah ② (Rian 19 Okt). Semua hanya mengubah DRAF di ISL — nol tulisan ke OP —
// lalu cek ulang supaya wadahnya benar. Judul hasil gabung/pecah = usulan; Rian yang merapikan.
//  { action: 'move',  ids, sprintId }        → pindah draf ke sprint lain (mis. Next Sprint)
//  { action: 'merge', ids }                  → gabung draf kecil (sprint sama) jadi 1 tiket
//  { action: 'split', id, nextSprintId }     → bagian yang sudah dikerjakan ditutup sekarang,
//                                              sisanya jadi draf baru di sprint berikutnya
export async function POST(req: Request) {
  const ctx = await draftContext(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({})) as { action?: string; ids?: string[]; id?: string; sprintId?: number | null; nextSprintId?: number | null }
  const mine = (ids: string[]) => db.select().from(ticketDrafts)
    .where(and(eq(ticketDrafts.userId, ctx.uid), eq(ticketDrafts.status, 'draft'), inArray(ticketDrafts.id, ids)))
  const all = () => db.select().from(ticketDrafts).where(and(eq(ticketDrafts.userId, ctx.uid), eq(ticketDrafts.status, 'draft')))

  if (b.action === 'move') {
    const rows = await mine(b.ids ?? [])
    if (!rows.length || b.sprintId === undefined) return NextResponse.json({ error: 'ids & sprintId wajib' }, { status: 400 })
    for (const r of rows) await db.update(ticketDrafts).set({ sprintId: b.sprintId, checkOk: false, updatedAt: new Date() }).where(eq(ticketDrafts.id, r.id))
    const fresh = await all()
    for (const r of fresh.filter(x => rows.some(y => y.id === x.id))) await recheck(ctx, r, fresh)
    return NextResponse.json({ ok: true, moved: rows.length })
  }

  if (b.action === 'merge') {
    const rows = await mine(b.ids ?? [])
    if (rows.length < 2) return NextResponse.json({ error: 'Minimal 2 draf untuk digabung' }, { status: 400 })
    if (new Set(rows.map(r => r.sprintId ?? null)).size > 1) return NextResponse.json({ error: 'Draf yang digabung harus di sprint yang sama' }, { status: 400 })
    const logs = sanitizeLogs(rows.flatMap(r => (r.timeLogs ?? []) as TimeLog[]))
    const allClosed = rows.every(r => r.targetStatus === 'closed')
    const id = `td-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const [row] = await db.insert(ticketDrafts).values({
      id, userId: ctx.uid, sprintId: rows[0].sprintId, parentId: rows.find(r => r.parentId)?.parentId ?? null, typeId: rows[0].typeId,
      subject: rows.map(r => r.subject.trim()).join(' + ').slice(0, 255),
      description: rows.map(r => `- ${r.subject.trim()}`).join('\n'),
      estimatedMins: Math.max(MIN_EST_MINS, rows.reduce((a, r) => a + (r.estimatedMins ?? 0), 0)),
      targetStatus: allClosed ? 'closed' : logs.length ? 'in_progress' : 'new',
      timeLogs: logs,
    }).returning()
    await db.update(ticketDrafts).set({ status: 'discarded', updatedAt: new Date() }).where(inArray(ticketDrafts.id, rows.map(r => r.id)))
    await recheck(ctx, row, await all())
    return NextResponse.json({ ok: true, draft: row })
  }

  if (b.action === 'split') {
    const [d] = await mine(b.id ? [b.id] : [])
    if (!d) return NextResponse.json({ error: 'Draf tidak ditemukan' }, { status: 404 })
    if (!b.nextSprintId) return NextResponse.json({ error: 'Sprint berikutnya belum diketahui' }, { status: 400 })
    const spent = ((d.timeLogs ?? []) as TimeLog[]).reduce((a, l) => a + l.mins, 0)
    if (!spent) return NextResponse.json({ error: 'Belum ada catatan waktu — tak ada bagian selesai untuk ditutup' }, { status: 400 })
    // bagian selesai: estimate dibulatkan ke 30 menit dari waktu nyata (min 1 jam); sisa = estimate awal − itu (min 1 jam)
    const doneEst = Math.max(MIN_EST_MINS, Math.ceil(spent / 30) * 30)
    const restEst = Math.max(MIN_EST_MINS, (d.estimatedMins ?? 0) - doneEst)
    await db.update(ticketDrafts).set({ targetStatus: 'closed', estimatedMins: doneEst, checkOk: false, updatedAt: new Date() }).where(eq(ticketDrafts.id, d.id))
    const id = `td-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    await db.insert(ticketDrafts).values({
      id, userId: ctx.uid, sprintId: b.nextSprintId, parentId: d.parentId, typeId: d.typeId,
      subject: `${d.subject.trim()} - remaining`.slice(0, 255), estimatedMins: restEst, targetStatus: 'new', timeLogs: [],
    })
    const fresh = await all()
    for (const r of fresh.filter(x => x.id === d.id || x.id === id)) await recheck(ctx, r, fresh)
    return NextResponse.json({ ok: true, closedPartEst: doneEst, remainingEst: restEst, newDraftId: id })
  }

  return NextResponse.json({ error: 'action tidak dikenal' }, { status: 400 })
}
