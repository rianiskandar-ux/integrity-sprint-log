import { NextResponse } from 'next/server'
import { exchangeCode, saveToken, saveProfile } from '@/lib/google-auth'
import { getRequestContext } from '@/lib/request-auth'

export const runtime = 'nodejs'

// Manual Google connect for teammates on OTHER machines. Google's redirect-URI
// rules block the normal flow for them: the registered URI must stay
// http://localhost:4891/... (raw LAN IPs over plain HTTP are rejected by
// Google outright), so after approving, THEIR browser gets bounced to
// localhost on their own PC — a dead end page. The authorization code is
// still sitting right there in that dead page's address bar, though, and
// exchanging it is a server→Google call that doesn't care the page never
// loaded. So: they copy that URL (or just the code) and paste it here, and
// this endpoint finishes the exchange attributed to THEIR session uid.
// Codes are one-shot and expire in minutes, so the paste window is tight
// but safe.
export async function POST(req: Request) {
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized — login dulu' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { pasted?: string }
  const pasted = (body.pasted ?? '').trim()
  if (!pasted) return NextResponse.json({ error: 'Paste URL atau code dari halaman localhost yang error' }, { status: 400 })

  // Accept either the full dead-end URL or the bare code.
  let code = pasted
  try {
    const url = new URL(pasted)
    code = url.searchParams.get('code') ?? pasted
  } catch { /* not a URL — treat as the raw code */ }
  code = code.trim()
  if (!code) return NextResponse.json({ error: 'Tidak ketemu ?code= di teks yang di-paste' }, { status: 400 })

  try {
    const token = await exchangeCode(code)
    saveToken(ctx.uid, token)
    let profile: { name?: string; email?: string } = {}
    try {
      const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${token.access_token}` },
      })
      if (profileRes.ok) {
        const p = await profileRes.json()
        profile = { name: p.name, email: p.email }
        saveProfile(ctx.uid, { id: p.id, name: p.name, email: p.email, picture: p.picture })
      }
    } catch { /* profile optional */ }
    return NextResponse.json({ ok: true, profile })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'OAuth error'
    // Most common: code already used or expired (they took too long to paste).
    return NextResponse.json({ error: `Gagal tukar code: ${msg}. Code sekali pakai & cepat kedaluwarsa — ulangi dari tombol Connect.` }, { status: 400 })
  }
}
