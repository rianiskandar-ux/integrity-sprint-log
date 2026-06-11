import { NextResponse } from 'next/server'
import { sendEmail, loadProfile } from '@/lib/google-auth'

export async function POST(req: Request) {
  try {
    const { type, data } = await req.json()

    const profile = loadProfile()
    const to      = profile?.email ?? 'rian.iskandar108@gmail.com'

    if (type === 'validation_needed') {
      const { title, taskId, sessionId, aiStatus, actualMins } = data
      const dur    = actualMins ? (actualMins >= 60 ? `${Math.floor(actualMins/60)}j ${actualMins%60}m` : `${actualMins}m`) : '—'
      const opLink = taskId ? `<a href="https://tokek.integrity-asia.com/work_packages/${taskId}">OP #${taskId}</a>` : 'task baru'
      const islLink = `<a href="http://localhost:3000?view=autolog">Buka ISL Auto Log →</a>`

      const html = `
<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:16px;margin-bottom:16px">
  <strong style="color:#92400e">⚠️ Sesi kerja perlu validasi status</strong>
</div>
<h2 style="color:#1f2937;margin-top:0">${title}</h2>
<table style="width:100%;border-collapse:collapse">
  <tr><td style="padding:6px 0;color:#6b7280;width:140px">Task di OP</td><td>${opLink}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280">Durasi aktual</td><td>⏱ ${dur}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280">Status AI (sementara)</td><td>🔄 ${aiStatus ?? 'in_progress'}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280">Session ID</td><td><code style="background:#f3f4f6;padding:2px 6px;border-radius:4px">${(sessionId ?? '').slice(0, 8)}</code></td></tr>
</table>
<div style="margin-top:20px;padding:16px;background:#f0f9ff;border-radius:8px;border:1px solid #bae6fd">
  <p style="margin:0 0 8px;color:#0369a1"><strong>Tindakan yang diperlukan:</strong></p>
  <p style="margin:0;color:#0c4a6e">Buka ISL dan konfirmasi/ubah status task ini. Kalau tidak ada aksi, status tetap sesuai keputusan AI.</p>
</div>
<p style="margin-top:20px">${islLink}</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
<p style="color:#9ca3af;font-size:12px">🤖 Auto-sent by ISL · ${new Date().toLocaleString('id-ID')}</p>
</body></html>`

      const ok = await sendEmail(to, `[ISL] ⚠️ Validasi status: ${title.slice(0, 50)}`, html)
      return NextResponse.json({ ok, to })
    }

    return NextResponse.json({ ok: false, error: 'unknown type' })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
