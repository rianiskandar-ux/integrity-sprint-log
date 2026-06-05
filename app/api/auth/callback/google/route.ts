import { NextResponse } from 'next/server'
import { exchangeCode, saveToken, saveProfile } from '@/lib/google-auth'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  if (error) return NextResponse.redirect(new URL('/?gcal=error', req.url))
  if (!code) return NextResponse.json({ error: 'No code' }, { status: 400 })

  try {
    const token = await exchangeCode(code)
    saveToken(token)

    // Fetch Google profile
    try {
      const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${token.access_token}` },
      })
      if (profileRes.ok) {
        const p = await profileRes.json()
        saveProfile({ id: p.id, name: p.name, email: p.email, picture: p.picture })
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
    return NextResponse.redirect(new URL(`/?gcal=error&msg=${encodeURIComponent(msg)}`, req.url))
  }
}
