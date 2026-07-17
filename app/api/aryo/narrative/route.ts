import { NextResponse } from 'next/server'
import { and, eq, gte, lt } from 'drizzle-orm'
import { db, sessions, agentEvents, arkaCorrections } from '@/lib/db'
import { getRequestContext } from '@/lib/request-auth'
import { OWNER_UID } from '@/lib/auth'
import { callLLM, getLLMConfig } from '@/lib/llm'
import { callLocalLLM } from '@/lib/local-llm'
import { loadCache } from '@/lib/op-cache'

export const runtime = 'nodejs'

// Detailed "what actually happened today" narrative for the Aryo Report PDF
// (launcher-dashboard), which previously only showed terse counts (N sesi,
// N task terbuka) with zero process detail. Pulls the richer, currently-unused
// data — agentEvents, session bullets, arkaCorrections — and asks an LLM to
// narrate it. Local-first (Ollama), same pattern as app/api/wrapup/route.ts.
//
// standupNarrative (added 2026-07-17, Rian's request): a closing plain-
// sentence summary for the PDF's last section, written to be read out loud
// at TOMORROW MORNING's daily standup — "kemarin saya…, hari ini saya akan…,
// ke depan…" in language non-technical teammates follow. The PDF generates
// at 17:00 today, so "kemarin" (as spoken at the standup) = today's data.
const NARRATIVE_FORMAT = {
  type: 'object',
  properties: {
    agentNarrative:     { type: 'string' },
    localWorkNarrative: { type: 'string' },
    standupNarrative:   { type: 'string' },
  },
  required: ['agentNarrative', 'localWorkNarrative', 'standupNarrative'],
} as const

interface AgendaItem { title: string; startTime: string; project: string }

