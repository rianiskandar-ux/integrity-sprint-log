/**
 * Runs before any test file is loaded. lib/db/index.ts opens its pg Pool at
 * import time, so DATABASE_URL must point at the disposable isl_test database
 * BEFORE the first `import { db } from '../db'` anywhere in the suite —
 * otherwise tests would connect to (and could mutate) the real dev database.
 *
 * isl_test is a schema-only clone of isl (recreate any time with:
 *   docker exec isl-postgres psql -U isl -d isl -c "DROP DATABASE IF EXISTS isl_test;" -c "CREATE DATABASE isl_test;"
 *   docker exec isl-postgres pg_dump -U isl -d isl --schema-only | docker exec -i isl-postgres psql -U isl -d isl_test
 * ) — never contains real ticket/session/user data, so tests are free to
 * insert/mutate/delete without any production-data risk.
 *
 * Secrets are never hardcoded here — POSTGRES_PASSWORD / ISL_ENCRYPTION_KEY
 * must already be in the environment (source .env the same way scripts/
 * mint-session.ts documents), same as every other script that talks to the
 * real infra.
 */
const pw = process.env.POSTGRES_PASSWORD
if (!pw) {
  throw new Error(
    'POSTGRES_PASSWORD not set. Run tests with it exported, e.g.:\n' +
    '  POSTGRES_PASSWORD=<value from .env> npx vitest run',
  )
}
process.env.DATABASE_URL = `postgresql://isl:${pw}@localhost:5432/isl_test`

if (!process.env.ISL_ENCRYPTION_KEY) {
  throw new Error('ISL_ENCRYPTION_KEY not set — export it the same way as POSTGRES_PASSWORD.')
}
process.env.ISL_OWNER_UID ??= '1'
