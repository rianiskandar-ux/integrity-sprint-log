/**
 * gen-context.ts
 * Generate CLAUDE.md dari DB langsung — tidak perlu ISL running.
 * Run: npm run context
 *
 * CLAUDE.md dibaca otomatis oleh Claude Code setiap sesi baru.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getAllSessions, getSessionsByStatus } from '../lib/session-store'
import { getAllKBEntries } from '../lib/kb-store'
import { loadCache } from '../lib/op-cache'
import { loadUserConfig } from '../lib/user-config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT      = path.resolve(__dirname, '..')
const OUT_FILE  = path.join(ROOT, 'CLAUDE.md')

async function main() {
  const [allSessions, pendingSessions, hubSessions, kbEntries, cache, userCfg] = await Promise.all([
    getAllSessions(),
    getSessionsByStatus('pending'),
    getSessionsByStatus('hub'),
    getAllKBEntries(),
    // Owner's per-user cache. After the global-cache removal, loadCache() with no
    // uid returns EMPTY — load the owner's file explicitly (ISL_OWNER_UID, default 1).
    Promise.resolve(loadCache(Number(process.env.ISL_OWNER_UID ?? 1))),
    Promise.resolve(loadUserConfig()),
  ])

  const now   = new Date()
  const today = now.toISOString().slice(0, 10)

  const sprints = (cache.sprints ?? []) as {
    id: number; name: string; startDate: string; endDate: string; isCurrent: boolean
  }[]
  const currentSprint = sprints.find(s => s.isCurrent) ?? sprints.find(s =>
    s.startDate <= today && s.endDate >= today
  ) ?? null

  const myOpen   = (cache.myOpenTasks   ?? []) as { id: number; subject: string; versionId?: number | null; status?: string; islStatus?: string }[]
  const myClosed = (cache.myClosedTasks ?? []) as { id: number; subject: string; versionId?: number | null }[]

  const sprintOpen   = currentSprint ? myOpen.filter(t => t.versionId === currentSprint.id) : []
  const sprintClosed = currentSprint ? myClosed.filter(t => t.versionId === currentSprint.id) : []
  const sprintTotal  = sprintOpen.length + sprintClosed.length
  const sprintPct    = sprintTotal > 0 ? Math.round(sprintClosed.length / sprintTotal * 100) : 0
  const daysLeft     = currentSprint
    ? Math.max(0, Math.floor((new Date(currentSprint.endDate).getTime() - now.getTime()) / 86400000))
    : null

  const incoming = ((cache.incomingTasks ?? []) as { id: number; subject: string; status?: string; islStatus?: string }[])
    .filter(t => t.islStatus !== 'done' && t.islStatus !== 'rejected')
    .slice(0, 10)

  const cutoff = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10)
  const recentPushed = allSessions
    .filter(s => s.pushStatus === 'pushed' && s.date >= cutoff)
    .slice(0, 15)

  const todaySessions = allSessions.filter(s => s.date === today && s.pushStatus === 'pushed')
  const todayMins     = todaySessions.reduce((a, s) => a + (s.actualMins ?? s.estimatedMins ?? 0), 0)
  const backlog       = myOpen.filter(t => !t.versionId).slice(0, 8)

  const lines: string[] = [
    `# ISL Context — Auto-generated ${now.toISOString().slice(0, 16).replace('T', ' ')} WIB`,
    `**User**: ${userCfg.displayName || 'Rian Iskandar'} · **Today**: ${today}`,
    '',
  ]

  if (currentSprint) {
    const daysStr = daysLeft !== null ? ` · **${daysLeft} days left**` : ''
    lines.push(`## Sprint Aktif`)
    lines.push(`**${currentSprint.name}** | ${currentSprint.startDate} → ${currentSprint.endDate}${daysStr}`)
    lines.push(`Progress: **${sprintClosed.length}/${sprintTotal} tasks done (${sprintPct}%)**`)
    if (sprintOpen.length > 0) {
      lines.push(''); lines.push('**Open tasks in sprint:**')
      sprintOpen.slice(0, 8).forEach(t => lines.push(`- #${t.id} ${t.subject} _(${t.status ?? 'unknown'})_`))
    }
    lines.push('')
  } else {
    lines.push(`## Sprint`); lines.push('_Tidak ada sprint aktif._'); lines.push('')
  }

  lines.push(`## Aktivitas Hari Ini`)
  if (todaySessions.length > 0) {
    lines.push(`${todaySessions.length} session · total **${todayMins}m** logged`)
    todaySessions.forEach(s => {
      const dur = s.actualMins ?? s.estimatedMins ?? 0
      lines.push(`- ${s.title}${s.opTaskId ? ` → OP #${s.opTaskId}` : ''} _(${dur}m)_`)
    })
  } else {
    lines.push('_Belum ada session hari ini._')
  }
  lines.push('')

  lines.push(`## Push Queue (${pendingSessions.length} pending)`)
  if (pendingSessions.length > 0) {
    pendingSessions.slice(0, 5).forEach(s =>
      lines.push(`- **${s.date}** ${s.title} _(${s.estimatedMins}m)_`))
    if (pendingSessions.length > 5) lines.push(`- _...dan ${pendingSessions.length - 5} lagi_`)
  } else {
    lines.push('_Push queue kosong._')
  }
  lines.push('')

  const activeHub = hubSessions.filter(s => s.pushStatus === 'hub')
  const hubKb = kbEntries.filter(e => e.triageStatus === 'hub')
  lines.push(`## Daily Hub (${activeHub.length} sessions, ${hubKb.length} KB entries)`)
  if (activeHub.length > 0)
    activeHub.slice(0, 5).forEach(s => lines.push(`- **${s.date}** ${s.title}`))
  lines.push('')

  lines.push(`## Incoming OP Tasks (${incoming.length} active)`)
  if (incoming.length > 0)
    incoming.forEach(t => lines.push(`- #${t.id} ${t.subject} _(${t.islStatus ?? t.status ?? 'new'})_`))
  else
    lines.push('_Tidak ada incoming tasks._')
  lines.push('')

  lines.push(`## Research & Work Sessions (7 hari terakhir)`)
  if (recentPushed.length > 0) {
    const byDate: Record<string, typeof recentPushed> = {}
    for (const s of recentPushed) { if (!byDate[s.date]) byDate[s.date] = []; byDate[s.date].push(s) }
    Object.entries(byDate).sort((a, b) => b[0].localeCompare(a[0])).forEach(([date, sessions]) => {
      lines.push(`**${date}**`)
      sessions.forEach(s => {
        const dur = s.actualMins ?? s.estimatedMins ?? 0
        lines.push(`- ${s.title}${s.opTaskId ? ` [#${s.opTaskId}]` : ''} _(${dur}m)_`)
      })
    })
  } else {
    lines.push('_Tidak ada session dalam 7 hari terakhir._')
  }
  lines.push('')

  if (backlog.length > 0) {
    lines.push(`## Backlog OP (tanpa sprint, ${backlog.length} tasks)`)
    backlog.forEach(t => lines.push(`- #${t.id} ${t.subject}`))
    lines.push('')
  }

  lines.push('---')
  lines.push('_Context ini di-generate otomatis dari ISL. Jalankan `npm run context` untuk refresh._')

  const markdown = lines.join('\n')
  fs.writeFileSync(OUT_FILE, markdown, 'utf-8')
  console.log(`✅ CLAUDE.md written → ${OUT_FILE}`)
  console.log(`   ${markdown.split('\n').length} lines, ${allSessions.length} sessions total`)
  process.exit(0)
}

main().catch(e => { console.error('❌', e); process.exit(1) })
