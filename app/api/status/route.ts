import { NextResponse } from 'next/server'
import { getOpToken, getOpBaseUrl } from '@/lib/user-config'
import path from 'path'
import fs from 'fs'

const SPRINT_DIR = process.env.SPRINT_OUTPUT_DIR ?? path.join(process.env.CACHE_DATA_DIR ?? process.cwd(), 'daily-sprints')

export async function GET() {
  const opBase  = getOpBaseUrl()
  const opToken = getOpToken()

  let opStatus: { status: string; error: string | null; base: string } = {
    status: 'unconfigured',
    error:  'OP_BASE_URL not set',
    base:   opBase,
  }

  if (opBase && opToken) {
    try {
      const auth = 'Basic ' + Buffer.from(`apikey:${opToken}`).toString('base64')
      const res  = await fetch(`${opBase}/api/v3/users/me`, { headers: { Authorization: auth } })
      opStatus = {
        status: res.ok ? 'ok' : 'error',
        error:  res.ok ? null : `HTTP ${res.status}`,
        base:   opBase,
      }
    } catch (e) {
      opStatus = { status: 'error', error: String(e), base: opBase }
    }
  }

  const dirExists  = fs.existsSync(SPRINT_DIR)
  const fileCount  = dirExists ? fs.readdirSync(SPRINT_DIR).filter(f => f.endsWith('.md')).length : 0

  return NextResponse.json({
    op:     opStatus,
    sprint: { dir: SPRINT_DIR, dirExists, fileCount },
    env:    { configured: !!opBase && !!opToken },
  })
}
