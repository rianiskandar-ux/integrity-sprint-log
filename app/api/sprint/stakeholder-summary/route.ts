import { NextRequest, NextResponse } from 'next/server'
import { callLLM, getLLMConfig } from '@/lib/llm'
import { loadCache } from '@/lib/op-cache'
import { loadUserConfig } from '@/lib/user-config'
import { getRequestContext } from '@/lib/request-auth'
import { getAllSessions } from '@/lib/session-store'

export const runtime = 'nodejs'
export const maxDuration = 300

// POST /api/sprint/stakeholder-summary — generate a non-technical, Bahasa Indonesia
// sprint summary for stakeholders (client/management). Copy-only: NOT posted to OP
// (OP content must stay English).
export async function POST(req: NextRequest) {
  // Same fallback as /api/op/sprint-plan/ai — local Claude CLI when no LLM configured.
  const llmCfg = getLLMConfig() ?? { provider: 'claude-cli' as const, apiKey: '', model: 'claude' }

  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { opToken: OP_TOKEN, opBaseUrl: OP_BASE, uid, opUserId } = ctx

  try { // outer guard — ALWAYS return JSON, never an HTML error page

  let sprintName: string | undefined
  try { sprintName = ((await req.json()) as { sprintName?: string }).sprintName } catch { /* empty body ok */ }

  const auth  = 'Basic ' + Buffer.from(`apikey:${OP_TOKEN}`).toString('base64')
  const cache = loadCache(uid)

  const sprintList = (cache.sprints ?? [])
  const currentSprint = sprintName
    ? (sprintList.find(s => s.name === sprintName) ?? sprintList.find(s => s.isCurrent))
    : sprintList.find(s => s.isCurrent)
  if (!currentSprint) return NextResponse.json({ error: 'No current sprint' }, { status: 404 })

  const userCfg     = loadUserConfig()
  const displayName = userCfg.displayName || 'Team Member'
  const userId      = String(cache.userId ?? opUserId)
  const currentNum  = parseInt(currentSprint.name.replace(/\D/g, '')) || 0
  const sprintPeriod = `${currentSprint.startDate} – ${currentSprint.endDate}`
  const projectNames = [...new Set([
    ...((cache.myOpenTasks ?? []) as { project?: string }[]).map(t => t.project),
    ...((cache.myClosedTasks ?? []) as { project?: string }[]).map(t => t.project),
  ].filter(Boolean))].join(', ') || 'Integrity Asia'

  type WPItem = { id: number; subject: string; status: string; project: string }

  function parseWPs(elements: Record<string, unknown>[]): WPItem[] {
    return elements.map(wp => {
      const links = (wp._links ?? {}) as Record<string, { title?: string } | null>
      return {
        id:      wp.id as number,
        subject: wp.subject as string,
        status:  links.status?.title ?? '',
        project: links.project?.title ?? '',
      }
    })
  }

  const allFilters = encodeURIComponent(JSON.stringify([
    { version:     { operator: '=', values: [String(currentSprint.id)] } },
    { type:        { operator: '!', values: ['5'] } },
    { assigned_to: { operator: '=', values: [userId] } },
  ]))

  let carryOver: WPItem[] = []
  let doneTasks: WPItem[] = []

  try {
    const res = await fetch(`${OP_BASE}/api/v3/work_packages?filters=${allFilters}&pageSize=200`, { headers: { Authorization: auth } })
    if (res.ok) {
      const all = parseWPs((await res.json())._embedded?.elements ?? [])
      carryOver = all.filter(t => t.status !== 'Closed' && t.status !== 'Rejected')
      doneTasks = all.filter(t => t.status === 'Closed')
    }
  } catch { /* non-fatal */ }

  const carryLines = carryOver.slice(0, 12).map(t => `- ${t.subject} (${t.status})`).join('\n')
  const doneLines  = doneTasks.slice(0, 12).map(t => `- ${t.subject}`).join('\n')

  // ISL work notes for this sprint — the DETAIL behind the tasks (source of findings).
  const sprintSessions = (await getAllSessions(uid))
    .filter(s => s.pushStatus !== 'discarded' && s.date >= currentSprint.startDate && s.date <= currentSprint.endDate)
  const findingsBlock = sprintSessions.slice(0, 10).map(s =>
    `- ${s.title}${(s.bullets?.length ? ': ' + s.bullets.slice(0, 3).map(b => b.slice(0, 100)).join('; ') : '')}`
  ).join('\n')

  const prompt = `Kamu adalah manajer proyek yang mempresentasikan hasil sprint ke stakeholder NON-TEKNIS (client/manajemen). Tulis ringkasan Bahasa Indonesia, gaya presentasi client: to the point, tanpa jargon teknis (jangan sebut nama teknologi/istilah seperti API, env, staging, deploy — terjemahkan ke dampak bisnisnya). JANGAN membuat daftar ticket/task. Fokus pada TEMUAN selama proses pengerjaan dan artinya bagi bisnis.
Format WAJIB (markdown, tiap poin 1-2 kalimat):
## Pencapaian Utama
(2-3 poin hasil paling berarti)
## Temuan Penting
(3-5 poin: masalah/insight yang ditemukan + dampak bisnisnya + apa yang sudah dilakukan)
## Perlu Perhatian / Keputusan
(0-3 poin yang butuh keputusan atau perhatian stakeholder; kalau tidak ada tulis 'Tidak ada — semua terkendali.')
## Bahan Diskusi
(2-4 topik PROAKTIF yang mengajak stakeholder berinteraksi — bukan laporan, tapi pertanyaan/pilihan yang muncul dari pekerjaan sprint ini. Setiap poin WAJIB: konteks singkat → implikasi → PERTANYAAN konkret ke stakeholder, sebutkan opsi bila ada. Contoh pola: "Privacy notice sudah diperbarui untuk versi English & Indonesia — namun website juga tersedia dalam Thai & Malay. Apakah konten dua bahasa itu dikerjakan dengan bantuan AI oleh tim kami, atau diserahkan ke tim cabang terkait?" Gali dari: cakupan yang belum tersentuh dari pekerjaan yang selesai, konsekuensi lanjutan sebuah temuan, pilihan arah yang butuh preferensi bisnis. HARUS berakar dari data sprint di bawah — DILARANG topik generik yang bisa ditulis tanpa membaca data. Kalau benar-benar tidak ada, tulis 'Tidak ada topik diskusi periode ini.')
## Fokus Berikutnya
(1-2 kalimat rencana periode depan)

DATA SPRINT #${currentNum}:
- Periode: ${sprintPeriod}
- Proyek: ${projectNames}
- Anggota: ${displayName}
- Total task: ${carryOver.length + doneTasks.length} (${doneTasks.length} selesai, ${carryOver.length} lanjut ke periode berikutnya)

SELESAI SPRINT INI (${doneTasks.length} task):
${doneLines || '(tidak ada)'}

LANJUT KE PERIODE BERIKUTNYA (${carryOver.length} task):
${carryLines || '(tidak ada)'}

CATATAN KERJA & TEMUAN (detail dari log kerja — SUMBER UTAMA untuk bagian Temuan Penting):
${findingsBlock || '(tidak ada)'}

Balas HANYA dengan ringkasan markdown sesuai format di atas — tanpa pembuka, tanpa penutup, tanpa penjelasan tambahan.`

  const summary = await callLLM(prompt, llmCfg)
  if (!summary?.trim()) return NextResponse.json({ error: 'AI tidak mengembalikan hasil' }, { status: 502 })

  return NextResponse.json({ ok: true, summary: summary.trim(), generatedAt: new Date().toISOString() })

  } catch (e) {
    console.error('[stakeholder-summary] error:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
