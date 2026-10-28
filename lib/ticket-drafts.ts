// Draf tiket ISL → OP (Rian 2026-10-16/19). Rencana dirancang bebas di ISL; tiket baru lahir di OP saat
// "Fix → Push", dengan judul final sejak lahir. Draf bisa membawa status tujuan + catatan waktu, jadi
// kerjaan yang SUDAH selesai di-push sekali jalan: tiket lahir → time entry → In progress → Closed.
// Validasi = aturan kita + aturan OP sendiri lewat endpoint /form (OP memvalidasi TANPA menyimpan),
// jadi draf yang lolos cek pasti diterima OP.
import { and, eq } from 'drizzle-orm'
import { db, ticketDrafts } from '@/lib/db'
import { wibDate } from '@/lib/op-time'

export type DraftRow = typeof ticketDrafts.$inferSelect
export type TimeLog = { date: string; mins: number; origDate?: string; extra?: boolean; src?: string }
export type Activity = { date: string; src?: string; bullets: string[] }
export type Snapshot = { subject: string; status: string; statusId: number; estMins: number; spentMins: number; authorId: number | null; mine: boolean; versionId?: number | null }
export type TargetStatus = 'new' | 'in_progress' | 'closed'
export interface Issue { level: 'error' | 'warn'; msg: string }
export interface OpCtx { opToken: string; opBaseUrl: string; opUserId: number }

export const MIN_EST_MINS = 60            // minimal 1 jam per tiket (aturan Rian)
export const SPRINT_CAP_MINS = 60 * 60    // total estimasi per sprint maks 60 jam (target 50–60)
export const MAX_DAY_MINS = 10 * 60       // maks 10 jam ter-log per hari (gabungan OP + draf)
const MAX_PROGRESS_PCT = 95               // In progress maks 95%; 100% hanya saat Closed
const ST = { IN_PROGRESS: 7, CLOSED: 12 }

function minsToISO(mins: number): string {
  const h = Math.floor(mins / 60), m = mins % 60
  return h > 0 ? `PT${h}H${m > 0 ? m + 'M' : ''}` : `PT${m}M`
}
export function isoToMins(dur: unknown): number {
  if (!dur || typeof dur !== 'string') return 0
  const m = dur.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/)
  if (!m) return 0
  return Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) + Math.round(Number(m[4] ?? 0) / 60)
}
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
const fmtH = (m: number) => { const h = Math.floor(m / 60), r = m % 60; return r ? `${h}j ${r}m` : `${h}j` }

/**
 * Bersihkan input catatan waktu dari API: {date YYYY-MM-DD, mins 1..600, origDate?}, digabung per
 * (tanggal, tanggal asli). origDate = tanggal dari sumber (git/Arka); `stampOrig` (jalur Claude)
 * mengisinya = date bila kosong, supaya perubahan tanggal belakangan terlihat sebagai anomali.
 */
