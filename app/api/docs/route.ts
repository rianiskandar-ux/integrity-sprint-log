import { NextRequest, NextResponse } from 'next/server'
import { db, uploadedDocs, embeddings } from '@/lib/db'
import { getRequestContext } from '@/lib/request-auth'
import { and, eq, like, desc } from 'drizzle-orm'

export const runtime = 'nodejs'

// ── Doc Parser — list/delete uploaded docs ───────────────────────────────────
// GET: list uploadedDocs rows (own user's in multi-user mode, all otherwise).
// DELETE: remove a doc's tracking row + every embedding chunk it produced.

export async function GET() {
  try {
    const ctx = await getRequestContext()
    if (process.env.ISL_MULTIUSER === '1' && !ctx) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const rows = process.env.ISL_MULTIUSER === '1' && ctx
      ? await db.select().from(uploadedDocs).where(eq(uploadedDocs.userId, ctx.uid)).orderBy(desc(uploadedDocs.uploadedAt))
      : await db.select().from(uploadedDocs).orderBy(desc(uploadedDocs.uploadedAt))

    return NextResponse.json({ ok: true, docs: rows })
  } catch (e) {
    console.error('[docs] GET error:', e)
    return NextResponse.json({ ok: false, error: 'Failed to list docs' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await getRequestContext()
    if (process.env.ISL_MULTIUSER === '1' && !ctx) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => null) as { docId?: string } | null
    const docId = body?.docId
    if (!docId || typeof docId !== 'string') {
      return NextResponse.json({ ok: false, error: 'Body must be { docId }' }, { status: 400 })
    }

    const rows = await db.select().from(uploadedDocs).where(eq(uploadedDocs.id, docId)).limit(1)
    const doc = rows[0]
    if (!doc) {
      return NextResponse.json({ ok: false, error: 'Doc not found' }, { status: 404 })
    }

    // Ownership check — only in multi-user mode, and only when the doc has an owner.
    if (process.env.ISL_MULTIUSER === '1' && ctx && doc.userId != null && doc.userId !== ctx.uid) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
    }

    await db.delete(embeddings).where(
      and(eq(embeddings.sourceType, 'doc'), like(embeddings.sourceId, `doc-${docId}-chunk-%`)),
    )
    await db.delete(uploadedDocs).where(eq(uploadedDocs.id, docId))

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[docs] DELETE error:', e)
    return NextResponse.json({ ok: false, error: 'Delete failed' }, { status: 500 })
  }
}
