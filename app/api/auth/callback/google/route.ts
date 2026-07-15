import { NextResponse } from 'next/server'
import { exchangeCode, saveToken, saveProfile } from '@/lib/google-auth'
import { getRequestContext } from '@/lib/request-auth'
import { OWNER_UID } from '@/lib/auth'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  const PUBLIC_URL = process.env.NEXTAUTH_URL || 'http://localhost:4891'
  if (error) return NextResponse.redirect(new URL('/?gcal=error', PUBLIC_URL))
  if (!code) return NextResponse.json({ error: 'No code' }, { status: 400 })

  // Which user is connecting — from the OAuth state (set by /api/auth/google), or
  // the session cookie, else the owner (single-user mode only — see below).
  const stateUid = Number(searchParams.get('state'))
  const ctx = await getRequestContext()
  // Multi-user mode: never silently attribute to OWNER_UID here — this route
  // is public (exempt from middleware) precisely because it's the OAuth
  // redirect target, so a caller with no state and no session must not be
  // able to save a Google connection into the owner's slot.
  if (process.env.ISL_MULTIUSER === '1' && !(Number.isFinite(stateUid) && stateUid > 0) && !ctx) {
    return NextResponse.redirect(new URL('/login', PUBLIC_URL))
  }
  const uid = (Number.isFinite(stateUid) && stateUid > 0) ? stateUid : (ctx?.uid ?? OWNER_UID)

  try {
    const token = await exchangeCode(code)
    saveToken(uid, token)

    // Fetch Google profile
    try {
      const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${token.access_token}` },
      })
      if (profileRes.ok) {
        const p = await profileRes.json()
        saveProfile(uid, { id: p.id, name: p.name, email: p.email, picture: p.picture })
      }
    } catch { /* profile is optional */ }

    // Return a self-closing page so the tab opened from wizard can close itself
    return new Response(
      `<!DOCTYPE html><html><body><script>
        window.opener && window.opener.postMessage('gcal-connected', '*');
        setTimeout(() => window.close(), 500);
      </script><p style="font-family:sans-serif;text-align:center;padding:40px">
        ✅ Google Calendar terhubung! Tab ini akan menutup otomatis...
      </p></body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'OAuth error'
    return NextResponse.redirect(new URL(`/?gcal=error&msg=${encodeURIComponent(msg)}`, PUBLIC_URL))
  }
}
