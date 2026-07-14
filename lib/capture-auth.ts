import { db, userSettings } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { OWNER_UID } from '@/lib/auth'

// Resolves an x-kafi-key header to the uid it should attribute captured data
// to. Two tiers:
//  - the global KAFI_API_KEY (env / legacy default) → OWNER, unchanged
//  - a per-user captureKey from user_settings → that user's uid, so a
//    teammate running the Claude Code hook on their own laptop gets their
//    sessions/daily-logs under their own account instead of the owner's.
// Lives in its own module (not lib/auth.ts) on purpose: auth.ts is imported
// by middleware (edge runtime), which can't carry a pg Pool import.
export async function resolveCaptureUid(key: string | null | undefined): Promise<number | null> {
  if (!key) return null
  if (key === (process.env.KAFI_API_KEY)) return OWNER_UID
  try {
    const row = (await db.select({ userId: userSettings.userId })
      .from(userSettings)
      .where(eq(userSettings.captureKey, key))
      .limit(1))[0]
    return row?.userId ?? null
  } catch {
    return null
  }
}
