import { NextResponse } from 'next/server'
import { and, eq, gte } from 'drizzle-orm'
import { db, sessions, agentEvents, arkaCorrections } from '@/lib/db'
import { getRequestContext } from '@/lib/request-auth'
import { OWNER_UID } from '@/lib/auth'
import { callLLM, getLLMConfig } from '@/lib/llm'
import { callLocalLLM } from '@/lib/local-llm'

export const runtime = 'nodejs'

// Detailed "what actually happened today" narrative for the Aryo Report PDF
// (launcher-dashboard), which previously only showed terse counts (N sesi,
// N task terbuka) with zero process detail. Pulls the richer, currently-unused
// data — agentEvents, session bullets, arkaCorrections — and asks an LLM to
// narrate it. Local-first (Ollama), same pattern as app/api/wrapup/route.ts.
const NARRATIVE_FORMAT = {
  type: 'object',
  properties: {
    agentNarrative:     { type: 'string' },
    localWorkNarrative: { type: 'string' },
  },
  required: ['agentNarrative', 'localWorkNarrative'],
} as const

interface AgendaItem { title: string; startTime: string; project: string }

export async function GET(req: Request) {
  const ctx = await getRequestContext()
  const machineAuth = req.headers.get('x-kafi-key') === (process.env.KAFI_API_KEY || 'kafi-bridge-2026')
  if (!ctx && !machineAuth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const uid = ctx?.uid ?? (machineAuth ? OWNER_UID : null)

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const [todayEvents, todaySessions, todayCorrections] = await Promise.all([
    db.select().from(agentEvents).where(gte(agentEvents.createdAt, todayStart)),
    uid != null
      ? db.select().from(sessions).where(and(eq(sessions.userId, uid), gte(sessions.createdAt, todayStart)))
      : db.select().from(sessions).where(gte(sessions.createdAt, todayStart)),
    db.select().from(arkaCorrections).where(gte(arkaCorrections.createdAt, todayStart)),
  ])

  // Agenda: OP meetings in the next 7 days.
  let agenda: AgendaItem[] = []
  try {
    const OP_TOKEN = ctx?.opToken || process.env.OP_API_TOKEN || ''
    const OP_BASE  = ctx?.opBaseUrl || process.env.OP_BASE_URL || ''
    if (OP_TOKEN && OP_BASE) {
      const auth = 'Basic ' + Buffer.from(`apikey:${OP_TOKEN}`).toString('base64')
      const res = await fetch(`${OP_BASE}/api/v3/meetings?pageSize=20&sortBy=%5B%5B%22startTime%22%2C%22asc%22%5D%5D`, { headers: { Authorization: auth } })
      if (res.ok) {
        const data = await res.json()
        const now = Date.now(), weekAhead = now + 7 * 24 * 60 * 60 * 1000
        agenda = ((data._embedded?.elements ?? []) as { title: string; startTime: string; _links?: { project?: { title?: string } } }[])
          .filter(m => { const t = new Date(m.startTime).getTime(); return t >= now && t <= weekAhead })
          .slice(0, 10)
          .map(m => ({ title: m.title, startTime: m.startTime, project: m._links?.project?.title ?? '' }))
      }
    }
  } catch { /* agenda is best-effort — report still works without it */ }

  if (!todayEvents.length && !todaySessions.length && !todayCorrections.length) {
    return NextResponse.json({
      agentNarrative:     'Belum ada aktivitas agent tercatat hari ini.',
      localWorkNarrative: 'Belum ada aktivitas kerja lokal tercatat hari ini.',
      agenda,
    })
  }

  const eventsByAgent: Record<string, string[]> = {}
  for (const e of todayEvents) {
    (eventsByAgent[e.agent] ??= []).push(`${e.event}${e.meta && Object.keys(e.meta).length ? ' ' + JSON.stringify(e.meta) : ''}`)
  }
  const eventLines = Object.entries(eventsByAgent).map(([agent, evs]) => `${agent}: ${evs.join(', ')}`).join('\n')
  const sessionLines = todaySessions.map(s =>
    `- [${s.source ?? 'unknown'}] ${s.title} (${s.pushStatus})${s.bullets?.length ? ': ' + s.bullets.slice(0, 3).join('; ') : ''}`
  ).join('\n')
  const correctionLines = todayCorrections.map(c =>
    `- "${c.sessionTitle}": Arka tebak #${c.arkaGuessTaskId ?? 'hub'}, dikoreksi Rian ke #${c.correctedTaskId}`
  ).join('\n')

  const prompt = `Kamu adalah Aryo, agent manager yang merangkum aktivitas tim AI ISL untuk Rian (pemilik). Tulis dalam Bahasa Indonesia, natural dan detail (bukan poin generik atau angka doang), berdasarkan data mentah di bawah.

Log event agent hari ini (arka=session recorder, luna=hub curator, rendi=sprint guard, dira=timekeeper, kafi=field agent, sage=AI news):
${eventLines || '(tidak ada event tercatat)'}

Sesi kerja hari ini (dari hook lokal Kafi / input manual Rian):
${sessionLines || '(tidak ada sesi tercatat)'}

Koreksi Arka hari ini (tebakan task yang dibetulkan Rian saat triage):
${correctionLines || '(tidak ada koreksi)'}

Tulis dua bagian:
1. Narasi agent: jelaskan APA YANG SEBENARNYA DIKERJAKAN oleh agent-agent ISL hari ini berdasarkan data di atas — proses dan konteksnya, bukan cuma angka. Agent yang datanya kosong, sebut singkat idle.
2. Narasi lokal: rangkum apa yang benar-benar Rian kerjakan secara lokal hari ini dari sesi kerja di atas, termasuk konteks/detail penting, bukan cuma judul.`

  const localRaw = await callLocalLLM(prompt, NARRATIVE_FORMAT)
  if (localRaw) {
    try {
      const j = JSON.parse(localRaw) as { agentNarrative?: unknown; localWorkNarrative?: unknown }
      const agentNarrative = typeof j.agentNarrative === 'string' ? j.agentNarrative.trim() : ''
      const localWorkNarrative = typeof j.localWorkNarrative === 'string' ? j.localWorkNarrative.trim() : ''
      if (agentNarrative && localWorkNarrative) {
        return NextResponse.json({ agentNarrative, localWorkNarrative, agenda })
      }
    } catch { /* invalid JSON → fallback Claude */ }
  }

  const llmCfg = getLLMConfig()
  if (!llmCfg) {
    return NextResponse.json({
      agentNarrative:     eventLines || 'Belum ada aktivitas agent tercatat.',
      localWorkNarrative: sessionLines || 'Belum ada aktivitas kerja lokal tercatat.',
      agenda,
    })
  }
  const text = await callLLM(
    `${prompt}\n\nFormat balasan (dua bagian, jangan pakai JSON):\n### AGENT\n<narasi agent di sini>\n\n### LOKAL\n<narasi lokal di sini>`,
    llmCfg,
  )
  const agentMatch = text.match(/### AGENT\s*([\s\S]*?)(?=### LOKAL|$)/i)
  const localMatch = text.match(/### LOKAL\s*([\s\S]*)/i)
  return NextResponse.json({
    agentNarrative:     agentMatch?.[1]?.trim() || text,
    localWorkNarrative: localMatch?.[1]?.trim() || '',
    agenda,
  })
}
