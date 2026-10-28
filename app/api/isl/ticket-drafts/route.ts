import { NextResponse } from 'next/server'
import { and, eq, isNull, desc } from 'drizzle-orm'
import { db, ticketDrafts } from '@/lib/db'
import { draftContext } from '@/lib/draft-auth'
import { localIssues, recheck, snapshotOf, sprintTasksInOp, sprintTotalMins, sanitizeLogs, sanitizeStatus, sanitizeActivity, MIN_EST_MINS, SPRINT_CAP_MINS, type Issue } from '@/lib/ticket-drafts'

export const runtime = 'nodejs'

// Draf tiket milik kita (tab Sprint). Lihat lib/ticket-drafts.ts untuk alasan & aturan.
// GET ?sprintId=  → draf + wadah (progress = ① / close = ②) + catatan + total estimasi sprint
// POST            → draf baru (estimate kosong = 1 jam) lalu cek penuh → wadah ditentukan otomatis
// PATCH           → ubah draf (hanya 'draft') lalu cek ulang → bisa naik ke ② atau turun ke ①
// DELETE ?id=     → buang draf (status 'discarded', tak dihapus fisik)
// Auth: sesi browser ATAU x-kafi-key (Claude menyusun draf) — lihat lib/draft-auth.ts.
// Lewat kunci mesin, tanggal asli catatan waktu dicap (origDate) → badge "Tanggal diubah" kalau diubah.

const myDrafts = (uid: number) => db.select().from(ticketDrafts).where(and(eq(ticketDrafts.userId, uid), eq(ticketDrafts.status, 'draft')))

export async function GET(req: Request) {
  const ctx = await draftContext(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sp = new URL(req.url).searchParams.get('sprintId')
  const sprintId = sp ? Number(sp) : null
  const rows = await db.select().from(ticketDrafts)
    .where(and(eq(ticketDrafts.userId, ctx.uid), sprintId ? eq(ticketDrafts.sprintId, sprintId) : isNull(ticketDrafts.sprintId), eq(ticketDrafts.status, 'draft')))
    .orderBy(desc(ticketDrafts.createdAt))
  const inOp = sprintId && ctx.opToken ? await sprintTasksInOp(ctx, sprintId).catch(() => null) : null
  return NextResponse.json({
    drafts: rows.map(d => {
      // catatan lokal dihitung ulang (duplikat/tanggal bisa berubah karena draf lain); hasil cek OP dari simpanan
      const local = localIssues(d, rows, inOp)
      const seen = new Set<string>(), issues: Issue[] = []
      for (const i of [...local, ...((d.checkIssues ?? []) as Issue[])]) if (!seen.has(i.msg)) { seen.add(i.msg); issues.push(i) }
      const stage = d.checkOk && !local.some(i => i.level === 'error') ? 'close' : 'progress'
      return { ...d, issues, stage }
    }),
    sprintTotalMins: sprintTotalMins(rows, inOp),
    opTotalMins: inOp ? inOp.reduce((a, t) => a + t.estMins, 0) : null,
    capMins: SPRINT_CAP_MINS,
  })
}

export async function POST(req: Request) {
  const ctx = await draftContext(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({})) as { sprintId?: number | null; parentId?: number | null; subject?: string; estimatedMins?: number | null; description?: string; typeId?: number; targetStatus?: string; timeLogs?: unknown; kind?: string; targetWpId?: number; activity?: unknown }
  const id = `td-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

  // draf UPDATE: tiket sudah ada di OP → hanya waktu + langkah status (judul/estimate diambil dari OP, tak diubah)
  if (b.kind === 'update') {
    const wpId = Number(b.targetWpId)
    if (!wpId) return NextResponse.json({ error: 'targetWpId wajib' }, { status: 400 })
    const sn = ctx.opToken ? await snapshotOf(ctx, wpId) : null
    if (!sn) return NextResponse.json({ error: `Tiket #${wpId} tidak ditemukan di OP` }, { status: 404 })
    const [row] = await db.insert(ticketDrafts).values({
      id, userId: ctx.uid, kind: 'update', targetWpId: wpId, targetSnapshot: sn,
      sprintId: b.sprintId ?? sn.versionId ?? null, subject: sn.subject, estimatedMins: sn.estMins,
      targetStatus: b.targetStatus === 'closed' ? 'closed' : 'in_progress', timeLogs: sanitizeLogs(b.timeLogs, ctx.machine), activity: sanitizeActivity(b.activity),
    }).returning()
    const chk = await recheck(ctx, row, await myDrafts(ctx.uid))
    return NextResponse.json({ ok: true, draft: { ...row, checkOk: chk.ok, issues: chk.issues, stage: chk.ok ? 'close' : 'progress' } })
  }

  if (!b.subject?.trim()) return NextResponse.json({ error: 'Judul wajib' }, { status: 400 })
  const [row] = await db.insert(ticketDrafts).values({
    id, userId: ctx.uid,
    sprintId: b.sprintId ?? null, parentId: b.parentId ?? null, typeId: b.typeId ?? 1,
    subject: b.subject.trim(), description: b.description?.trim() || null,
    estimatedMins: b.estimatedMins ?? MIN_EST_MINS,
    targetStatus: sanitizeStatus(b.targetStatus), timeLogs: sanitizeLogs(b.timeLogs, ctx.machine), activity: sanitizeActivity(b.activity),
  }).returning()
  const chk = ctx.opToken ? await recheck(ctx, row, await myDrafts(ctx.uid)) : { ok: false, issues: [] }
  return NextResponse.json({ ok: true, draft: { ...row, checkOk: chk.ok, issues: chk.issues, stage: chk.ok ? 'close' : 'progress' } })
}