export function sanitizeLogs(input: unknown, stampOrig = false): TimeLog[] {
  if (!Array.isArray(input)) return []
  const isDate = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
  const byKey = new Map<string, TimeLog>()
  for (const x of input as { date?: unknown; mins?: unknown; origDate?: unknown; extra?: unknown; src?: unknown }[]) {
    const date = String(x?.date ?? ''), mins = Math.round(Number(x?.mins))
    if (!isDate(date) || !Number.isFinite(mins) || mins <= 0) continue
    const extra = x?.extra === true   // waktu di luar sesi (diisi Rian) — tak punya tanggal sumber
    const origDate = extra ? undefined : isDate(x?.origDate) ? String(x.origDate) : stampOrig ? date : undefined
    const src = typeof x?.src === 'string' && x.src.length <= 200 ? x.src : undefined   // potongan sesi hook: kunci unik
    const key = `${date}|${origDate ?? ''}|${extra ? 1 : 0}|${src ?? ''}`, prev = byKey.get(key)
    byKey.set(key, { date, mins: Math.min(MAX_DAY_MINS, (prev?.mins ?? 0) + mins), ...(origDate ? { origDate } : {}), ...(extra ? { extra } : {}), ...(src ? { src } : {}) })
  }
  return [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date))
}
export function sanitizeStatus(s: unknown): TargetStatus {
  return s === 'in_progress' || s === 'closed' ? s : 'new'
}
const logsOf = (d: DraftRow): TimeLog[] => (Array.isArray(d.timeLogs) ? d.timeLogs : []) as TimeLog[]
const activityOf = (d: DraftRow): Activity[] => (Array.isArray(d.activity) ? d.activity : []) as Activity[]
/** Satu baris per (tanggal, luar-sesi?) — potongan sesi di hari yang sama digabung jadi 1 time entry di OP. */
function logsByDate(d: DraftRow): { date: string; mins: number; extra: boolean }[] {
  const m = new Map<string, { date: string; mins: number; extra: boolean }>()
  for (const l of logsOf(d)) {
    const k = `${l.date}|${l.extra ? 1 : 0}`, p = m.get(k)
    m.set(k, { date: l.date, extra: !!l.extra, mins: Math.min(MAX_DAY_MINS, (p?.mins ?? 0) + l.mins) })
  }
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date) || Number(a.extra) - Number(b.extra))
}
/** Bersihkan input aktivitas: [{date, src?, bullets[]}], bullet dipotong & tanpa duplikat. */
export function sanitizeActivity(input: unknown): Activity[] {
  if (!Array.isArray(input)) return []
  const out: Activity[] = []
  for (const x of input as { date?: unknown; src?: unknown; bullets?: unknown }[]) {
    const date = String(x?.date ?? '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(x?.bullets)) continue
    const bullets = [...new Set((x.bullets as unknown[]).map(b => String(b).trim()).filter(Boolean).map(b => b.slice(0, 300)))].slice(0, 20)
    if (bullets.length) out.push({ date, ...(typeof x?.src === 'string' ? { src: x.src.slice(0, 200) } : {}), bullets })
  }
  return out
}
/** Komentar Work Log untuk OP (English, seperti backfill Sprint 125): rentang tanggal + poin unik. */
function activityMarkdown(d: DraftRow): string | null {
  const acts = activityOf(d)
  if (!acts.length) return null
  const dates = [...new Set(acts.map(a => a.date))].sort()
  const bullets = [...new Set(acts.flatMap(a => a.bullets))]
  const range = dates.length > 1 ? `${dates[0]} – ${dates[dates.length - 1]}` : dates[0]
  return [`**Work Log — ${range}**`, '', ...bullets.map(b => `- ${b}`), '', '*via ISL*'].join('\n')
}

function opHeaders(c: OpCtx) {
  return { Authorization: 'Basic ' + Buffer.from(`apikey:${c.opToken}`).toString('base64'), 'Content-Type': 'application/json' }
}
async function opJson(c: OpCtx, path: string, init?: RequestInit) {
  const r = await fetch(`${c.opBaseUrl}${path}`, { ...init, headers: opHeaders(c) })
  const j = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, j }
}

// ISL_OP_USER_ID sering 0 di container (terbukti 19 Okt) → tiket lahir TANPA assignee dan hilang dari
// tabel "assigned to you". Ambil id pemilik token langsung dari OP; di-cache per token.
const meCache = new Map<string, number>()
async function myOpUserId(c: OpCtx): Promise<number> {
  if (c.opUserId) return c.opUserId
  const hit = meCache.get(c.opToken)
  if (hit) return hit
  const r = await opJson(c, '/api/v3/users/me')
  const id = r.ok ? Number(r.j.id) || 0 : 0
  if (id) meCache.set(c.opToken, id)
  return id
}

