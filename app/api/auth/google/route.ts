import { redirect } from 'next/navigation'
import { getAuthUrl } from '@/lib/google-auth'
import { getRequestContext } from '@/lib/request-auth'
import { OWNER_UID } from '@/lib/auth'

export async function GET() {
  const ctx = await getRequestContext()
  // Attribute the Google connection to the user who started it (per-user, isolated).
  redirect(getAuthUrl(ctx?.uid ?? OWNER_UID))
}
