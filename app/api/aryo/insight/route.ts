import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { callLLM, getLLMConfig } from '@/lib/llm'
import { loadCache } from '@/lib/op-cache'
import { getRequestContext } from '@/lib/request-auth'
import { getAllSessions, saveSession, createSessionId, type SessionLog } from '@/lib/session-store'
import { sendTelegram } from '@/lib/telegram'
import { OWNER_UID } from '@/lib/auth'

export const runtime = 'nodejs'
export const maxDuration = 300

// ── Aryo Insight — manager agent yang menganalisa sinyal operasional ISL ─────
// Suggest-only: usulan improvement berbasis bukti, TIDAK pernah eksekusi sendiri.
// Approval manual → jadi draft ticket di Push Queue (pushStatus 'pending').

const DATA_DIR      = process.env.CACHE_DATA_DIR ?? process.cwd()
const INSIGHTS_FILE = path.join(DATA_DIR, 'aryo-insights.json')
const LOG_DIR       = path.join(DATA_DIR, 'logs')

export interface AryoInsight {
  id: string
  title: string        // Indonesian, short
  finding: string      // Indonesian
  evidence: string     // numbers/facts from data
  impact: string       // Indonesian
  action: string       // Indonesian, concrete proposal
  ticketDraft: { subject: string; description: string }  // ENGLISH — goes to OP
  status: 'open' | 'approved' | 'dismissed'
}

interface InsightsFile {
  insights: AryoInsight[]
  generatedAt: string | null
}

function loadInsights(): InsightsFile {
  try {
    const raw = JSON.parse(fs.readFileSync(INSIGHTS_FILE, 'utf-8')) as Partial<InsightsFile>
    return { insights: Array.isArray(raw.insights) ? raw.insights : [], generatedAt: raw.generatedAt ?? null }
  } catch {
    return { insights: [], generatedAt: null }
  }
}

function saveInsights(data: InsightsFile) {
  fs.writeFileSync(INSIGHTS_FILE, JSON.stringify(data, null, 2), 'utf-8')
}

// ── Auth: browser session OR machine key (weekly cron calls headless) ────────
async function resolveAuth(req: NextRequest): Promise<{ uid: number } | null> {
  const key = process.env.KAFI_API_KEY || 'kafi-bridge-2026'
  const machineAuth =
    req.headers.get('x-kafi-key') === key ||
    new URL(req.url).searchParams.get('key') === key
  if (machineAuth) return { uid: OWNER_UID }

  const ctx = await getRequestContext()
  if (ctx) return { uid: ctx.uid }
  return null
}

// ── GET — saved insights ──────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await resolveAuth(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(loadInsights())
}

// ── Signal gathering (all best-effort — a missing signal never aborts) ───────
function daysBetween(iso: string, now: number): number {
  const t = new Date(iso).getTime()
  if (isNaN(t)) return 0
  return Math.floor((now - t) / 86_400_000)
}

async function gatherSignals(uid: number): Promise<string> {
  const now = Date.now()
  const lines: string[] = []

  // Sessions-derived signals (hub aging, pending queue, productivity)
  let sessions: SessionLog[] = []
  try { sessions = await getAllSessions(uid) } catch { /* skip */ }

  try {
    const hub = sessions.filter(s => s.pushStatus === 'hub')
    const aged = hub
      .map(s => ({ title: s.title, ageDays: daysBetween(s.createdAt, now) }))
      .filter(s => s.ageDays > 7)
      .sort((a, b) => b.ageDays - a.ageDays)
    lines.push(`HUB (sessions awaiting triage): ${hub.length} total, ${aged.length} older than 7 days`)
    for (const s of aged.slice(0, 10)) lines.push(`  - "${s.title}" — ${s.ageDays} days old`)
  } catch { /* skip */ }

  try {
    const pending = sessions.filter(s => s.pushStatus === 'pending')
    const oldest = pending.reduce((max, s) => Math.max(max, daysBetween(s.createdAt, now)), 0)
    lines.push(`PUSH QUEUE (pending approval to OP): ${pending.length} sessions, oldest ${oldest} days`)
  } catch { /* skip */ }

  try {
    const cache = loadCache(uid)
    const syncAgeH = cache.lastSync ? Math.round((now - new Date(cache.lastSync).getTime()) / 3_600_000) : null
    lines.push(`OPEN OP TASKS: ${cache.myOpenTasks.length} mine, ${cache.incomingTasks.length} incoming, cache last synced ${syncAgeH === null ? 'never' : `${syncAgeH}h ago`}`)
  } catch { /* skip */ }

  // Error logs — last 3 days of isl-*.log (winston JSON lines)
  try {
    let errorCount = 0
    const samples = new Set<string>()
    for (let i = 0; i < 3; i++) {
      const date = new Date(now - i * 86_400_000).toISOString().slice(0, 10)
      const file = path.join(LOG_DIR, `isl-${date}.log`)
      let content = ''
      try { content = fs.readFileSync(file, 'utf-8') } catch { continue }
      for (const line of content.split('\n')) {
        if (!line.includes('"level":"error"')) continue
        errorCount++
        try {
          const parsed = JSON.parse(line) as { message?: string }
          if (parsed.message && samples.size < 5) samples.add(String(parsed.message).slice(0, 160))
        } catch { /* unparseable line — count only */ }
      }
    }
    lines.push(`ERROR LOGS (last 3 days): ${errorCount} error entries`)
    for (const m of samples) lines.push(`  - sample: ${m}`)
  } catch { /* skip */ }

  // Productivity — sessions created per day, last 7 days
  try {
    const perDay: string[] = []
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now - i * 86_400_000).toISOString().slice(0, 10)
      const count = sessions.filter(s => s.date === date).length
      perDay.push(`${date}: ${count}`)
    }
    lines.push(`PRODUCTIVITY (sessions created per day, last 7 days): ${perDay.join(', ')}`)
  } catch { /* skip */ }

  return lines.join('\n')
}