/** Tiket Task milik saya yang sudah ada di OP pada sprint tertentu (untuk total estimasi & cek duplikat). */
export async function sprintTasksInOp(c: OpCtx, sprintId: number): Promise<{ subject: string; estMins: number }[]> {
  const filters = [{ version: { operator: '=', values: [String(sprintId)] } }, { assignee: { operator: '=', values: ['me'] } }, { status: { operator: '*', values: [] } }]
  const r = await opJson(c, `/api/v3/work_packages?pageSize=200&filters=${encodeURIComponent(JSON.stringify(filters))}`)
  if (!r.ok) return []
  return ((r.j._embedded?.elements ?? []) as { subject: string; estimatedTime?: string; _links: { type?: { title?: string } } }[])
    .filter(w => /^(task|bug)$/i.test(w._links.type?.title ?? ''))
    .map(w => ({ subject: w.subject, estMins: isoToMins(w.estimatedTime) }))
}

/** Menit yang SUDAH ter-log di OP pada satu tanggal oleh saya (untuk batas 10 jam/hari & jam mulai). */
async function opLoggedMinsOn(c: OpCtx, date: string): Promise<number> {
  const filters = [{ user: { operator: '=', values: ['me'] } }, { spent_on: { operator: '<>d', values: [date, date] } }]
  const r = await opJson(c, `/api/v3/time_entries?pageSize=200&filters=${encodeURIComponent(JSON.stringify(filters))}`)
  if (!r.ok) return 0
  return ((r.j._embedded?.elements ?? []) as { hours?: string }[]).reduce((a, t) => a + isoToMins(t.hours), 0)
}

/** Cek cepat tanpa OP: dipakai untuk tanda ✓ ⚠ ✗ di daftar. */
export function localIssues(d: DraftRow, siblings: DraftRow[], inOp: { subject: string; estMins: number }[] | null): Issue[] {
  if (d.kind === 'update') return updateIssues(d, siblings)
  const out: Issue[] = []
  if (d.autoMatched) out.push({ level: 'warn', msg: 'Dicocokkan otomatis dari sesi — pastikan tiketnya benar' })
  const subj = d.subject.trim()
  if (!subj) out.push({ level: 'error', msg: 'Judul kosong' })
  if (/\bdone\b/i.test(subj)) out.push({ level: 'error', msg: 'Judul memuat "DONE" — status ditandai lewat status, bukan judul' })
  if (/[^\x00-\x7F]/.test(subj)) out.push({ level: 'warn', msg: 'Judul berisi karakter non-ASCII — konten OP wajib English' })
  if (!d.parentId) out.push({ level: 'error', msg: 'Parent (User Story) belum dipilih' })
  if (d.estimatedMins == null) out.push({ level: 'error', msg: 'Estimate kosong' })
  else if (d.estimatedMins < MIN_EST_MINS) out.push({ level: 'error', msg: 'Estimate minimal 1 jam' })
  if (!d.sprintId) out.push({ level: 'warn', msg: 'Tanpa sprint (version kosong)' })
  const dupDraft = siblings.some(s => s.id !== d.id && s.status === 'draft' && norm(s.subject) === norm(subj))
  const dupOp = (inOp ?? []).some(t => norm(t.subject) === norm(subj))
  if (dupDraft || dupOp) out.push({ level: 'error', msg: dupOp ? 'Judul sama dengan tiket yang sudah ada di OP sprint ini' : 'Judul kembar dengan draf lain' })

  // catatan waktu & status tujuan
  const logs = logsOf(d), spent = logs.reduce((a, l) => a + l.mins, 0)
  const today = wibDate(), month = today.slice(0, 7)
  if (d.targetStatus === 'closed' && spent === 0) out.push({ level: 'error', msg: 'Status Selesai wajib punya catatan waktu' })
  for (const l of logs) {
    if (l.date > today) out.push({ level: 'error', msg: `Catatan ${l.date} di masa depan` })
    else if (l.date.slice(0, 7) !== month) out.push({ level: 'error', msg: `Catatan ${l.date} di luar bulan aktif — OP mengunci bulan lalu` })
  }
  if (spent > 0 && d.estimatedMins && spent === d.estimatedMins) out.push({ level: 'warn', msg: 'Spent persis = estimate — kelihatan dipatok; isi waktu sebenarnya' })
  if (spent > 0 && d.targetStatus === 'new') out.push({ level: 'warn', msg: 'Ada catatan waktu tapi status Rencana — status jadi "Sedang dikerjakan"?' })
  return out
}

