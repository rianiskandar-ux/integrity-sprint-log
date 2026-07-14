import { NextRequest, NextResponse } from 'next/server'
import { loadCache, type CachedWorkPackage } from '@/lib/op-cache'
import { getRequestContext } from '@/lib/request-auth'
import { getAllSessions, type SessionLog } from '@/lib/session-store'
import { OWNER_UID } from '@/lib/auth'
import { db, agentEvents } from '@/lib/db'

export const runtime = 'nodejs'
export const maxDuration = 300

// ── Luna Triage Suggestion — saran label triage per sesi Daily Hub ──────────
// Suggest-only: keputusan tetap 100% manual di user (hard rule). Luna hanya
// menempel chip saran; tombol triage yang ada tetap satu-satunya jalur aksi.
// Otak: Ollama lokal (qwen2.5:3b) dengan constrained decoding (format = full
// JSON Schema — format:'json' saja TIDAK cukup, model 3B meratakan skema).
// Ollama gagal/invalid → saran 'keep' (low-stakes, TANPA fallback Claude).

type Suggestion = 'push_existing' | 'new_task' | 'delete' | 'keep'
type Confidence = 'high' | 'medium' | 'low'

export interface TriageSuggestion {
  sessionId: string
  title: string
  ageDays: number
  suggestion: Suggestion
  opTaskId: number | null
  confidence: Confidence
  reason: string
}

const SUGGESTIONS: ReadonlySet<string> = new Set(['push_existing', 'new_task', 'delete', 'keep'])
const CONFIDENCES: ReadonlySet<string> = new Set(['high', 'medium', 'low'])

// Constrained decoding schema — WAJIB full JSON Schema object (teknik terbukti)
const LUNA_FORMAT = {
  type: 'object',
  properties: {
    suggestion: { type: 'string', enum: ['push_existing', 'new_task', 'delete', 'keep'] },
    opTaskId:   { type: ['integer', 'null'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reason:     { type: 'string' },
  },
  required: ['suggestion', 'opTaskId', 'confidence', 'reason'],
} as const

// ── Auth: browser session OR machine key (sama dengan aryo/insight) ──────────
async function resolveAuth(req: NextRequest): Promise<{ uid: number } | null> {
  const key = process.env.KAFI_API_KEY
  const machineAuth =
    req.headers.get('x-kafi-key') === key ||
    new URL(req.url).searchParams.get('key') === key
  if (machineAuth) return { uid: OWNER_UID }

  const ctx = await getRequestContext()
  if (ctx) return { uid: ctx.uid }
  return null
}

// ── Cheap JS relevance: word overlap task subject vs session title+bullets ───
const STOPWORDS: ReadonlySet<string> = new Set([
  'yang', 'untuk', 'dari', 'dengan', 'dan', 'atau', 'ini', 'itu', 'pada', 'sudah', 'belum',
  'the', 'and', 'for', 'with', 'from', 'into', 'via', 'per', 'all', 'new',
])

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !STOPWORDS.has(w))
}

