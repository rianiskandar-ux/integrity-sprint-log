import { NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/request-auth'
import path from 'path'
import fs from 'fs'

export const runtime = 'nodejs'

const SPRINT_DIR = process.env.SPRINT_OUTPUT_DIR ?? path.join(process.env.CACHE_DATA_DIR ?? process.cwd(), 'daily-sprints')

export async function GET() {
  const ctx = await getRequestContext()

  let opStatus: { status: string; error: string | null; base: string } = {
    status: 'unconfigured',
    error:  'Not authenticated',
    base:   '',
  }

  if (ctx) {
    const { opToken, opBaseUrl } = ctx
    try {
      const auth = 'Basic ' + Buffer.from(`apikey:${opToken}`).toString('base64')
      const res  = await fetch(`${opBaseUrl}/api/v3/users/me`, { headers: { Authorization: auth } })
      opStatus = {
        status: res.ok ? 'ok' : 'error',
        error:  res.ok ? null : `HTTP ${res.status}`,
        base:   opBaseUrl,
      }
    } catch (e) {
      opStatus = { status: 'error', error: String(e), base: ctx.opBaseUrl }
    }
  }

  const dirExists  = fs.existsSync(SPRINT_DIR)
  const fileCount  = dirExists ? fs.readdirSync(SPRINT_DIR).filter(f => f.endsWith('.md')).length : 0

  return NextResponse.json({
    op:     opStatus,
    sprint: { dir: SPRINT_DIR, dirExists, fileCount },
    env:    { configured: !!ctx },
  })
}