/** Cek cepat draf UPDATE (tiket sudah ada di OP): hanya waktu + langkah status, judul/estimate tak diubah. */
function updateIssues(d: DraftRow, siblings: DraftRow[]): Issue[] {
  const out: Issue[] = []
  if (d.autoMatched) out.push({ level: 'warn', msg: 'Dicocokkan otomatis dari sesi — pastikan tiketnya benar' })
  const sn = d.targetSnapshot as Snapshot | null
  if (!d.targetWpId) return [{ level: 'error', msg: 'Tiket OP tujuan belum dipilih' }]
  if (!sn) out.push({ level: 'error', msg: `Data tiket #${d.targetWpId} belum terbaca dari OP` })
  else {
    if (sn.statusId === ST.CLOSED || /closed|rejected/i.test(sn.status)) out.push({ level: 'error', msg: `Tiket #${d.targetWpId} sudah ${sn.status} — final, tak diubah lagi` })
    if (!sn.mine) out.push({ level: 'warn', msg: 'Tiket buatan orang lain — boleh juga diedit langsung di OP' })
  }
  if (d.targetStatus === 'new') out.push({ level: 'error', msg: 'Pilih Sedang dikerjakan atau Selesai' })
  // hanya draf yang datang BELAKANGAN yang ditandai kembar; draf pertama tetap bisa di-push
  const older = (s: DraftRow) => s.createdAt < d.createdAt || (s.createdAt.getTime() === d.createdAt.getTime() && s.id < d.id)
  if (siblings.some(s => s.id !== d.id && s.status === 'draft' && s.kind === 'update' && s.targetWpId === d.targetWpId && older(s))) out.push({ level: 'error', msg: `Sudah ada draf update lain untuk #${d.targetWpId} — pakai yang itu` })
  const logs = logsOf(d), added = logs.reduce((a, l) => a + l.mins, 0), total = (sn?.spentMins ?? 0) + added
  const today = wibDate(), month = today.slice(0, 7)
  for (const l of logs) {
    if (l.date > today) out.push({ level: 'error', msg: `Catatan ${l.date} di masa depan` })
    else if (l.date.slice(0, 7) !== month) out.push({ level: 'error', msg: `Catatan ${l.date} di luar bulan aktif — OP mengunci bulan lalu` })
  }
  if (d.targetStatus === 'closed' && total === 0) out.push({ level: 'error', msg: 'Status Selesai wajib punya catatan waktu' })
  if (!added && sn && d.targetStatus === 'in_progress' && /progress/i.test(sn.status)) out.push({ level: 'warn', msg: 'Tak ada perubahan — sudah In progress dan tak ada waktu baru' })
  if (sn && total > 0 && total === sn.estMins) out.push({ level: 'warn', msg: 'Spent persis = estimate — kelihatan dipatok; isi waktu sebenarnya' })
  return out
}

/** Data tiket OP yang sudah ada (untuk draf update): judul, status, estimate, spent, milik siapa. */
export async function snapshotOf(c: OpCtx, wpId: number): Promise<Snapshot | null> {
  const r = await opJson(c, `/api/v3/work_packages/${wpId}`)
  if (!r.ok) return null
  const w = r.j, me = await myOpUserId(c)
  const authorId = Number(String(w._links?.author?.href ?? '').split('/').pop()) || null
  return {
    subject: w.subject, status: w._links?.status?.title ?? '', statusId: Number(String(w._links?.status?.href ?? '').split('/').pop()) || 0,
    estMins: isoToMins(w.estimatedTime), spentMins: isoToMins(w.spentTime), authorId, mine: !!me && authorId === me,
    versionId: Number(String(w._links?.version?.href ?? "").split("/").pop()) || null,
  }
}