function pickCandidates(session: SessionLog, tasks: CachedWorkPackage[], limit = 8): CachedWorkPackage[] {
  const sessionWords = new Set(tokenize([session.title, ...session.bullets].join(' ')))
  return tasks
    .map(t => {
      const words = tokenize(t.subject)
      const score = words.reduce((n, w) => n + (sessionWords.has(w) ? 1 : 0), 0)
      return { t, score }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.t)
}

// ── Ollama call — constrained decoding, 60s timeout, temperature 0.2 ─────────
async function callLuna(prompt: string): Promise<Record<string, unknown> | null> {
  const base  = process.env.OLLAMA_URL || 'http://localhost:11434'
  const model = process.env.OLLAMA_CHAT_MODEL || 'qwen2.5:3b'
  try {
    const res = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model, prompt, stream: false,
        format: LUNA_FORMAT,
        options: { temperature: 0.2, num_ctx: 8192 },
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) return null
    const d = await res.json() as { response?: string }
    const raw = (d.response ?? '').trim()
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function ageDaysOf(session: SessionLog, now: number): number {
  const t = new Date(session.createdAt).getTime()
  if (isNaN(t)) return 0
  return Math.max(0, Math.floor((now - t) / 86_400_000))
}

function buildPrompt(session: SessionLog, ageDays: number, candidates: CachedWorkPackage[]): string {
  const bullets = session.bullets.length
    ? session.bullets.map(b => `- ${b}`).join('\n')
    : '(tidak ada poin)'
  const tasks = candidates.length
    ? candidates.map(t => `- id ${t.id} | ${t.subject} | status: ${t.status || '?'}`).join('\n')
    : '(tidak ada kandidat task)'

  return `Kamu Luna, asisten triage ISL (Integrity Sprint Log). Sarankan SATU label triage untuk sesi kerja di Daily Hub berikut. Keputusan tetap 100% di user — kamu hanya memberi saran.

SESI:
Judul: ${session.title}
Umur: ${ageDays} hari
Poin:
${bullets}

KANDIDAT TASK OPENPROJECT (opTaskId HANYA boleh dari daftar ini):
${tasks}

ATURAN:
- "push_existing" HANYA jika sesi jelas cocok dengan salah satu kandidat → set opTaskId ke id kandidat itu.
- "new_task" jika ini kerjaan nyata tapi tidak ada task yang cocok → opTaskId null.
- "delete" jika sesi cuma test/obrolan iseng/duplikat tanpa nilai → opTaskId null.
- "keep" jika ragu → opTaskId null.
- Sesi berumur lebih dari 14 hari tanpa nilai jelas → condong "delete".
- "reason": Bahasa Indonesia, singkat (1 kalimat).`
}

// ── Durable event log (Scorecard) — fire-and-forget, never blocks the route ──
function logEvent(agent: string, event: string, meta?: Record<string, unknown>) {
  db.insert(agentEvents).values({
    id:    `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    agent, event,
    meta:  meta ?? null,
  }).catch(() => {})
}

function fallbackSuggestion(session: SessionLog, ageDays: number, reason: string): TriageSuggestion {
  return {
    sessionId: session.id,
    title: session.title,
    ageDays,
    suggestion: 'keep',
    opTaskId: null,
    confidence: 'low',
    reason,
  }
}

async function suggestFor(session: SessionLog, tasks: CachedWorkPackage[], now: number): Promise<TriageSuggestion> {
  const ageDays = ageDaysOf(session, now)
  const candidates = pickCandidates(session, tasks)
  const raw = await callLuna(buildPrompt(session, ageDays, candidates))
  if (!raw || typeof raw.suggestion !== 'string' || !SUGGESTIONS.has(raw.suggestion)) {
    return fallbackSuggestion(session, ageDays, 'Ollama tidak tersedia')
  }

  let suggestion = raw.suggestion as Suggestion
  let opTaskId: number | null =
    typeof raw.opTaskId === 'number' && Number.isFinite(raw.opTaskId) ? Math.trunc(raw.opTaskId) : null
  const confidence: Confidence =
    typeof raw.confidence === 'string' && CONFIDENCES.has(raw.confidence) ? raw.confidence as Confidence : 'low'
  let reason = typeof raw.reason === 'string' && raw.reason.trim() ? raw.reason.trim() : 'Tanpa alasan dari model'

  // push_existing wajib menunjuk salah satu kandidat — kalau tidak, turunkan ke keep
  const candidateIds = new Set(candidates.map(t => t.id))
  if (suggestion === 'push_existing' && (opTaskId === null || !candidateIds.has(opTaskId))) {
    suggestion = 'keep'
    opTaskId = null
    reason = `Model menyarankan push tanpa task valid — dibiarkan. (${reason})`
  }
  if (suggestion !== 'push_existing') opTaskId = null

  return { sessionId: session.id, title: session.title, ageDays, suggestion, opTaskId, confidence, reason }
}

// ── POST — hitung saran on demand, tanpa persistence ─────────────────────────
export async function POST(req: NextRequest) {
  const auth = await resolveAuth(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    let sessionId: string | undefined
    try {
      const body = await req.json() as { sessionId?: string }
      if (body && typeof body.sessionId === 'string') sessionId = body.sessionId
    } catch { /* body optional */ }

    const all = await getAllSessions(auth.uid)
    let targets: SessionLog[]
    if (sessionId) {
      targets = all.filter(s => s.id === sessionId)
      if (!targets.length) {
        return NextResponse.json({ error: `Session ${sessionId} tidak ditemukan` }, { status: 404 })
      }
    } else {
      targets = all
        .filter(s => s.pushStatus === 'hub')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))  // oldest first
        .slice(0, 25)
    }

    const tasks = loadCache(auth.uid).myOpenTasks
    const now = Date.now()

    // Sequential — Ollama lokal 3B, satu request per waktu lebih stabil
    const suggestions: TriageSuggestion[] = []
    for (const session of targets) {
      const suggestion = await suggestFor(session, tasks, now)
      suggestions.push(suggestion)
      logEvent('luna', 'suggestion_made', { suggestion: suggestion.suggestion, sessionId: suggestion.sessionId })
    }

    return NextResponse.json({ ok: true, count: suggestions.length, suggestions })
  } catch (e) {
    console.error('[luna-triage] error:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
