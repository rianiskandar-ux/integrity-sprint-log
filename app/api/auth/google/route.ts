import { redirect } from 'next/navigation'
import { getAuthUrl } from '@/lib/google-auth'
import { getRequestContext } from '@/lib/request-auth'
import { OWNER_UID } from '@/lib/auth'

// /api/auth/* is deliberately exempt from middleware's cookie/key gate (it IS
// the login flow) — so in multi-user mode, an unauthenticated caller reaching
// this with no session previously fell through to OWNER_UID, meaning ANYONE
// could connect their OWN Google account and have it saved into the OWNER's
// calendar slot. Require a real session before starting the flow in that mode;
// single-user mode keeps defaulting to the owner (ctx is never null there).
export async function GET() {
  const ctx = await getRequestContext()
  if (process.env.ISL_MULTIUSER === '1' && !ctx) {
    redirect('/login')
  }
  // Attribute the Google connection to the user who started it (per-user, isolated).
  redirect(getAuthUrl(ctx?.uid ?? OWNER_UID))
}
