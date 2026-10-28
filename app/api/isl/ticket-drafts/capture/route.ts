import { NextResponse } from 'next/server'
import { draftContext } from '@/lib/draft-auth'
import { captureSession, type CaptureInput } from '@/lib/ticket-capture'

export const runtime = 'nodejs'

// POST dari hook Arka (x-kafi-key) tiap sesi berhenti: potongan sesi kerja kantor → draf update tiket
// yang sudah ada (aktivitas + waktu). Hanya ISL — nol tulisan ke OP. Lihat lib/ticket-capture.ts.
export async function POST(req: Request) {
  const ctx = await draftContext(req)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ctx.opToken) return NextResponse.json({ matched: false, reason: 'OP belum dikonfigurasi' })
  const b = await req.json().catch(() => ({})) as Partial<CaptureInput>
  if (!b.sessionId || !b.segment || !b.title || !Array.isArray(b.bullets) || !Array.isArray(b.logs))
    return NextResponse.json({ error: 'sessionId, segment, title, bullets[], logs[] wajib' }, { status: 400 })
  try {
    return NextResponse.json(await captureSession(ctx, b as CaptureInput))
  } catch (e) {
    return NextResponse.json({ matched: false, error: String(e).slice(0, 200) }, { status: 500 })
  }
}
