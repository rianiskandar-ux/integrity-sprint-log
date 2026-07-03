import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
})

pool.on('error', (err) => {
  console.error('[DB Pool] Idle client error:', err.message)
})

export const db = drizzle(pool, { schema })
export * from './schema'
