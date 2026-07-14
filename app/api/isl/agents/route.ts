import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sessions, agentLogs, cases, events } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { getTimer } from '@/lib/work-timer'
import { OWNER_UID, isOwnerUid } from '@/lib/auth'
import { getRequestContext } from '@/lib/request-auth'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'

type AgentStatus = 'active' | 'idle' | 'issue'

interface Agent {
  id: string
  name: string
  role: string
  description: string
  status: AgentStatus
  statusText: string
  detail: string | null
  lastActive: string | null
  meta?: Record<string, unknown>
}

const DATA_DIR = process.env.CACHE_DATA_DIR ?? process.cwd()

function readJSON<T>(file: string): T | null {
  try {
    const p = join(DATA_DIR, file)
    if (!existsSync(p)) return null
    return JSON.parse(readFileSync(p, 'utf-8')) as T
  } catch { return null }
}

function minutesAgo(iso: string): number {
  return Math.round((Date.now() - new Date(iso).getTime()) / 60000)
}

function fmtAgo(mins: number): string {
  if (mins < 1)  return 'baru saja'
  if (mins < 60) return `${mins} menit lalu`
  const h = Math.floor(mins / 60), m = mins % 60
  return h > 0 ? (m > 0 ? `${h}j ${m}m lalu` : `${h}j lalu`) : `${m}m lalu`
}