/** Total estimasi sprint = tiket di OP + draf TIKET BARU yang masih draf (draf update sudah terhitung di OP). */
export function sprintTotalMins(drafts: DraftRow[], inOp: { estMins: number }[] | null): number {
  return (inOp ?? []).reduce((a, t) => a + t.estMins, 0) + drafts.filter(d => d.status === 'draft' && d.kind !== 'update').reduce((a, d) => a + (d.estimatedMins ?? 0), 0)
}

/** Batas 10 jam/hari: waktu di OP pada tanggal itu + semua draf saya (yang masih draf) pada tanggal yang sama. */
async function dayLoadIssues(c: OpCtx, d: DraftRow, allMyDrafts: DraftRow[]): Promise<Issue[]> {
  const out: Issue[] = []
  const days = new Map<string, number>()
  for (const l of logsOf(d)) days.set(l.date, (days.get(l.date) ?? 0) + l.mins)
  for (const [date, mins] of days) {
    const l = { date, mins }
    const inOp = await opLoggedMinsOn(c, l.date)
    const inDrafts = allMyDrafts.filter(x => x.status === 'draft').reduce((a, x) => a + logsOf(x).filter(y => y.date === l.date).reduce((s, y) => s + y.mins, 0), 0)
    const total = inOp + Math.max(inDrafts, l.mins)
    if (total > MAX_DAY_MINS) out.push({ level: 'error', msg: `${l.date}: total ${fmtH(total)} (OP ${fmtH(inOp)} + draf ${fmtH(inDrafts)}) > batas 10 jam/hari` })
    else if (total >= 8 * 60) out.push({ level: 'warn', msg: `${l.date}: total ter-log jadi ${fmtH(total)} (batas 10j)` })
  }
  return out
}

/**
 * Susun payload OP dari draf + validasi lewat /form (tanpa menyimpan). Field kustom yang WAJIB di
 * project (mis. Work Type / Domain di project 40) diwariskan dari parent supaya tak diisi manual.
 * Catatan waktu ikut divalidasi lewat /time_entries/form (parent dipakai sebagai pengganti tiket
 * yang belum lahir — kunci bulan & startTime dicek OP sendiri).
 */
