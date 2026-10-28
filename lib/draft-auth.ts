// Otorisasi API draf tiket (Rian 2026-10-19).
//  - Sesi browser (login ISL)      → semua aksi, TERMASUK push ke OP.
//  - Kunci mesin x-kafi-key        → buat / ubah / buang / cek draf saja (dipakai Claude untuk menyusun
//    draf dari kerjaan nyata). Push ke OP SENGAJA ditolak untuk jalur ini: keputusan Rian, push selalu
//    dia yang menekan — dipaksa di kode, bukan sekadar janji.
// Middleware meloloskan request ber-x-kafi-key; NILAI kuncinya divalidasi di sini (resolveCaptureUid).
import { eq } from 'drizzle-orm'
import { db, userSettings } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import { getOpBaseUrl } from '@/lib/user-config'
import { getRequestContext, type RequestContext } from '@/lib/request-auth'
import { resolveCaptureUid } from '@/lib/capture-auth'

export interface DraftContext extends RequestContext { machine: boolean }

export async function draftContext(req: Request): Promise<DraftContext | null> {
  const key = req.headers.get('x-kafi-key')
  if (!key) {
    const ctx = await getRequestContext()
    return ctx ? { ...ctx, machine: false } : null
  }
  const uid = await resolveCaptureUid(key)
  if (uid == null) return null
  const row = (await db.select().from(userSettings).where(eq(userSettings.userId, uid)).limit(1))[0]
  const opToken = row?.opApiToken ? decrypt(row.opApiToken) : ''
  if (!opToken) return null
  const opBaseUrl = getOpBaseUrl() || process.env.OP_BASE_URL || 'https://tokek.integrity-asia.com'
  return { uid, opUserId: row?.opUserId ?? 0, opToken, opBaseUrl, machine: true }
}