export async function GET(req: Request) {
  // This dashboard aggregates OWNER-scoped agent status (owner's cache/timer +
  // today's sessions across sources) — owner tooling. Reachable by: the owner's
  // own session, or the cross-app Launcher Aryo report via machine key. Any
  // other logged-in teammate or unauthenticated LAN caller is refused.
  const machineAuth = req.headers.get('x-kafi-key') === (process.env.KAFI_API_KEY)
  if (!machineAuth && !isOwnerUid((await getRequestContext())?.uid)) {
    return NextResponse.json({ error: 'Owner only' }, { status: 403 })
  }
  const today = new Date().toISOString().slice(0, 10)
  const agents: Agent[] = []

  // ── Arka — Session Recorder ────────────────────────────────────────────────
  try {
    const todaySessions = await db.select()
      .from(sessions)
      .where(and(eq(sessions.date, today)))

    const processed = readJSON<{ sessions: string[] }>('processed-sessions.json')
    const lastId    = processed?.sessions?.at(-1)

    // Find lastActive from most recent session today
    const latestSession = todaySessions
      .sort((a, b) => (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0))[0]

    const countToday = todaySessions.filter(s => s.pushStatus !== 'discarded').length
    const lastMins   = latestSession?.createdAt ? minutesAgo(latestSession.createdAt.toISOString()) : null

    let status: AgentStatus = 'idle'
    let statusText = 'Standby'
    let detail = `${countToday} sesi hari ini`

    if (countToday > 0 && lastMins !== null && lastMins < 60) {
      status = 'active'; statusText = 'Aktif'
      detail = `${countToday} sesi · terakhir ${fmtAgo(lastMins)}`
    } else if (countToday > 0) {
      status = 'idle'; statusText = 'Idle'
      detail = `${countToday} sesi hari ini · ${lastMins ? fmtAgo(lastMins) : '—'}`
    } else {
      status = 'idle'; statusText = 'Idle'
      detail = 'Belum ada sesi hari ini'
    }

    agents.push({
      id: 'arka', name: 'Arka', role: 'Session Recorder',
      description: 'Merekam semua sesi kerja Claude ke ISL Hub',
      status, statusText, detail,
      lastActive: latestSession?.createdAt?.toISOString() ?? null,
    })
  } catch {
    agents.push({
      id: 'arka', name: 'Arka', role: 'Session Recorder',
      description: 'Merekam semua sesi kerja Claude ke ISL Hub',
      status: 'issue', statusText: 'Error', detail: 'Tidak bisa baca data sesi', lastActive: null,
    })
  }

  // ── Rendi — Sprint Guard ───────────────────────────────────────────────────
  try {
    const cache = readJSON<{ lastSync?: string; myOpenTasks?: unknown[]; sprints?: { isCurrent?: boolean; name?: string }[] }>(`op-cache-${OWNER_UID}.json`)
    const lastUpdated = cache?.lastSync ?? null
    const openCount   = cache?.myOpenTasks?.length ?? 0
    const sprint      = cache?.sprints?.find(s => s.isCurrent)

    let status: AgentStatus = 'idle'
    let statusText = 'Standby'
    let detail = 'Cache OP tidak tersedia'

    if (!cache || !lastUpdated) {
      status = 'issue'; statusText = 'Issue'
      detail = 'OP cache kosong — belum pernah sync'
    } else {
      const mins = minutesAgo(lastUpdated)
      if (mins < 60) {
        status = 'active'; statusText = 'Aktif'
      } else if (mins < 240) {
        status = 'idle'; statusText = 'Idle'
      } else {
        status = 'issue'; statusText = 'Issue'
      }
      const sprintLabel = sprint?.name ? ` · ${sprint.name}` : ''
      detail = `${openCount} task terbuka${sprintLabel} · sync ${fmtAgo(mins)}`
    }

    agents.push({
      id: 'rendi', name: 'Rendi', role: 'Sprint Guard',
      description: 'Pantau sprint progress & sinkronisasi data OP',
      status, statusText, detail,
      lastActive: lastUpdated,
    })
  } catch {
    agents.push({
      id: 'rendi', name: 'Rendi', role: 'Sprint Guard',
      description: 'Pantau sprint progress & sinkronisasi data OP',
      status: 'issue', statusText: 'Error', detail: 'Gagal baca op-cache', lastActive: null,
    })
  }

  // ── Dira — Timekeeper ─────────────────────────────────────────────────────
  try {
    const timer = getTimer(OWNER_UID)

    let status: AgentStatus = 'idle'
    let statusText = 'Idle'
    let detail = 'Tidak ada timer aktif'
    let lastActive: string | null = null

    if (timer) {
      lastActive = timer.startedAt
      const elapsedMs  = timer.accumulatedMs + (timer.paused ? 0 : Date.now() - new Date(timer.startedAt).getTime())
      const elapsedMin = Math.floor(elapsedMs / 60000)
      const h = Math.floor(elapsedMin / 60), m = elapsedMin % 60
      const elapsed = h > 0 ? `${h}j ${m}m` : `${m}m`

      if (timer.paused) {
        status = 'idle'; statusText = 'Paused'
        detail = `⏸ ${elapsed} · ${timer.taskTitle}`
        if (timer.opTaskId) detail += ` · #${timer.opTaskId}`
      } else if (elapsedMin > 600) {
        status = 'issue'; statusText = 'Mungkin lupa stop'
        detail = `⚠️ ${elapsed} berjalan · ${timer.taskTitle}`
      } else {
        status = 'active'; statusText = 'Timer berjalan'
        detail = `⏱ ${elapsed} · ${timer.taskTitle}`
        if (timer.opTaskId) detail += ` · #${timer.opTaskId}`
      }
    }

    agents.push({
      id: 'dira', name: 'Dira', role: 'Timekeeper',
      description: 'Catat waktu kerja & auto-push time entry ke OP',
      status, statusText, detail, lastActive,
    })
  } catch {
    agents.push({
      id: 'dira', name: 'Dira', role: 'Timekeeper',
      description: 'Catat waktu kerja & auto-push time entry ke OP',
      status: 'issue', statusText: 'Error', detail: 'Tidak bisa baca timer', lastActive: null,
    })
  }

  // ── Luna — Hub Curator ────────────────────────────────────────────────────
  try {
    const hubSessions = await db.select()
      .from(sessions)
      .where(eq(sessions.pushStatus, 'hub'))

    const sorted  = hubSessions.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())
    const count   = sorted.length
    const oldest  = sorted[0]

    let status: AgentStatus = 'active'
    let statusText = 'Bersih'
    let detail = 'Hub kosong — semua sesi sudah di-triage'
    const lastActive = oldest?.startedAt ?? null

    if (count === 0) {
      status = 'active'; statusText = 'Bersih'
    } else {
      const oldestMins = oldest?.startedAt ? minutesAgo(oldest.startedAt) : 0
      const oldestDays = Math.floor(oldestMins / 1440)

      if (oldestDays >= 3) {
        status = 'issue'; statusText = 'Perlu perhatian'
        detail = `${count} sesi menunggu · terlama ${oldestDays} hari lalu`
      } else {
        status = 'idle'; statusText = 'Ada antrian'
        detail = `${count} sesi menunggu triage`
      }
    }

    const pendingSessions = sorted.map(s => {
      const ageMins  = minutesAgo(s.startedAt)
      const ageDays  = Math.floor(ageMins / 1440)
      const ageLabel = ageDays >= 1 ? `${ageDays} hari lalu` : fmtAgo(ageMins)
      return {
        id:         s.id,
        title:      s.title,
        date:       s.date,
        ageLabel,
        opTaskId:   s.opTaskId ?? null,
        taskStatus: s.taskStatus ?? null,
      }
    })

    agents.push({
      id: 'luna', name: 'Luna', role: 'Hub Curator',
      description: 'Kelola antrian sesi di Daily Hub untuk triage',
      status, statusText, detail, lastActive,
      meta: count > 0 ? { pendingSessions } : undefined,
    })
  } catch {
    agents.push({
      id: 'luna', name: 'Luna', role: 'Hub Curator',
      description: 'Kelola antrian sesi di Daily Hub untuk triage',
      status: 'issue', statusText: 'Error', detail: 'Tidak bisa query hub', lastActive: null,
    })
  }

  // ── Kafi — Field Agent (external bridge) ─────────────────────────────────
  try {
    const todayKafiSessions = await db.select()
      .from(sessions)
      .where(and(eq(sessions.date, today), eq(sessions.source, 'kafi')))
      .orderBy(desc(sessions.createdAt))
      .limit(1)

    const lastKafi   = todayKafiSessions[0] ?? null
    const lastMinsK  = lastKafi?.createdAt ? minutesAgo(lastKafi.createdAt.toISOString()) : null
    const countKafi  = await db.select()
      .from(sessions)
      .where(and(eq(sessions.date, today), eq(sessions.source, 'kafi')))
      .then(r => r.length)

    let status: AgentStatus = 'idle'
    let statusText = 'Standby'
    let detail = 'Belum ada capture hari ini'

    if (countKafi > 0 && lastMinsK !== null && lastMinsK < 60) {
      status = 'active'; statusText = 'Aktif'
      detail = `${countKafi} capture hari ini · ${fmtAgo(lastMinsK)}`
    } else if (countKafi > 0) {
      status = 'idle'; statusText = 'Idle'
      detail = `${countKafi} capture hari ini · ${lastMinsK ? fmtAgo(lastMinsK) : '—'}`
    }

    agents.push({
      id: 'kafi', name: 'Kafi', role: 'Field Agent',
      description: 'Capture aktivitas Claude Code luar ISL → kirim ke Arka via Hub',
      status, statusText, detail,
      lastActive: lastKafi?.createdAt?.toISOString() ?? null,
    })
  } catch {
    agents.push({
      id: 'kafi', name: 'Kafi', role: 'Field Agent',
      description: 'Capture aktivitas Claude Code luar ISL → kirim ke Arka via Hub',
      status: 'idle', statusText: 'Standby', detail: 'Belum ada data capture', lastActive: null,
    })
  }

  // ── Log ke DB (fire & forget) ─────────────────────────────────────────────
  const now = new Date()
  Promise.all([
    // agent_logs: satu baris per agent per poll
    ...agents.map(a => db.insert(agentLogs).values({
      id:        randomUUID(),
      userId:    OWNER_UID,
      agentId:   a.id,
      agentName: a.name,
      action:    'status_check',
      status:    a.status,
      detail:    a.detail,
      metadata:  { statusText: a.statusText, lastActive: a.lastActive },
      occurredAt: now,
    }).onConflictDoNothing()),

    // events: catat setiap status_check sebagai event
    db.insert(events).values({
      id:        randomUUID(),
      userId:    OWNER_UID,
      agentId:   'system',
      type:      'agent_poll',
      subject:   'ISL Agents status check',
      detail:    agents.map(a => `${a.name}:${a.status}`).join(' · '),
      occurredAt: now,
    }),

    // cases: auto-create kalau ada agent issue baru
    ...agents
      .filter(a => a.status === 'issue')
      .map(a => db.insert(cases).values({
        id:          randomUUID(),
        userId:      OWNER_UID,
        agentId:     a.id,
        title:       `[${a.name}] ${a.statusText}`,
        description: a.detail ?? undefined,
        severity:    a.id === 'luna' ? 'medium' : 'low',
        status:      'open',
        metadata:    { detectedAt: now.toISOString() },
        detectedAt:  now,
        updatedAt:   now,
      }).onConflictDoNothing()),
  ]).catch(() => {}) // non-fatal

  return NextResponse.json({ agents, fetchedAt: now.toISOString() })
}