// ── POST — run analysis, save insights, notify via Telegram ─────────────────
export async function POST(req: NextRequest) {
  const auth = await resolveAuth(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try { // outer guard — always return JSON
    const signals = await gatherSignals(auth.uid)

    const prompt = `Kamu Aryo, manager agent ISL (Integrity Sprint Log). Analisa sinyal operasional berikut. Usulkan MAKSIMAL 3 improvement — HANYA yang didukung bukti kuat dari data (ambang: masalah berulang, umur antrian >7 hari, error >=3x, tren memburuk). Kalau tidak ada yang memenuhi ambang, kembalikan [].
DILARANG saran generik tanpa bukti (contoh terlarang: 'tingkatkan dokumentasi/test coverage' tanpa data).

Field bahasa: title/finding/impact/action dalam Bahasa Indonesia. ticketDraft WAJIB English (masuk OpenProject).

Return ONLY valid JSON array, tanpa markdown fence, tanpa teks lain:
[{"title":"...(ID, singkat)","finding":"...(ID)","evidence":"...(angka/fakta dari data)","impact":"...(ID, dampak bila dibiarkan)","action":"...(ID, usulan konkret)","ticketDraft":{"subject":"...(ENGLISH, max 70 chars)","description":"...(ENGLISH, 3-6 bullet lines)"}}]

OPERATIONAL SIGNALS (data in English):
${signals}`

    const llmCfg = getLLMConfig() ?? { provider: 'claude-cli' as const, apiKey: '', model: 'claude' }
    const raw = await callLLM(prompt, llmCfg)

    // Parse — grab the outermost JSON array; LLM may wrap with prose/fences.
    const match = raw.match(/\[[\s\S]*\]/)
    let parsed: unknown = []
    if (match) {
      try { parsed = JSON.parse(match[0]) } catch { parsed = [] }
    }
    const items = (Array.isArray(parsed) ? parsed : []) as Partial<AryoInsight>[]

    const ts = Date.now()
    const insights: AryoInsight[] = items
      .filter(i => i && typeof i.title === 'string' && i.ticketDraft?.subject)
      .slice(0, 3)
      .map((i, idx) => ({
        id:          `ins-${ts}-${idx}`,
        title:       String(i.title),
        finding:     String(i.finding ?? ''),
        evidence:    String(i.evidence ?? ''),
        impact:      String(i.impact ?? ''),
        action:      String(i.action ?? ''),
        ticketDraft: {
          subject:     String(i.ticketDraft!.subject).slice(0, 70),
          description: String(i.ticketDraft!.description ?? ''),
        },
        status: 'open' as const,
      }))

    saveInsights({ insights, generatedAt: new Date().toISOString() })

    if (insights.length > 0) {
      // Fire-and-forget — notif gagal tidak boleh mengganggu hasil analisa.
      sendTelegram(
        `👔 <b>Aryo</b> — ${insights.length} usulan improvement\n` +
        insights.map(i => `  › ${i.title}`).join('\n') +
        `\n\n<i>Review di ISL → Sprint → Agenda</i>`
      ).catch(() => {})
    }

    return NextResponse.json({ ok: true, count: insights.length, insights })
  } catch (e) {
    console.error('[aryo-insight] error:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// ── PATCH — approve (→ Push Queue draft) or dismiss an insight ───────────────
export async function PATCH(req: NextRequest) {
  const auth = await resolveAuth(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { id, action } = (await req.json()) as { id?: string; action?: string }
    if (!id || (action !== 'approve' && action !== 'dismiss')) {
      return NextResponse.json({ error: 'Body harus { id, action: "approve" | "dismiss" }' }, { status: 400 })
    }

    const data = loadInsights()
    const insight = data.insights.find(i => i.id === id)
    if (!insight) return NextResponse.json({ error: `Insight ${id} tidak ditemukan` }, { status: 404 })

    if (action === 'dismiss') {
      insight.status = 'dismissed'
      saveInsights(data)
      return NextResponse.json({ ok: true })
    }

    // approve → draft ticket masuk Push Queue (pending) — user tetap approve
    // sekali lagi di Push Queue sebelum benar-benar dipush ke OP.
    const now   = new Date().toISOString()
    const today = now.slice(0, 10)
    const session: SessionLog = {
      id:               createSessionId(),
      sessionId:        `aryo-ins-${insight.id}`,
      userId:           OWNER_UID,
      date:             today,
      title:            insight.ticketDraft.subject,
      bullets:          insight.ticketDraft.description.split('\n').map(s => s.trim()).filter(Boolean),
      source:           'aryo',
      startedAt:        now,
      endedAt:          now,
      actualMins:       null,
      estimatedMins:    60,
      opTaskId:         null,
      opStoryId:        null,
      opEpicId:         null,
      isNewTask:        true,
      taskStatus:       'in_progress',
      aiStatus:         null,
      hasExplicitCmd:   false,
      needsValidation:  false,
      command:          null,
      ticketBinding:    null,
      relatedOldTaskId: null,
      tokenUsage:       null,
      pushStatus:       'pending',
      autoPushed:       false,
      undoneAt:         null,
      createdAt:        now,
      updatedAt:        now,
    }
    await saveSession(session)

    insight.status = 'approved'
    saveInsights(data)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[aryo-insight] PATCH error:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