export async function buildAndValidate(c: OpCtx, d: DraftRow, allMyDrafts: DraftRow[] = []): Promise<{ payload: Record<string, unknown> | null; issues: Issue[] }> {
  const issues: Issue[] = []
  if (d.kind === 'update') {
    // tiket sudah ada: segarkan data, validasi waktu langsung ke tiket itu (kunci bulan, hari libur, startTime)
    const sn = d.targetWpId ? await snapshotOf(c, d.targetWpId) : null
    if (!sn) return { payload: null, issues: [{ level: 'error', msg: `Tiket #${d.targetWpId} tidak ditemukan di OP` }] }
    await db.update(ticketDrafts).set({ targetSnapshot: sn, subject: sn.subject, estimatedMins: sn.estMins }).where(eq(ticketDrafts.id, d.id))
    issues.push(...await timeLogIssues(c, d, d.targetWpId!))
    issues.push(...await dayLoadIssues(c, d, allMyDrafts.length ? allMyDrafts : [d]))
    return { payload: issues.some(i => i.level === 'error') ? null : { update: d.targetWpId }, issues }
  }
  if (!d.parentId) return { payload: null, issues: [{ level: 'error', msg: 'Parent belum dipilih' }] }
  const p = await opJson(c, `/api/v3/work_packages/${d.parentId}`)
  if (!p.ok) return { payload: null, issues: [{ level: 'error', msg: `Parent #${d.parentId} tidak ditemukan di OP (HTTP ${p.status})` }] }
  const parent = p.j
  const links: Record<string, { href: string }> = {
    project: { href: parent._links?.project?.href },
    type:    { href: `/api/v3/types/${d.typeId}` },
    parent:  { href: `/api/v3/work_packages/${d.parentId}` },
  }
  if (d.sprintId) links.version = { href: `/api/v3/versions/${d.sprintId}` }   // version di TASK, bukan di US
  const me = await myOpUserId(c)
  if (me) links.assignee = { href: `/api/v3/users/${me}` }
  else issues.push({ level: 'error', msg: 'User OP tidak dikenali — tiket akan lahir tanpa assignee' })
  const payload: Record<string, unknown> = {
    subject: d.subject.trim().slice(0, 255),
    ...(d.estimatedMins ? { estimatedTime: minsToISO(d.estimatedMins) } : {}),
    ...(d.description?.trim() ? { description: { format: 'markdown', raw: d.description.trim() } } : {}),
    _links: links,
  }
  const form = async () => opJson(c, '/api/v3/work_packages/form', { method: 'POST', body: JSON.stringify(payload) })
  let f = await form()
  if (!f.ok) return { payload: null, issues: [...issues, { level: 'error', msg: `OP menolak form (HTTP ${f.status})` }] }
  const schema = f.j._embedded?.schema ?? {}
  let inherited = false
  for (const k of Object.keys(schema)) {
    if (!/^customField\d+$/.test(k) || !schema[k]?.required) continue
    if (parent[k] != null) { payload[k] = parent[k]; inherited = true }
    else if (parent._links?.[k]) { links[k] = parent._links[k]; inherited = true }
  }
  if (inherited) f = await form()
  const errs = (f.j._embedded?.validationErrors ?? {}) as Record<string, { message?: string }>
  for (const [k, v] of Object.entries(errs)) issues.push({ level: 'error', msg: `OP: ${k} — ${v?.message ?? 'tidak valid'}` })

  issues.push(...await timeLogIssues(c, d, d.parentId))   // parent = pengganti tiket yang belum lahir
  issues.push(...await dayLoadIssues(c, d, allMyDrafts.length ? allMyDrafts : [d]))
  return { payload: issues.some(i => i.level === 'error') ? null : payload, issues }
}

/** Validasi tiap catatan waktu lewat OP /time_entries/form (kunci bulan, hari libur, startTime) — tanpa menyimpan. */
async function timeLogIssues(c: OpCtx, d: DraftRow, wpId: number): Promise<Issue[]> {
  const out: Issue[] = []
  for (const l of logsByDate(d)) {
    const te = await opJson(c, '/api/v3/time_entries/form', { method: 'POST', body: JSON.stringify({
      hours: minsToISO(l.mins), spentOn: l.date, startTime: `${l.date}T09:00:00+07:00`,
      comment: { format: 'plain', raw: 'validation only' }, _links: { workPackage: { href: `/api/v3/work_packages/${wpId}` } },
    }) })
    const tErr = (te.j._embedded?.validationErrors ?? {}) as Record<string, { message?: string }>
    for (const [k, v] of Object.entries(tErr)) out.push({ level: 'error', msg: `OP waktu ${l.date}: ${k} — ${v?.message ?? 'tidak valid'}` })
  }
  return out
}

