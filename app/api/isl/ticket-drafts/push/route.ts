import { NextResponse } from 'next/server'
import { and, eq, inArray } from 'drizzle-orm'
import { db, ticketDrafts } from '@/lib/db'
import { draftContext } from '@/lib/draft-auth'
import { buildAndValidate, localIssues, pushDraft, sprintTasksInOp } from '@/lib/ticket-drafts'

export const runtime = 'nodejs'

// POST { ids: string[], dryRun?: boolean }
//  dryRun = cek penuh (aturan kita + validasi OP lewat /form) TANPA membuat apa pun di OP.
//  tanpa dryRun = "Fix → Push": tiket lahir di OP, berurutan, satu per satu (lihat pushDraft).
// Push sungguhan HANYA dari sesi browser (Rian yang menekan). Kunci mesin (x-kafi-key, dipakai Claude
// untuk menyusun draf) cuma boleh dryRun — keputusan Rian 19 Okt, dipaksa di sini.
export async function POST(req: Request) {
  const ctx = await draftContext(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ctx.opToken || !ctx.opBaseUrl) return NextResponse.json({ error: 'OP belum dikonfigurasi' }, { status: 400 })
  const b = await req.json().catch(() => ({})) as { ids?: string[]; dryRun?: boolean }
  if (!b.dryRun && ctx.machine) return NextResponse.json({ error: 'Push ke OP hanya dari ISL di browser (Rian yang menekan), bukan lewat kunci mesin' }, { status: 403 })
  const ids = (b.ids ?? []).filter(Boolean)
  if (!ids.length) return NextResponse.json({ error: 'ids wajib' }, { status: 400 })

  const allMine = await db.select().from(ticketDrafts).where(and(eq(ticketDrafts.userId, ctx.uid), eq(ticketDrafts.status, 'draft')))
  const rows = await db.select().from(ticketDrafts).where(and(eq(ticketDrafts.userId, ctx.uid), inArray(ticketDrafts.id, ids)))
  const results: { id: string; subject: string; ok: boolean; opWpId?: number; steps?: string[]; issues: { level: string; msg: string }[] }[] = []
  for (const d of rows) {
    const siblings = allMine.filter(x => (x.sprintId ?? null) === (d.sprintId ?? null))
    if (b.dryRun) {
      const inOp = d.sprintId ? await sprintTasksInOp(ctx, d.sprintId) : []
      const local = localIssues(d, siblings, inOp)
      const full = local.some(i => i.level === 'error') ? { issues: [] } : await buildAndValidate(ctx, d, allMine)
      const issues = [...local, ...full.issues]
      results.push({ id: d.id, subject: d.subject, ok: !issues.some(i => i.level === 'error'), issues })
    } else {
      results.push({ id: d.id, subject: d.subject, ...(await pushDraft(ctx, d, siblings, allMine)) })
    }
  }
  // cache OP disegarkan oleh UI sesudahnya (pola yang sama dgn aksi lain di tab Sprint)
  return NextResponse.json({ results })
}