export async function GET(req: Request) {
  const ctx = await getRequestContext()
  const machineAuth = req.headers.get('x-kafi-key') === (process.env.KAFI_API_KEY)
  if (!ctx && !machineAuth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const uid = ctx?.uid ?? (machineAuth ? OWNER_UID : null)

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000)

  const [todayEvents, todaySessions, todayCorrections, yesterdaySessions] = await Promise.all([
    db.select().from(agentEvents).where(gte(agentEvents.createdAt, todayStart)),
    uid != null
      ? db.select().from(sessions).where(and(eq(sessions.userId, uid), gte(sessions.createdAt, todayStart)))
      : db.select().from(sessions).where(gte(sessions.createdAt, todayStart)),
    db.select().from(arkaCorrections).where(gte(arkaCorrections.createdAt, todayStart)),
    // Konteks tambahan buat standupNarrative — kalau hari ini sepi (misal
    // laporan digenerate pagi), kerja kemarin tetap bisa diceritakan.
    uid != null
      ? db.select().from(sessions).where(and(eq(sessions.userId, uid), gte(sessions.createdAt, yesterdayStart), lt(sessions.createdAt, todayStart)))
      : db.select().from(sessions).where(and(gte(sessions.createdAt, yesterdayStart), lt(sessions.createdAt, todayStart))),
  ])

  // Rencana ke depan untuk standup: task terbuka milik user di sprint aktif
  // (dari OP cache — data yang sama dengan menu Incoming/Sprint).
  let openTaskLines = ''
  try {
    const cache = loadCache(uid ?? OWNER_UID)
    const open = (cache.myOpenTasks ?? [])
      .filter(t => !t.isClosed)
      .sort((a, b) => (a.islStatus === 'in_progress' ? -1 : 1) - (b.islStatus === 'in_progress' ? -1 : 1))
      .slice(0, 10)
    openTaskLines = open.map(t => `- #${t.id} ${t.subject}${t.sprintName ? ` (${t.sprintName})` : ''}${t.islStatus === 'in_progress' ? ' [sedang dikerjakan]' : ''}`).join('\n')
  } catch { /* cache kosong → bagian rencana dinarasikan dari sisa data */ }

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

  if (!todayEvents.length && !todaySessions.length && !todayCorrections.length && !yesterdaySessions.length) {
    return NextResponse.json({
      agentNarrative:     'Belum ada aktivitas agent tercatat hari ini.',
      localWorkNarrative: 'Belum ada aktivitas kerja lokal tercatat hari ini.',
      standupNarrative:   'Belum ada aktivitas tercatat — tidak ada bahan standup untuk hari ini.',
      agenda,
    })
  }

  const eventsByAgent: Record<string, string[]> = {}
  for (const e of todayEvents) {
    (eventsByAgent[e.agent] ??= []).push(`${e.event}${e.meta && Object.keys(e.meta).length ? ' ' + JSON.stringify(e.meta) : ''}`)
  }
  const eventLines = Object.entries(eventsByAgent).map(([agent, evs]) => `${agent}: ${evs.join(', ')}`).join('\n')
  // Bullets dinaikkan 3 → 8: bullets adalah detail proses yang sebenarnya —
  // memotong ke 3 adalah sumber utama keluhan "laporan seperti singkatan".
  const sessionLines = todaySessions.map(s =>
    `- [${s.source ?? 'unknown'}] ${s.title} (${s.pushStatus})${s.bullets?.length ? ':\n  ' + s.bullets.slice(0, 8).join('\n  ') : ''}`
  ).join('\n')
  const yesterdayLines = yesterdaySessions.map(s =>
    `- ${s.title}${s.bullets?.length ? ': ' + s.bullets.slice(0, 4).join('; ') : ''}`
  ).join('\n')
  const correctionLines = todayCorrections.map(c =>
    `- "${c.sessionTitle}": Arka tebak #${c.arkaGuessTaskId ?? 'hub'}, dikoreksi Rian ke #${c.correctedTaskId}`
  ).join('\n')
  const agendaLines = agenda.map(a =>
    `- ${new Date(a.startTime).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })} ${a.title}${a.project ? ` (${a.project})` : ''}`
  ).join('\n')

  const prompt = `Kamu adalah Aryo, agent manager yang merangkum aktivitas tim AI ISL untuk Rian (pemilik). Tulis dalam Bahasa Indonesia, natural, PANJANG dan DETAIL — kalimat utuh yang bercerita, BUKAN poin singkat, BUKAN singkatan, BUKAN sekadar angka. Anggap pembacanya perlu paham konteks tanpa membuka sistem.

Log event agent hari ini (arka=session recorder, luna=hub curator, rendi=sprint guard, dira=timekeeper, kafi=field agent, tika=helpdesk triage, sage=AI news):
${eventLines || '(tidak ada event tercatat)'}

Sesi kerja HARI INI (dari hook lokal Kafi / input manual Rian) — bullets di bawah judul adalah detail pekerjaannya:
${sessionLines || '(tidak ada sesi tercatat)'}

Sesi kerja KEMARIN (konteks tambahan):
${yesterdayLines || '(tidak ada)'}

Koreksi Arka hari ini (tebakan task yang dibetulkan Rian saat triage):
${correctionLines || '(tidak ada koreksi)'}

Task terbuka Rian di sprint aktif (rencana kerja berikutnya):
${openTaskLines || '(cache OP kosong)'}

Agenda meeting 7 hari ke depan:
${agendaLines || '(tidak ada)'}

Tulis TIGA bagian:
1. Narasi agent (minimal 2 paragraf): jelaskan APA YANG SEBENARNYA DIKERJAKAN oleh agent-agent ISL hari ini berdasarkan data di atas — proses dan konteksnya, bukan cuma angka. Agent yang datanya kosong, sebut singkat idle.
2. Narasi lokal (minimal 2 paragraf): rangkum apa yang benar-benar Rian kerjakan secara lokal hari ini dari sesi kerja + bullets di atas — jelaskan pekerjaannya secara utuh dan konkret (apa yang dibangun/diperbaiki, di sistem apa, hasilnya apa), bukan cuma daftar judul.
3. Narasi standup: paragraf yang siap DIBACAKAN Rian di daily standup BESOK PAGI, dalam bahasa yang dipahami orang non-teknis. Struktur wajib tiga kalimat-kelompok: (a) "Kemarin saya ..." — rangkum kerja hari ini dari data di atas; (b) "Hari ini saya akan ..." — dari task terbuka sprint + agenda terdekat; (c) "Ke depan ..." — arah kerja selanjutnya dari sisa task/agenda. Tulis mengalir sebagai satu paragraf utuh, bukan bullet.`

  // 150s (bukan default 90s): tiga seksi naratif panjang — qwen 3B butuh
  // waktu; 90s terbukti selalu timeout untuk beban ini (test 2026-07-17).
  const localRaw = await callLocalLLM(prompt, NARRATIVE_FORMAT, { timeoutMs: 150_000 })
  if (localRaw) {
    try {
      const j = JSON.parse(localRaw) as { agentNarrative?: unknown; localWorkNarrative?: unknown; standupNarrative?: unknown }
      const agentNarrative = typeof j.agentNarrative === 'string' ? j.agentNarrative.trim() : ''
      const localWorkNarrative = typeof j.localWorkNarrative === 'string' ? j.localWorkNarrative.trim() : ''
      const standupNarrative = typeof j.standupNarrative === 'string' ? j.standupNarrative.trim() : ''
      if (agentNarrative && localWorkNarrative && standupNarrative) {
        return NextResponse.json({ agentNarrative, localWorkNarrative, standupNarrative, agenda })
      }
    } catch { /* invalid JSON → fallback Claude */ }
  }

  const llmCfg = getLLMConfig()
  if (!llmCfg) {
    return NextResponse.json({
      agentNarrative:     eventLines || 'Belum ada aktivitas agent tercatat.',
      localWorkNarrative: sessionLines || 'Belum ada aktivitas kerja lokal tercatat.',
      standupNarrative:   '',
      agenda,
    })
  }
  const text = await callLLM(
    `${prompt}\n\nFormat balasan (tiga bagian, jangan pakai JSON):\n### AGENT\n<narasi agent di sini>\n\n### LOKAL\n<narasi lokal di sini>\n\n### STANDUP\n<narasi standup di sini>`,
    llmCfg,
  )
  const agentMatch   = text.match(/### AGENT\s*([\s\S]*?)(?=### LOKAL|$)/i)
  const localMatch   = text.match(/### LOKAL\s*([\s\S]*?)(?=### STANDUP|$)/i)
  const standupMatch = text.match(/### STANDUP\s*([\s\S]*)/i)
  return NextResponse.json({
    agentNarrative:     agentMatch?.[1]?.trim() || text,
    localWorkNarrative: localMatch?.[1]?.trim() || '',
    standupNarrative:   standupMatch?.[1]?.trim() || '',
    agenda,
  })
}
