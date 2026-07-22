/**
 * Mint a valid isl-user session cookie for local testing, without a real OP-token login.
 *
 * Replaces the old pattern of reimplementing lib/session-token.ts's HMAC signing by hand
 * inside throwaway `docker exec ... node -e "..."` one-liners (done ~dozens of times across
 * this project's build) — this script imports the REAL lib/auth.ts + lib/session-token.ts,
 * so it can never drift from how the app actually verifies tokens.
 *
 * Requires DATABASE_URL + ISL_ENCRYPTION_KEY in the environment, matching the values the
 * running container uses. NOTE: .env's DATABASE_URL points at host `postgres` (Docker-internal
 * hostname) — swap it for `localhost` when running this from the host, e.g.:
 *   export DATABASE_URL="postgresql://isl:<POSTGRES_PASSWORD from .env>@localhost:5432/isl"
 *   export ISL_ENCRYPTION_KEY="<ISL_ENCRYPTION_KEY from .env>"
 *
 * Usage (from daily-sprint-next/, on host):
 *   npx tsx scripts/mint-session.ts --uid=2
 *   npx tsx scripts/mint-session.ts --email=m.athallah@integrity-indonesia.com
 *
 * Prints a ready-to-use `Cookie:` header value and a full curl example.
 */
import { eq } from 'drizzle-orm'
import { db, users } from '../lib/db'
import { makeUserToken, USER_COOKIE } from '../lib/auth'

function parseArgs(argv: string[]): { uid?: number; email?: string } {
  const out: { uid?: number; email?: string } = {}
  for (const arg of argv) {
    const [key, val] = arg.replace(/^--/, '').split('=')
    if (key === 'uid' && val) out.uid = Number(val)
    if (key === 'email' && val) out.email = val
  }
  return out
}

async function main() {
  const { uid, email } = parseArgs(process.argv.slice(2))
  if (!uid && !email) {
    console.error('Usage: npx tsx scripts/mint-session.ts --uid=<id> | --email=<email>')
    process.exit(1)
  }

  const row = (await db.select().from(users)
    .where(uid ? eq(users.id, uid) : eq(users.email, email!))
    .limit(1))[0]

  if (!row) {
    console.error(`No user found for ${uid ? `uid=${uid}` : `email=${email}`}`)
    process.exit(1)
  }

  const token = await makeUserToken({ uid: row.id, name: row.name, opUserId: row.opUserId })

  console.log(`User: ${row.name} (uid=${row.id}, email=${row.email}, role=${row.role}, opUserId=${row.opUserId})`)
  console.log(`\nCookie header:\n${USER_COOKIE}=${token}`)
  console.log(`\ncurl example:\ncurl -H "Cookie: ${USER_COOKIE}=${token}" http://localhost:4891/api/auth/me`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => process.exit(0))