/** Time entry per catatan (jam mulai setelah entry yang sudah ada hari itu) lalu langkah status (≤95% / Closed). */
async function applyTimeAndStatus(c: OpCtx, wpId: number, d: DraftRow, steps: string[], fails: string[]) {
  const md = activityMarkdown(d)
  if (md) {
    const ac = await opJson(c, `/api/v3/work_packages/${wpId}/activities`, { method: 'POST', body: JSON.stringify({ comment: { format: 'markdown', raw: md } }) })
    if (ac.ok) steps.push('aktivitas'); else fails.push(`aktivitas (HTTP ${ac.status})`)
    if (fails.length) return
  }
  for (const l of logsByDate(d)) {
    const before = await opLoggedMinsOn(c, l.date)
    const startMin = 9 * 60 + before
    const hh = String(Math.min(23, Math.floor(startMin / 60))).padStart(2, '0'), mm = String(startMin % 60).padStart(2, '0')
    const te = await opJson(c, '/api/v3/time_entries', { method: 'POST', body: JSON.stringify({
      hours: minsToISO(l.mins), spentOn: l.date, startTime: `${l.date}T${hh}:${mm}:00+07:00`,
      comment: { format: 'plain', raw: (d.subject.trim() + (l.extra ? ' (outside recorded sessions)' : '')).slice(0, 200) },
      _links: { workPackage: { href: `/api/v3/work_packages/${wpId}` } },
    }) })
    if (te.ok) steps.push(`waktu ${l.date} ${fmtH(l.mins)}${l.extra ? ' (luar sesi)' : ''}`); else fails.push(`time entry ${l.date} (HTTP ${te.status})`)
  }
  if (d.targetStatus === 'new' || fails.length) return
  let wp = (await opJson(c, `/api/v3/work_packages/${wpId}`)).j
  const patch = async (statusId: number, extra: Record<string, unknown>) => {
    const pr = await opJson(c, `/api/v3/work_packages/${wpId}`, { method: 'PATCH', body: JSON.stringify({
      lockVersion: wp.lockVersion, ...extra, _links: { status: { href: `/api/v3/statuses/${statusId}` } },
    }) })
    if (pr.ok) wp = pr.j
    return pr.ok
  }
  const cur = Number(String(wp._links?.status?.href ?? '').split('/').pop())
  const est = isoToMins(wp.estimatedTime), spent = isoToMins(wp.spentTime)
  const floor = Math.ceil(est * (100 - MAX_PROGRESS_PCT) / 100)
  const rem = est > 0 ? { remainingTime: minsToISO(Math.max(floor, est - spent)) } : {}
  // selalu lewat In progress (juga menyegarkan % bila sudah In progress) — tak pernah lompat ke Closed
  if (cur !== ST.CLOSED) { if (await patch(ST.IN_PROGRESS, rem)) steps.push('In progress'); else fails.push('status In progress') }
  if (d.targetStatus === 'closed' && !fails.length) {
    if (await patch(ST.CLOSED, { remainingTime: 'PT0S' })) steps.push('Closed'); else fails.push('status Closed')
  }
}

/**
 * Cek penuh lalu SIMPAN hasilnya di draf: check_ok = true → wadah ② "ISL Close", false → ① "ISL Progress".
 * Dipanggil tiap draf dibuat/diubah, jadi pindah wadah terjadi otomatis (keputusan Rian 19 Okt).
 */
export async function recheck(c: OpCtx, d: DraftRow, allMine: DraftRow[]): Promise<{ ok: boolean; issues: Issue[] }> {
  const siblings = allMine.filter(x => (x.sprintId ?? null) === (d.sprintId ?? null))
  const inOp = d.kind !== 'update' && d.sprintId ? await sprintTasksInOp(c, d.sprintId).catch(() => null) : []
  const local = localIssues(d, siblings, inOp)
  const full = local.some(i => i.level === 'error') ? { issues: [] as Issue[] } : await buildAndValidate(c, d, allMine).catch(e => ({ issues: [{ level: 'error' as const, msg: 'Cek OP gagal: ' + String(e).slice(0, 120) }] }))
  const issues = [...local, ...full.issues]
  const ok = !issues.some(i => i.level === 'error')
  await db.update(ticketDrafts).set({ checkOk: ok, checkIssues: issues, checkedAt: new Date() }).where(eq(ticketDrafts.id, d.id))
  return { ok, issues }
}