export async function PATCH(req: Request) {
  const ctx = await draftContext(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({})) as { id?: string; sprintId?: number | null; parentId?: number | null; subject?: string; estimatedMins?: number | null; description?: string | null; targetStatus?: string; timeLogs?: unknown; activity?: unknown }
  if (!b.id) return NextResponse.json({ error: 'id wajib' }, { status: 400 })
  const set: Partial<typeof ticketDrafts.$inferInsert> = { updatedAt: new Date(), checkOk: false }   // diubah = cek ulang dulu
  if (b.subject !== undefined) set.subject = String(b.subject).trim()
  if (b.parentId !== undefined) set.parentId = b.parentId
  if (b.sprintId !== undefined) set.sprintId = b.sprintId
  if (b.estimatedMins !== undefined) set.estimatedMins = b.estimatedMins
  if (b.description !== undefined) set.description = b.description?.trim() || null
  if (b.targetStatus !== undefined) set.targetStatus = sanitizeStatus(b.targetStatus)
  if (b.timeLogs !== undefined) set.timeLogs = sanitizeLogs(b.timeLogs, ctx.machine)
  if (b.activity !== undefined) set.activity = sanitizeActivity(b.activity)
  const [row] = await db.update(ticketDrafts).set(set)
    .where(and(eq(ticketDrafts.id, b.id), eq(ticketDrafts.userId, ctx.uid), eq(ticketDrafts.status, 'draft'))).returning()
  if (!row) return NextResponse.json({ error: 'Draf tidak ditemukan / sudah di-push' }, { status: 404 })
  const chk = ctx.opToken ? await recheck(ctx, row, await myDrafts(ctx.uid)) : { ok: false, issues: [] }
  return NextResponse.json({ ok: true, draft: { ...row, checkOk: chk.ok, issues: chk.issues, stage: chk.ok ? 'close' : 'progress' } })
}

export async function DELETE(req: Request) {
  const ctx = await draftContext(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id wajib' }, { status: 400 })
  const [row] = await db.update(ticketDrafts).set({ status: 'discarded', updatedAt: new Date() })
    .where(and(eq(ticketDrafts.id, id), eq(ticketDrafts.userId, ctx.uid), eq(ticketDrafts.status, 'draft'))).returning()
  return NextResponse.json({ ok: !!row })
}
