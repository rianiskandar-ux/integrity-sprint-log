import { NextRequest, NextResponse } from 'next/server'
import { loadUserConfig } from '@/lib/user-config'

export const runtime = 'nodejs'

const RESEND_API_KEY = process.env.RESEND_API_KEY || ''
const FEEDBACK_TO    = process.env.FEEDBACK_EMAIL  || 'rian.iskandar108@gmail.com'

export async function POST(req: NextRequest) {
  const { name, role, rating, message, category } = await req.json() as {
    name: string; role?: string; rating?: number
    message: string; category?: string
  }

  if (!message?.trim()) return NextResponse.json({ error: 'Message required' }, { status: 400 })

  const apiKey = RESEND_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'Resend not configured' }, { status: 500 })

  const stars   = rating ? '★'.repeat(rating) + '☆'.repeat(5 - rating) : '—'
  const catLabel = category ?? 'General'
  const sender   = name?.trim() || 'Anonymous'
  const roleLabel = role?.trim() ? ` · ${role}` : ''
  const now      = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })

  const html = `<!DOCTYPE html>
<html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#f9fafb">
<div style="background:white;border-radius:12px;padding:24px;border:1px solid #e5e7eb">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
    <div style="width:40px;height:40px;background:linear-gradient(135deg,#1d3a5c,#2a5298);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px">💬</div>
    <div>
      <h2 style="margin:0;font-size:16px;color:#111827">Feedback Baru — ISL</h2>
      <p style="margin:0;font-size:12px;color:#6b7280">${now} WIB</p>
    </div>
  </div>

  <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
    <tr><td style="padding:6px 0;color:#6b7280;font-size:12px;width:100px">Dari</td>
        <td style="padding:6px 0;font-size:13px;font-weight:600;color:#111827">${sender}${roleLabel}</td></tr>
    <tr><td style="padding:6px 0;color:#6b7280;font-size:12px">Kategori</td>
        <td style="padding:6px 0;font-size:13px;color:#111827">${catLabel}</td></tr>
    <tr><td style="padding:6px 0;color:#6b7280;font-size:12px">Rating</td>
        <td style="padding:6px 0;font-size:14px;color:#f59e0b">${stars}</td></tr>
  </table>

  <div style="background:#f8fafc;border-radius:8px;padding:16px;border-left:3px solid #1d3a5c">
    <p style="margin:0;font-size:13px;color:#374151;line-height:1.6;white-space:pre-wrap">${message.trim()}</p>
  </div>

  <p style="margin-top:20px;font-size:11px;color:#9ca3af;text-align:center">
    Dikirim otomatis dari ISL · Integrity Sprint Log
  </p>
</div>
</body></html>`

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    'ISL Feedback <onboarding@resend.dev>',
        to:      [FEEDBACK_TO],
        subject: `[ISL Feedback] ${catLabel} — ${sender}${rating ? ` ${stars}` : ''}`,
        html,
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return NextResponse.json({ error: (err as { message?: string }).message ?? `Resend HTTP ${res.status}` }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
