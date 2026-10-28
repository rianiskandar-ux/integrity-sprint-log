import { NextResponse } from 'next/server'
import { ISL_TO_OP_STATUS, updateCachedWPStatus } from '@/lib/op-cache'
import { getRequestContext } from '@/lib/request-auth'

export const runtime = 'nodejs'

// Langkah status dari tab Sprint ("Pilih" → New / In Progress / Hold / Close).
// Aturan Rian 2026-10-16 (OP = laporan final, jurnalnya harus wajar):
//  - Tidak lompat: New → Close dijalankan sebagai New → In progress → Closed (dua langkah jujur).
//  - % Done otomatis (instance OP mode BERBASIS KERJA): In progress → remaining = estimate − waktu
//    ter-log, dibatasi maks 95% (100% hanya saat Closed); Closed → OP sendiri mengisi 100%.
//    Terbukti lewat /form 16 Okt: est 6h, sisa 3h → 50%; sisa 18m → 95%; Closed → 100%.
const ST = { NEW: 1, IN_PROGRESS: 7, CLOSED: 12 }
const MAX_PROGRESS_PCT = 95

function isoToMins(dur: unknown): number | null {
  if (!dur || typeof dur !== 'string') return null
  const m = dur.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/)
  if (!m) return null
  return Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) + Math.round(Number(m[4] ?? 0) / 60)
}
function minsToISO(mins: number): string {
  const h = Math.floor(mins / 60), m = mins % 60
  return h > 0 ? `PT${h}H${m > 0 ? m + 'M' : ''}` : `PT${m}M`
}
// sisa kerja supaya % = ter-log ÷ estimate, maksimal 95%. null = estimate kosong → % tak diatur.
function remainingFor(estMins: number | null, spentMins: number | null): string | null {
  if (!estMins || estMins <= 0) return null
  const floor = Math.ceil(estMins * (100 - MAX_PROGRESS_PCT) / 100)
  return minsToISO(Math.max(floor, estMins - (spentMins ?? 0)))
}

export async function POST(req: Request) {
  try {
    const { wpId, islStatus } = await req.json()
    if (!wpId || !islStatus) return NextResponse.json({ error: 'wpId and islStatus required' }, { status: 400 })
    const opStatusId = ISL_TO_OP_STATUS[islStatus]
    if (!opStatusId) return NextResponse.json({ error: `Unknown islStatus: ${islStatus}` }, { status: 400 })

    const ctx = await getRequestContext()
    if (!ctx) {
      updateCachedWPStatus(wpId, opStatusId)
      return NextResponse.json({ ok: true, synced: false, note: 'Unauthorized, local cache updated only' })
    }
    const { opToken: OP_TOKEN, opBaseUrl: OP_BASE, uid } = ctx
    const headers = {
      Authorization: 'Basic ' + Buffer.from(`apikey:${OP_TOKEN}`).toString('base64'),
      'Content-Type': 'application/json',
    }
    const wpRes = await fetch(`${OP_BASE}/api/v3/work_packages/${wpId}`, { headers })
    if (!wpRes.ok) return NextResponse.json({ error: `WP ${wpId} not found in OP` }, { status: 404 })
    let wp = await wpRes.json()

    const current = Number(String(wp._links?.status?.href ?? '').split('/').pop())
    const estMins = isoToMins(wp.estimatedTime), spentMins = isoToMins(wp.spentTime)
    const patch = async (statusId: number, extra: Record<string, unknown> = {}) => {
      const r = await fetch(`${OP_BASE}/api/v3/work_packages/${wpId}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ lockVersion: wp.lockVersion, ...extra, _links: { status: { href: `/api/v3/statuses/${statusId}` } } }),
      })
      if (!r.ok) return { ok: false, err: await r.text() }
      wp = await r.json()   // lockVersion baru untuk langkah berikutnya
      return { ok: true }
    }

    const steps: string[] = []
    let res: { ok: boolean; err?: string } = { ok: true }
    if (opStatusId === ST.IN_PROGRESS) {
      // juga dipakai untuk menyegarkan % tiket yang sudah In progress
      const rem = remainingFor(estMins, spentMins)
      res = await patch(ST.IN_PROGRESS, rem ? { remainingTime: rem } : {})
      steps.push('in_progress')
    } else if (opStatusId === ST.CLOSED) {
      if (current === ST.NEW) {   // jangan lompat: lewat In progress dulu
        const rem = remainingFor(estMins, spentMins)
        res = await patch(ST.IN_PROGRESS, rem ? { remainingTime: rem } : {})
        steps.push('in_progress')
      }
      if (res.ok && current !== ST.CLOSED) { res = await patch(ST.CLOSED, { remainingTime: 'PT0S' }); steps.push('closed') }
    } else if (opStatusId !== current) {
      res = await patch(opStatusId)
      steps.push(islStatus)
    }

    updateCachedWPStatus(wpId, res.ok ? opStatusId : current, uid)
    if (!res.ok) return NextResponse.json({ ok: true, synced: false, opError: res.err, steps })
    return NextResponse.json({ ok: true, synced: true, opStatusId, steps, percentageDone: wp.percentageDone })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
