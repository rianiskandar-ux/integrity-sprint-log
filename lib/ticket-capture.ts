// Capture sesi kerja → draf update tiket (Rian 2026-10-19). Hook Arka mengirim potongan sesi yang baru
// (waktu aktif per tanggal + poin kerja). Kalau sesi itu kerja kantor yang berkaitan dengan tiket yang
// SUDAH ada, aktivitas & waktunya otomatis masuk ke draf update tiket itu di ISL (BUKAN ke OP). Kalau
// tidak ada tiket yang cocok: tidak terjadi apa-apa — tiket baru menunggu perintah Rian.
// Pencocokan di server (tiket terbuka langsung dari OP), karena op-cache.json milik hook basi sejak Juni.
import { and, eq } from 'drizzle-orm'
import { db, ticketDrafts } from '@/lib/db'
import { recheck, sanitizeActivity, sanitizeLogs, snapshotOf, type Activity, type OpCtx, type TimeLog } from '@/lib/ticket-drafts'

// Alat pribadi & kerja freelance = TANPA tiket (aturan Rian 19 Okt: OP = KPI kerja kantor saja).
const PERSONAL_DIR = /[\\/](kota-kerja-src|daily-sprint-next|launcher-dashboard|emergent-contest|jagadigital|cocoland[^\\/]*|cuckoo[^\\/]*|\.claude[^\\/]*)([\\/]|$)/i
export const isPersonalCwd = (cwd?: string | null) => !!cwd && PERSONAL_DIR.test(cwd)

const STOP = new Set(['this', 'that', 'with', 'from', 'have', 'will', 'been', 'into', 'more', 'than', 'when', 'make', 'task', 'work',
  'done', 'setup', 'update', 'untuk', 'yang', 'dengan', 'pada', 'sudah', 'akan', 'juga', 'agar', 'karena'])

/** Tiket Task/Bug terbuka yang di-assign ke saya, langsung dari OP. */
async function myOpenTasks(c: OpCtx): Promise<{ id: number; subject: string }[]> {
  const filters = [{ assignee: { operator: '=', values: ['me'] } }, { status: { operator: 'o', values: [] } }]
  const r = await fetch(`${c.opBaseUrl}/api/v3/work_packages?pageSize=200&filters=${encodeURIComponent(JSON.stringify(filters))}`,
    { headers: { Authorization: 'Basic ' + Buffer.from(`apikey:${c.opToken}`).toString('base64') } })
  if (!r.ok) return []
  const j = await r.json().catch(() => ({}))
  return ((j._embedded?.elements ?? []) as { id: number; subject: string; _links: { type?: { title?: string } } }[])
    .filter(w => /^(task|bug)$/i.test(w._links.type?.title ?? ''))
    .map(w => ({ id: w.id, subject: w.subject }))
}

/** Skor kata kunci (aturan Arka): minimal 2 kata kunci utuh & ≥30% kata kunci sesi ada di judul tiket. */
export function bestMatch(title: string, bullets: string[], tasks: { id: number; subject: string }[]): { id: number; subject: string; score: number } | null {
  const text = (title + ' ' + bullets.join(' ')).toLowerCase()
  const keywords = [...new Set(text.split(/\W+/).filter(w => w.length > 3 && !STOP.has(w)))]
  if (!keywords.length) return null
  const minScore = Math.max(2, Math.ceil(keywords.length * 0.3))
  let best: { id: number; subject: string; score: number } | null = null
  for (const t of tasks) {
    const s = t.subject.toLowerCase()
    const score = keywords.filter(kw => {
      const i = s.indexOf(kw)
      if (i === -1) return false
      const before = s[i - 1], after = s[i + kw.length]
      return (!before || /\W/.test(before)) && (!after || /\W/.test(after))
    }).length
    if (score >= minScore && score > (best?.score ?? 0)) best = { id: t.id, subject: t.subject, score }
  }
  return best
}

export interface CaptureInput {
  sessionId: string
  segment: string                         // kunci potongan (sessionId@mulai) — capture ulang mengganti, tak menggandakan
  title: string
  bullets: string[]
  logs: { date: string; mins: number }[]  // waktu aktif per tanggal WIB untuk potongan ini
  ticketBinding?: number | null
  cwd?: string | null
}

export async function captureSession(c: OpCtx & { uid: number }, b: CaptureInput) {
  if (isPersonalCwd(b.cwd)) return { matched: false, reason: 'folder alat pribadi / freelance — tanpa tiket' }
  let wpId = b.ticketBinding ? Number(b.ticketBinding) : 0
  let how: 'binding' | 'keywords' = 'binding'
  if (!wpId) {
    const m = bestMatch(b.title, b.bullets, await myOpenTasks(c))
    if (!m) return { matched: false, reason: 'tak ada tiket yang cocok — menunggu perintah Rian' }
    wpId = m.id; how = 'keywords'
  }
  const sn = await snapshotOf(c, wpId)
  if (!sn) return { matched: false, reason: `tiket #${wpId} tak terbaca di OP` }

  const seg = String(b.segment).slice(0, 150)
  const newLogs: TimeLog[] = sanitizeLogs(b.logs.map(l => ({ ...l, src: `${seg}|${l.date}` })), true)
  const lastDate = [...b.logs.map(l => l.date)].sort().pop() ?? new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
  const newAct: Activity[] = sanitizeActivity([{ date: lastDate, src: seg, bullets: b.bullets }])

  const [existing] = await db.select().from(ticketDrafts).where(and(eq(ticketDrafts.userId, c.uid), eq(ticketDrafts.status, 'draft'),
    eq(ticketDrafts.kind, 'update'), eq(ticketDrafts.targetWpId, wpId))).limit(1)
  let row
  if (existing) {
    const keepLogs = ((existing.timeLogs ?? []) as TimeLog[]).filter(l => !(l.src ?? '').startsWith(`${seg}|`))
    const keepAct = ((existing.activity ?? []) as Activity[]).filter(a => a.src !== seg)
    ;[row] = await db.update(ticketDrafts).set({
      timeLogs: sanitizeLogs([...keepLogs, ...newLogs]), activity: [...keepAct, ...newAct],
      autoMatched: existing.autoMatched && how === 'keywords', targetSnapshot: sn, checkOk: false, updatedAt: new Date(),
    }).where(eq(ticketDrafts.id, existing.id)).returning()
  } else {
    const id = `td-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    ;[row] = await db.insert(ticketDrafts).values({
      id, userId: c.uid, kind: 'update', targetWpId: wpId, targetSnapshot: sn, sprintId: sn.versionId ?? null,
      subject: sn.subject, estimatedMins: sn.estMins, targetStatus: 'in_progress',
      timeLogs: newLogs, activity: newAct, autoMatched: how === 'keywords',
    }).returning()
  }
  const all = await db.select().from(ticketDrafts).where(and(eq(ticketDrafts.userId, c.uid), eq(ticketDrafts.status, 'draft')))
  const chk = await recheck(c, row, all)
  return { matched: true, how, wpId, subject: sn.subject, draftId: row.id, stage: chk.ok ? 'close' : 'progress' }
}
