import { NextResponse } from 'next/server'
import fs from 'fs'
import { getSprintDir } from '@/lib/parser'

export async function GET() {
  const opBase = process.env.OP_BASE_URL ?? ''
  const opToken = process.env.OP_API_TOKEN ?? ''
  const opProject = process.env.OP_PROJECT_ID ?? ''
  const dir = getSprintDir()

  // Check sprint dir
  const dirExists = fs.existsSync(dir)
  const fileCount = dirExists
    ? fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).length
    : 0

  // Check OP connectivity
  let opStatus: 'ok' | 'error' | 'unconfigured' = 'unconfigured'
  let opError: string | null = null
  if (opBase && opToken && opProject) {
    try {
      const res = await fetch(`${opBase}/api/v3/projects/${opProject}`, {
        headers: { Authorization: 'Basic ' + Buffer.from(`apikey:${opToken}`).toString('base64') },
        signal: AbortSignal.timeout(5000),
      })
      opStatus = res.ok ? 'ok' : 'error'
      if (!res.ok) opError = `HTTP ${res.status}`
    } catch (e) {
      opStatus = 'error'
      opError = e instanceof Error ? e.message : 'Connection failed'
    }
  }

  return NextResponse.json({
    op: { status: opStatus, error: opError, base: opBase, project: opProject },
    sprint: { dir, dirExists, fileCount },
    env: { configured: !!(opBase && opToken && opProject) },
  })
}