/**
 * Fix → Push: validasi penuh lalu jalankan berurutan — tiket lahir (New) → time entry per catatan
 * (jam mulai setelah entry yang sudah ada di hari itu) → In progress (% = log ÷ estimate, ≤95%) →
 * Closed. Tiket yang sudah lahir tak bisa dibatalkan (OP final): kegagalan langkah lanjutan dicatat
 * di pushError, draf tetap ditandai pushed dengan id OP-nya.
 */
export async function pushDraft(c: OpCtx, d: DraftRow, siblings: DraftRow[], allMyDrafts: DraftRow[]): Promise<{ ok: boolean; opWpId?: number; issues: Issue[]; steps: string[] }> {
  const steps: string[] = []
  if (d.status !== 'draft') return { ok: false, issues: [{ level: 'error', msg: 'Draf ini sudah ' + d.status }], steps }
  const inOp = d.kind !== 'update' && d.sprintId ? await sprintTasksInOp(c, d.sprintId) : []
  const local = localIssues(d, siblings, inOp)
  if (local.some(i => i.level === 'error')) return { ok: false, issues: local, steps }
  const { payload, issues } = await buildAndValidate(c, d, allMyDrafts)
  if (!payload) return { ok: false, issues: [...local, ...issues], steps }

  if (d.kind === 'update') {
    const wpId = d.targetWpId!
    // tandai pushed DULU supaya klik ulang tak menggandakan time entry
    await db.update(ticketDrafts).set({ status: 'pushed', opWpId: wpId, pushError: null, pushedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(ticketDrafts.id, d.id), eq(ticketDrafts.status, 'draft')))
    const fails: string[] = []
    await applyTimeAndStatus(c, wpId, d, steps, fails)
    if (fails.length) {
      const msg = `Update #${wpId} sebagian gagal: ${fails.join(', ')} — lanjutkan dari tabel recap`
      await db.update(ticketDrafts).set({ pushError: msg, updatedAt: new Date() }).where(eq(ticketDrafts.id, d.id))
      return { ok: false, opWpId: wpId, issues: [...local, ...issues, { level: 'error', msg }], steps }
    }
    return { ok: true, opWpId: wpId, issues: [...local, ...issues], steps }
  }

  const r = await opJson(c, '/api/v3/work_packages', { method: 'POST', body: JSON.stringify(payload) })
  if (!r.ok) {
    const msg = `OP gagal membuat tiket (HTTP ${r.status}) ${String(r.j?.message ?? '').slice(0, 200)}`
    await db.update(ticketDrafts).set({ pushError: msg, updatedAt: new Date() }).where(eq(ticketDrafts.id, d.id))
    return { ok: false, issues: [...local, ...issues, { level: 'error', msg }], steps }
  }
  const opWpId = Number(r.j.id)
  steps.push(`tiket #${opWpId} lahir`)
  // tiket sudah ada di OP: tandai pushed SEKARANG supaya klik ulang tak melahirkan kembaran
  await db.update(ticketDrafts).set({ status: 'pushed', opWpId, pushError: null, pushedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(ticketDrafts.id, d.id), eq(ticketDrafts.status, 'draft')))

  const fails: string[] = []
  await applyTimeAndStatus(c, opWpId, d, steps, fails)
  if (fails.length) {
    const msg = `Tiket #${opWpId} sudah lahir, tapi gagal: ${fails.join(', ')} — lanjutkan dari tabel recap`
    await db.update(ticketDrafts).set({ pushError: msg, updatedAt: new Date() }).where(eq(ticketDrafts.id, d.id))
    return { ok: false, opWpId, issues: [...local, ...issues, { level: 'error', msg }], steps }
  }
  return { ok: true, opWpId, issues: [...local, ...issues], steps }
}
