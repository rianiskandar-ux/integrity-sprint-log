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
//
// RESILIENCE CONTRACT (2026-07-22, Rian's explicit directive — "walau error
// gw gamau lihat itu error, gw mau berfungsi normal, itu tanggung jawab Aryo"):
// this route NEVER 500s and ALWAYS returns all three non-empty narrative
// fields. LLM tiers are best-effort on top of a deterministic floor built
// purely from data — qwen (14b→3b via OLLAMA_CHAT_MODEL list) → cloud/Claude
// CLI → deterministic template. If even the data queries fail, a minimal but
// valid narrative is still returned. The report must always look normal.
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
interface NarrativeOut { agentNarrative: string; localWorkNarrative: string; standupNarrative: string; agenda: AgendaItem[] }

/** Absolute floor — returned only if data collection itself blew up. Still a
 *  valid, non-empty, non-error-looking narrative so the PDF renders normally. */
function minimalNarrative(): NarrativeOut {
  return {
    agentNarrative:     'Ringkasan aktivitas agent belum tersedia untuk periode ini.',
    localWorkNarrative: 'Ringkasan kerja lokal belum tersedia untuk periode ini.',
    standupNarrative:   'Kemarin saya melanjutkan pekerjaan yang sedang berjalan. Hari ini saya akan meneruskan task di sprint aktif. Ke depan saya akan menyelesaikan sisa pekerjaan sesuai prioritas sprint.',
    agenda: [],
  }
}

export async function GET(req: Request) {
  try {
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
    let openTaskSubjects: string[] = []
    try {
      const cache = loadCache(uid ?? OWNER_UID)
      const open = (cache.myOpenTasks ?? [])
        .filter(t => !t.isClosed)
        .sort((a, b) => (a.islStatus === 'in_progress' ? -1 : 1) - (b.islStatus === 'in_progress' ? -1 : 1))
        .slice(0, 10)
      openTaskLines = open.map(t => `- #${t.id} ${t.subject}${t.sprintName ? ` (${t.sprintName})` : ''}${t.islStatus === 'in_progress' ? ' [sedang dikerjakan]' : ''}`).join('\n')
      openTaskSubjects = open.map(t => t.subject)
    } catch { /* cache kosong → bagian rencana dinarasikan dari sisa data */ }

    // Agenda: OP meetings in the next 7 days.
    let agenda: AgendaItem[] = []
    try {
      const OP_TOKEN = ctx?.opToken || process.env.OP_API_TOKEN || ''
      const OP_BASE  = ctx?.opBaseUrl || process.env.OP_BASE_URL || ''
      if (OP_TOKEN && OP_BASE) {
        const auth = 'Basic ' + Buffer.from(`apikey:${OP_TOKEN}`).toString('base64')
        const res = await fetch(`${OP_BASE}/api/v3/meetings?pageSize=20&sortBy=%5B%5B%22startTime%22%2C%22asc%22%5D%5D`, { headers: { Authorization: auth }, signal: AbortSignal.timeout(8000) })
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

    // ── Deterministic floor — built purely from data, no LLM. Every LLM tier
    // below falls back to THIS on failure, so the report is never empty and
    // never surfaces an error. Reads as a normal factual summary.
    const todayTitles = todaySessions.map(s => s.title).filter(Boolean)
    const yTitles = yesterdaySessions.map(s => s.title).filter(Boolean)
    function buildDeterministic(): NarrativeOut {
      const agentNarrative = eventLines
        ? `Aktivitas agent ISL yang tercatat hari ini:\n${eventLines}`
        : 'Hari ini tidak ada aktivitas agent yang tercatat — seluruh agent dalam kondisi idle (tidak ada trigger baru yang masuk).'
      const localWorkNarrative = sessionLines
        ? `Sesi kerja lokal yang tercatat hari ini:\n${sessionLines}`
        : (yesterdayLines
            ? `Tidak ada sesi kerja lokal yang tercatat hari ini. Konteks dari kemarin:\n${yesterdayLines}`
            : 'Tidak ada sesi kerja lokal yang tercatat pada periode ini.')
      const kemarin = todayTitles.length
        ? todayTitles.slice(0, 5).join('; ')
        : (yTitles.length ? yTitles.slice(0, 5).join('; ') : 'melanjutkan pekerjaan yang sedang berjalan')
      const hariIni = openTaskSubjects.length
        ? openTaskSubjects.slice(0, 3).join('; ')
        : 'meneruskan task yang sedang berjalan di sprint aktif'
      const keDepan = agenda.length
        ? `menghadiri/menyiapkan ${agenda.slice(0, 3).map(a => a.title).join('; ')}`
        : (openTaskSubjects.length > 3 ? `melanjutkan ${openTaskSubjects.slice(3, 6).join('; ')}` : 'menyelesaikan sisa task sesuai prioritas sprint')
      const standupNarrative = `Kemarin saya mengerjakan ${kemarin}. Hari ini saya akan ${hariIni}. Ke depan saya akan ${keDepan}.`
      return { agentNarrative, localWorkNarrative, standupNarrative, agenda }
    }
    const deterministic = buildDeterministic()

    // Nothing happened at all → deterministic floor is already the right answer.
    if (!todayEvents.length && !todaySessions.length && !todayCorrections.length && !yesterdaySessions.length) {
      return NextResponse.json(deterministic)
    }

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

    // Tier 1 — local qwen (OLLAMA_CHAT_MODEL list handles 14b→3b auto-fallback).
    // 150s (bukan default 90s): tiga seksi naratif panjang butuh waktu.
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
      } catch { /* invalid JSON → tier 2 */ }
    }

    // Tier 2 — cloud / Claude CLI (getLLMConfig). Wrapped: any failure (CLI
    // missing, HTTP error, quota) must NOT bubble into a 500 — fall to floor.
    const llmCfg = getLLMConfig()
    if (llmCfg) {
      try {
        const text = await callLLM(
          `${prompt}\n\nFormat balasan (tiga bagian, jangan pakai JSON):\n### AGENT\n<narasi agent di sini>\n\n### LOKAL\n<narasi lokal di sini>\n\n### STANDUP\n<narasi standup di sini>`,
          llmCfg,
        )
        const agentMatch   = text.match(/### AGENT\s*([\s\S]*?)(?=### LOKAL|$)/i)
        const localMatch   = text.match(/### LOKAL\s*([\s\S]*?)(?=### STANDUP|$)/i)
        const standupMatch = text.match(/### STANDUP\s*([\s\S]*)/i)
        const agentNarrative = agentMatch?.[1]?.trim() || text.trim()
        if (agentNarrative) {
          return NextResponse.json({
            agentNarrative,
            localWorkNarrative: localMatch?.[1]?.trim() || deterministic.localWorkNarrative,
            standupNarrative:   standupMatch?.[1]?.trim() || deterministic.standupNarrative,
            agenda,
          })
        }
      } catch { /* cloud/CLI failed → tier 3 (deterministic floor) */ }
    }

    // Tier 3 — deterministic floor. Always valid, always non-empty.
    return NextResponse.json(deterministic)
  } catch {
    // Data collection itself failed → absolute minimal floor. Never a 500,
    // never a blank section — Aryo's report always renders normally.
    return NextResponse.json(minimalNarrative())
  }
}
