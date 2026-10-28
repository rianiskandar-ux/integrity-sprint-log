'use client'

// Draf tiket milik kita di tab Sprint (Rian 2026-10-16/19). Tiga wadah:
//  ① ISL Progress — draf dari kerjaan nyata, belum lolos cek (pindah ke ② OTOMATIS begitu lolos)
//  ② ISL Close    — sudah OK, masih bisa diubah; saran (kapasitas, geser, gabung, pecah) + pilih
//  ③ Push ke OP   — TIDAK PERNAH otomatis: cek penuh → langkah per tiket + peringatan + anomali → "Ya, push"
// Badge ⚑ anomali (permintaan Rian): kerja bertanggal sebelum sprint mulai, atau tanggal diubah dari
// tanggal sumbernya. Badge memberi tahu, tidak menghalangi push; yang menghalangi hanya ✗ merah.

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Plus, Loader2, Trash2, Send, ShieldCheck, X, ArrowRight, Merge, Scissors, ArrowRightLeft } from 'lucide-react'

interface Issue { level: 'error' | 'warn'; msg: string }
interface TimeLog { date: string; mins: number; origDate?: string; extra?: boolean; src?: string }
interface Activity { date: string; src?: string; bullets: string[] }
interface Snapshot { subject: string; status: string; estMins: number; spentMins: number; mine: boolean }
type TargetStatus = 'new' | 'in_progress' | 'closed'
interface Draft { id: string; kind: 'create' | 'update'; targetWpId: number | null; targetSnapshot: Snapshot | null; sprintId: number | null; parentId: number | null; subject: string; estimatedMins: number | null; targetStatus: TargetStatus; timeLogs: TimeLog[]; activity?: Activity[]; autoMatched?: boolean; issues: Issue[]; stage: 'progress' | 'close' }
interface ParentOpt { id: number; subject: string; project: string }
interface SprintOpt { id: number; name: string; startDate: string; endDate: string }
interface PushResult { id: string; subject: string; ok: boolean; opWpId?: number; steps?: string[]; issues: Issue[] }

const fmtH = (m: number) => { const h = Math.floor(m / 60), r = m % 60; return r ? `${h}h ${r}m` : `${h}h` }
const toMins = (s: string) => Math.round(parseFloat(String(s).replace(',', '.')) * 60)
const jsonOf = (r: Response) => r.json().catch(() => ({}))
const STATUS_LABEL: Record<TargetStatus, string> = { new: 'Rencana (New)', in_progress: 'Sedang dikerjakan', closed: 'Selesai (Closed)' }
const wibToday = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)
const dayLabel = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
const spentOf = (d: Draft) => d.timeLogs.reduce((a, l) => a + l.mins, 0)

function anomaliesOf(d: Draft, sprintStart: string | null): { label: string; title: string }[] {
  const out: { label: string; title: string }[] = []
  const early = sprintStart ? d.timeLogs.filter(l => l.date < sprintStart) : []
  if (early.length) out.push({ label: '⚑ Selesai sebelum sprint', title: `Dihitung di sprint yang mulai ${dayLabel(sprintStart!)}, tapi kerja bertanggal ${early.map(l => dayLabel(l.date)).join(', ')}` })
  for (const l of d.timeLogs) if (l.origDate && l.origDate !== l.date) out.push({ label: `⚑ Tanggal diubah · asli ${dayLabel(l.origDate)}`, title: `Tanggal dari sumber (git/Arka) ${l.origDate}, di draf ${l.date}` })
  return out
}
function stepsOf(d: Draft): string {
  const s = [d.kind === 'update' ? `#${d.targetWpId}` : 'lahir']
  if (d.timeLogs.length) s.push('waktu ' + d.timeLogs.map(l => `${dayLabel(l.date)} ${fmtH(l.mins)}`).join(', '))
  if (d.targetStatus !== 'new') s.push('In progress')
  if (d.targetStatus === 'closed') s.push('Closed')
  return s.join(' → ')
}

const Anom = ({ a }: { a: { label: string; title: string } }) => (
  <span title={a.title} className="font-bold px-1.5 rounded-full bg-orange-100 text-orange-800 border border-orange-300 dark:bg-orange-950/60 dark:text-orange-300 dark:border-orange-800">{a.label}</span>
)

export default function TicketDrafts({ sprintId, sprintName, onPushed }: {
  sprintId: number | null
  sprintName: string
  onPushed?: () => void
}) {
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [tot, setTot] = useState<{ all: number; op: number | null; cap: number }>({ all: 0, op: null, cap: 3600 })
  const [parents, setParents] = useState<ParentOpt[]>([])
  const [sprints, setSprints] = useState<SprintOpt[]>([])
  const [loading, setLoading] = useState(true)
  const [nw, setNw] = useState({ subject: '', parent: '', est: '1' })
  const [nwUp, setNwUp] = useState({ id: '', status: 'closed' as TargetStatus })   // draf update tiket yang sudah ada
  const [opUrl, setOpUrl] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [review, setReview] = useState<{ ids: string[]; results: PushResult[] } | null>(null)   // wadah ③
  const [results, setResults] = useState<PushResult[] | null>(null)
  const [logIn, setLogIn] = useState<Record<string, { date: string; h: string }>>({})
  const [msg, setMsg] = useState<string | null>(null)

  const [tick, setTick] = useState(0)
  const load = useCallback(() => setTick(t => t + 1), [])
  useEffect(() => {
    let alive = true
    fetch(`/api/isl/ticket-drafts${sprintId ? `?sprintId=${sprintId}` : ''}`).then(jsonOf).then(d => {
      if (!alive) return
      const list: Draft[] = d.drafts ?? []
      setDrafts(list)
      setSel(prev => new Set([...prev].filter(id => list.some(x => x.id === id && x.stage === 'close'))))
      setTot({ all: d.sprintTotalMins ?? 0, op: d.opTotalMins ?? null, cap: d.capMins ?? 3600 })
      setLoading(false)
    })
    return () => { alive = false }
  }, [sprintId, tick])
  useEffect(() => {
    fetch('/api/op/cache').then(jsonOf).then(c => {
      const us = ((c.userStories ?? []) as { id: number; subject: string; status: string; project: string }[])
        .filter(u => !/closed|rejected/i.test(u.status)).sort((a, b) => b.id - a.id)
      setParents(us.map(u => ({ id: u.id, subject: u.subject, project: u.project })))
      if (c._opUrl) setOpUrl(c._opUrl)
      setSprints(((c.sprints ?? []) as SprintOpt[]).slice().sort((a, b) => a.startDate.localeCompare(b.startDate)))
    }).catch(() => {})
  }, [])

  const cur = sprints.find(s => s.id === sprintId) ?? null
  const next = cur ? sprints.find(s => s.startDate > cur.startDate) ?? null : null
  const sprintStart = cur?.startDate?.slice(0, 10) ?? null

  function flash(t: string) { setMsg(t); setTimeout(() => setMsg(null), 7000) }
  const parentLabel = (id: number | null) => {
    if (!id) return '—'
    const p = parents.find(x => x.id === id)
    return p ? `#${id} ${p.subject}` : `#${id}`
  }
  const call = async (path: string, method: string, body?: unknown) =>
    fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(jsonOf)

  async function add() {
    const parentId = Number(nw.parent.replace(/\D/g, '')) || null
    const est = toMins(nw.est)
    if (!nw.subject.trim()) return
    setBusy('new')
    const r = await call('/api/isl/ticket-drafts', 'POST', { sprintId, parentId, subject: nw.subject, estimatedMins: Number.isFinite(est) && est > 0 ? est : null })
    setBusy(null)
    if (r.error) { flash(r.error); return }
    setNw(v => ({ subject: '', parent: v.parent, est: '1' }))
    load()
  }
  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(id); await call('/api/isl/ticket-drafts', 'PATCH', { id, ...body }); setBusy(null); load()
  }
  async function discard(id: string) { await call(`/api/isl/ticket-drafts?id=${encodeURIComponent(id)}`, 'DELETE'); load() }
  async function action(body: Record<string, unknown>, done: string) {
    setBusy('action'); const r = await call('/api/isl/ticket-drafts/action', 'POST', body); setBusy(null)
    flash(r.error ? r.error : done); load()
  }
  // extra = waktu kerja di luar sesi yang terekam (uji manual, rapat, koordinasi) — diisi kamu
  function addLog(d: Draft, extra = false) {
    const v = logIn[d.id] ?? { date: wibToday(), h: '' }
    const mins = toMins(v.h)
    if (!v.date || !Number.isFinite(mins) || mins <= 0) return
    setLogIn(s => ({ ...s, [d.id]: { date: v.date, h: '' } }))
    patch(d.id, { timeLogs: [...d.timeLogs, { date: v.date, mins, ...(extra ? { extra: true } : {}) }], ...(d.targetStatus === 'new' ? { targetStatus: 'in_progress' } : {}) })
  }
  async function addUpdate() {
    const wpId = Number(nwUp.id.replace(/\D/g, ''))
    if (!wpId) return
    setBusy('new')
    const r = await call('/api/isl/ticket-drafts', 'POST', { kind: 'update', targetWpId: wpId, targetStatus: nwUp.status, sprintId })
    setBusy(null)
    if (r.error) { flash(r.error); return }
    setNwUp(v => ({ ...v, id: '' }))
    load()
  }
  // ③ langkah 1: cek penuh dulu (tanpa menyimpan apa pun di OP), tampilkan, baru boleh "Ya, push"
  async function openReview(ids: string[]) {
    if (!ids.length) return
    setBusy('review')
    const r = await call('/api/isl/ticket-drafts/push', 'POST', { ids, dryRun: true })
    setBusy(null)
    setResults(null)
    setReview({ ids, results: r.results ?? [] })
  }
  async function pushNow() {
    if (!review) return
    setBusy('push')
    const r = await call('/api/isl/ticket-drafts/push', 'POST', { ids: review.ids })
    setBusy(null)
    const res: PushResult[] = r.results ?? []
    if (!res.length) { flash(r.error ?? 'Gagal'); return }
    setReview(null); setResults(res); setSel(new Set())
    if (res.some(x => x.opWpId)) {
      await fetch('/api/op/cache', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {})
      window.dispatchEvent(new Event('isl:cache-refreshed'))
      onPushed?.()
    }
    load()
  }

  const progress = drafts.filter(d => d.stage === 'progress')
  const close = drafts.filter(d => d.stage === 'close')
  const anomCount = close.filter(d => anomaliesOf(d, sprintStart).length).length
  const over = tot.all - tot.cap

  // ── saran (semua hanya usulan; dijalankan kalau kamu menekan) ──
  const creates = drafts.filter(d => d.kind !== 'update')   // gabung/pecah/geser hanya untuk draf tiket baru
  const planned = creates.filter(d => d.targetStatus === 'new')
  const doneOnes = creates.filter(d => d.targetStatus === 'closed')
  const groups = Object.values(creates.reduce((acc, d) => {
    if (!d.parentId) return acc
    ;(acc[d.parentId] ??= []).push(d); return acc
  }, {} as Record<number, Draft[]>)).filter(g => g.length >= 2 && g.some(d => (d.estimatedMins ?? 0) <= 120))
  const splittable = creates.filter(d => d.targetStatus === 'in_progress' && spentOf(d) > 0 && (d.estimatedMins ?? 0) > spentOf(d))

  const renderRow = (d: Draft, selectable: boolean) => {
    const errs = d.issues.filter(i => i.level === 'error'), warns = d.issues.filter(i => i.level === 'warn')
    const li = logIn[d.id] ?? { date: wibToday(), h: '' }
    const anoms = anomaliesOf(d, sprintStart)
    const up = d.kind === 'update', sn = d.targetSnapshot
    return (
      <div key={d.id} className={`px-4 py-2 space-y-1 ${sel.has(d.id) ? 'bg-emerald-50/70 dark:bg-emerald-950/20' : ''}`}>
        <div className="flex items-center gap-2 text-[11px]">
          {selectable
            ? <input type="checkbox" checked={sel.has(d.id)} className="rounded accent-emerald-600 flex-shrink-0"
                onChange={() => setSel(p => { const n = new Set(p); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); return n })} />
            : <span className="w-3.5 flex-shrink-0" />}
          {up
            ? <span className="inline-flex items-center px-1.5 h-4 text-[9px] font-bold rounded bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 flex-shrink-0">UPDATE #{d.targetWpId}</span>
            : <span className="inline-flex items-center px-1.5 h-4 text-[9px] font-bold rounded bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300 flex-shrink-0">DRAF</span>}
          {up
            ? <a href={opUrl ? `${opUrl}/work_packages/${d.targetWpId}` : undefined} target="_blank" rel="noopener" title="Judul dari OP — tidak diubah"
                className="flex-1 min-w-0 truncate text-gray-700 dark:text-gray-200 py-0.5 hover:underline">{d.subject}</a>
            : <input defaultValue={d.subject} onBlur={e => e.target.value.trim() !== d.subject && patch(d.id, { subject: e.target.value })}
                className="flex-1 min-w-0 bg-transparent border-b border-transparent hover:border-gray-200 focus:border-violet-400 outline-none text-gray-700 dark:text-gray-200 py-0.5" />}
          {up
            ? <span className="text-[10px] text-gray-400 flex-shrink-0" title="Estimate dari OP — tidak diubah">{fmtH(d.estimatedMins ?? 0)} est</span>
            : <>
                <input defaultValue={d.estimatedMins != null ? String(d.estimatedMins / 60).replace('.', ',') : ''} title="Estimate (jam) — min 1"
                  onBlur={e => { const m = toMins(e.target.value); if (Number.isFinite(m) && m !== d.estimatedMins) patch(d.id, { estimatedMins: m }) }}
                  className="w-11 text-right bg-transparent border-b border-gray-200 dark:border-gray-700 focus:border-violet-400 outline-none text-gray-500 py-0.5" />
                <span className="text-[10px] text-gray-400 flex-shrink-0">h est</span>
              </>}
          {busy === d.id && <Loader2 size={11} className="animate-spin text-gray-400" />}
          {!up && next && sprintId !== next.id && (
            <button onClick={() => action({ action: 'move', ids: [d.id], sprintId: next.id }, `Dipindah ke ${next.name}`)} title={`Pindah ke ${next.name}`}
              className="text-[10px] text-gray-400 hover:text-violet-600 whitespace-nowrap"><ArrowRight size={10} className="inline" /> {next.name.replace(/^Sprint\s*/i, 'S')}</button>
          )}
          <button onClick={() => discard(d.id)} title="Buang draf (tak ada jejak di OP)" className="p-1 text-gray-300 hover:text-red-500"><Trash2 size={12} /></button>
        </div>
        <div className="flex items-center gap-2 pl-[3.25rem] text-[10px] flex-wrap">
          {up
            ? <span className="text-gray-500">OP sekarang: <b>{sn?.status ?? '?'}</b> · spent {fmtH(sn?.spentMins ?? 0)}</span>
            : <select value={d.parentId ?? ''} onChange={e => patch(d.id, { parentId: Number(e.target.value) || null })}
                className="max-w-[45%] bg-transparent text-gray-500 border-b border-gray-200 dark:border-gray-700 outline-none py-0.5" title="Parent (User Story)">
                <option value="">— pilih User Story —</option>
                {d.parentId && !parents.some(p => p.id === d.parentId) && <option value={d.parentId}>{parentLabel(d.parentId)}</option>}
                {parents.map(p => <option key={p.id} value={p.id}>#{p.id} {p.subject} · {p.project}</option>)}
              </select>}
          <select value={d.targetStatus} onChange={e => patch(d.id, { targetStatus: e.target.value })} title="Status setelah push"
            className={`bg-transparent border-b border-gray-200 dark:border-gray-700 outline-none py-0.5 font-semibold ${d.targetStatus === 'closed' ? 'text-emerald-600' : d.targetStatus === 'in_progress' ? 'text-blue-500' : 'text-gray-500'}`}>
            {(Object.keys(STATUS_LABEL) as TargetStatus[]).filter(s => !up || s !== 'new').map(s => <option key={s} value={s}>{up && s === 'in_progress' ? '→ In progress' : up && s === 'closed' ? '→ In progress → Closed' : STATUS_LABEL[s]}</option>)}
          </select>
          {d.timeLogs.map((l, k) => (
            <span key={l.date + (l.origDate ?? '') + k} title={l.extra ? 'Waktu kerja di luar sesi (diisi kamu)' : 'Waktu terekam'}
              className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full ${l.extra ? 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-300' : 'bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-300'}`}>
              {l.extra && <span className="font-semibold">luar sesi</span>}
              <input type="date" value={l.date} max={wibToday()} title="Ubah tanggal (tanggal asli tetap tercatat)"
                onChange={e => e.target.value && patch(d.id, { timeLogs: d.timeLogs.map((x, i) => i === k ? { ...x, date: e.target.value } : x) })}
                className="bg-transparent outline-none w-[6.6rem]" />
              · {fmtH(l.mins)}
              <button onClick={() => patch(d.id, { timeLogs: d.timeLogs.filter((_, i) => i !== k) })} title="Hapus catatan" className="hover:text-red-500"><X size={9} /></button>
            </span>
          ))}
          <span className="inline-flex items-center gap-1 text-gray-400">
            <input type="date" value={li.date} max={wibToday()} onChange={e => setLogIn(s => ({ ...s, [d.id]: { ...li, date: e.target.value } }))}
              className="bg-transparent border-b border-gray-200 dark:border-gray-700 outline-none text-gray-500" />
            <input value={li.h} placeholder="jam" onChange={e => setLogIn(s => ({ ...s, [d.id]: { ...li, h: e.target.value } }))} onKeyDown={e => e.key === 'Enter' && addLog(d)}
              className="w-9 text-right bg-transparent border-b border-gray-200 dark:border-gray-700 outline-none text-gray-500" />
            <button onClick={() => addLog(d)} title="Tambah waktu terekam" className="hover:text-blue-500"><Plus size={10} /></button>
            <button onClick={() => addLog(d, true)} title="Tambah waktu kerja di luar sesi (uji manual, rapat, koordinasi)" className="hover:text-indigo-500 whitespace-nowrap">+ luar sesi</button>
          </span>
          {up
            ? <span className="text-blue-500 font-semibold">spent {fmtH(sn?.spentMins ?? 0)}{spentOf(d) ? ` + ${fmtH(spentOf(d))}` : ''}</span>
            : spentOf(d) > 0 && <span className="text-blue-500 font-semibold">spent {fmtH(spentOf(d))}</span>}
        </div>
        {(d.activity ?? []).length > 0 && (
          <details className="pl-[3.25rem] text-[10px] text-gray-500">
            <summary className="cursor-pointer select-none">📝 Aktivitas ({[...new Set((d.activity ?? []).flatMap(a => a.bullets))].length} poin) — jadi komentar Work Log di OP saat push</summary>
            <div className="mt-1 space-y-1">
              {(d.activity ?? []).map((a, k) => (
                <div key={(a.src ?? '') + k} className="flex gap-2">
                  <span className="text-gray-400 flex-shrink-0 w-12">{dayLabel(a.date)}</span>
                  <ul className="flex-1 list-disc pl-3 space-y-0.5">{a.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
                  <button onClick={() => patch(d.id, { activity: (d.activity ?? []).filter((_, i) => i !== k), timeLogs: d.timeLogs.filter(l => !(a.src && (l.src ?? '').startsWith(a.src + '|'))) })}
                    title="Buang potongan sesi ini (aktivitas + waktunya) — mis. salah cocok" className="self-start hover:text-red-500"><X size={10} /></button>
                </div>
              ))}
            </div>
          </details>
        )}
        {(errs.length > 0 || warns.length > 0 || anoms.length > 0 || d.stage === 'close') && (
          <div className="flex items-center gap-2 pl-[3.25rem] text-[10px] flex-wrap">
            {d.stage === 'close' && <span className="text-emerald-600 font-semibold">✓ lolos cek OP</span>}
            {anoms.map((a, k) => <Anom key={'a' + k} a={a} />)}
            {errs.map((i, k) => <span key={'e' + k} className="text-red-500">✗ {i.msg}</span>)}
            {warns.map((i, k) => <span key={'w' + k} className="text-amber-500">⚠ {i.msg}</span>)}
          </div>
        )}
      </div>
    )
  }

  if (loading) return <div className="px-4 py-3 text-[11px] text-gray-400"><Loader2 size={11} className="inline animate-spin mr-1" />Memuat draf…</div>

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[10px] text-gray-500 flex-wrap px-1">
        <span className="font-bold text-gray-600 dark:text-gray-300">Draf tiket {sprintName}</span>
        <span>① ISL Progress → otomatis saat lolos cek → ② ISL Close → kamu pilih &amp; tekan → ③ Push ke OP (final)</span>
      </div>

      {/* ① */}
      <Stage n={1} title="ISL Progress" sub="belum lolos cek — belum boleh di-push" tone="amber" right={<span className="text-[10px] font-bold text-amber-700 dark:text-amber-400">{progress.length} draf</span>}>
        {progress.map(d => renderRow(d, false))}
        <div className="px-4 py-2 flex items-center gap-2 text-[11px] flex-wrap bg-white/60 dark:bg-gray-900/30">
          <ArrowRightLeft size={12} className="text-blue-500 flex-shrink-0" />
          <span className="text-gray-500">Update tiket yang sudah ada di OP</span>
          <input value={nwUp.id} onChange={e => setNwUp(v => ({ ...v, id: e.target.value }))} onKeyDown={e => e.key === 'Enter' && addUpdate()}
            placeholder="#ID tiket" className="w-24 bg-transparent border-b border-gray-200 dark:border-gray-700 focus:border-blue-400 outline-none py-0.5 text-gray-600" />
          <select value={nwUp.status} onChange={e => setNwUp(v => ({ ...v, status: e.target.value as TargetStatus }))}
            className="bg-transparent border-b border-gray-200 dark:border-gray-700 outline-none py-0.5 text-gray-600">
            <option value="in_progress">→ In progress</option>
            <option value="closed">→ In progress → Closed</option>
          </select>
          <button onClick={addUpdate} disabled={!nwUp.id.trim() || busy === 'new'}
            className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">+ Update</button>
          <span className="text-[10px] text-gray-400">lalu tambah catatan waktu di drafnya</span>
        </div>
        <div className="px-4 py-2 flex items-center gap-2 text-[11px] flex-wrap bg-white/60 dark:bg-gray-900/30">
          <Plus size={12} className="text-violet-500 flex-shrink-0" />
          <input value={nw.subject} onChange={e => setNw(v => ({ ...v, subject: e.target.value }))} onKeyDown={e => e.key === 'Enter' && add()}
            placeholder="Judul tiket (English) — mis. BE - jobs screen: list, filter, retry"
            className="flex-1 min-w-[200px] bg-transparent border-b border-gray-200 dark:border-gray-700 focus:border-violet-400 outline-none py-0.5 text-gray-700 dark:text-gray-200" />
          <input list={`us-${sprintId ?? 'none'}`} value={nw.parent} onChange={e => setNw(v => ({ ...v, parent: e.target.value }))}
            placeholder="User Story #ID" title="Ketik ID atau pilih dari daftar US terbuka"
            className="w-32 bg-transparent border-b border-gray-200 dark:border-gray-700 focus:border-violet-400 outline-none py-0.5 text-gray-500" />
          <datalist id={`us-${sprintId ?? 'none'}`}>
            {parents.map(p => <option key={p.id} value={String(p.id)}>{p.subject} · {p.project}</option>)}
          </datalist>
          <input value={nw.est} onChange={e => setNw(v => ({ ...v, est: e.target.value }))} title="Estimate (jam) — min 1"
            className="w-10 text-right bg-transparent border-b border-gray-200 dark:border-gray-700 focus:border-violet-400 outline-none py-0.5 text-gray-500" />
          <span className="text-[10px] text-gray-400">h</span>
          <button onClick={add} disabled={!nw.subject.trim() || busy === 'new'}
            className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40">
            {busy === 'new' ? <Loader2 size={10} className="inline animate-spin" /> : '+ Draf'}
          </button>
        </div>
      </Stage>

      {/* ② */}
      <Stage n={2} title="ISL Close" sub="sudah OK, masih bisa diubah · centang lalu push" tone="emerald"
        right={<span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400">{close.length} siap{sel.size ? ` · ${sel.size} dipilih` : ''}{anomCount ? ` · ${anomCount} ⚑ anomali` : ''}</span>}>
        {close.map(d => renderRow(d, true))}
        {/* saran */}
        <div className="px-4 py-2.5 space-y-1.5 bg-gray-50/70 dark:bg-gray-900/30">
          <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Saran</p>
          {tot.op != null && (
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-gray-500 w-20">Total sprint</span>
              <div className="flex-1 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                <div className={`h-full ${over > 0 ? 'bg-red-500' : tot.all >= 50 * 60 ? 'bg-emerald-500' : 'bg-blue-400'}`} style={{ width: `${Math.min(100, tot.all / tot.cap * 100)}%` }} />
              </div>
              <span className={`font-bold ${over > 0 ? 'text-red-600' : 'text-gray-600 dark:text-gray-300'}`}>{fmtH(tot.all)}</span>
              <span className="text-gray-400 text-[10px]">{fmtH(tot.op)} di OP + {fmtH(tot.all - tot.op)} draf · maks {fmtH(tot.cap)}{over > 0 ? ` · lewat ${fmtH(over)}` : ''}</span>
            </div>
          )}
          {over > 0 && next && planned.length > 0 && (
            <Sugg icon={<ArrowRight size={12} />} text={<><b>Geser ke {next.name}</b> — {planned.length} rencana belum dikerjakan ({fmtH(planned.reduce((a, d) => a + (d.estimatedMins ?? 0), 0))}): {planned.map(d => `"${d.subject}"`).join(', ')}</>}
              btn="Geser" onClick={() => action({ action: 'move', ids: planned.map(d => d.id), sprintId: next.id }, `${planned.length} rencana digeser ke ${next.name}`)} disabled={busy === 'action'} />
          )}
          {over > 0 && next && doneOnes.length > 0 && doneOnes.map(d => (
            <Sugg key={'mv' + d.id} icon={<ArrowRightLeft size={12} />} text={<><b>Jadikan bagian {next.name}</b> — &quot;{d.subject}&quot; ({fmtH(d.estimatedMins ?? 0)}), tanggal kerja tetap asli (badge ⚑ akan muncul). Push sebelum akhir bulan (kunci bulan OP).</>}
              btn="Pindahkan" onClick={() => action({ action: 'move', ids: [d.id], sprintId: next.id }, `"${d.subject}" dijadikan bagian ${next.name}`)} disabled={busy === 'action'} />
          ))}
          {groups.map(g => (
            <Sugg key={'mg' + g[0].parentId} icon={<Merge size={12} />} text={<><b>Gabung</b> — {g.length} draf di US #{g[0].parentId} ({g.map(d => fmtH(d.estimatedMins ?? 0)).join(' + ')}) jadi 1 tiket. Judul gabungan bisa kamu rapikan.</>}
              btn="Gabung" onClick={() => action({ action: 'merge', ids: g.map(d => d.id) }, `${g.length} draf digabung jadi 1`)} disabled={busy === 'action'} />
          ))}
          {next && splittable.map(d => (
            <Sugg key={'sp' + d.id} icon={<Scissors size={12} />} text={<><b>Pecah</b> — &quot;{d.subject}&quot; baru {Math.round(spentOf(d) / (d.estimatedMins || 1) * 100)}%: tutup bagian yang sudah dikerjakan sekarang, sisanya jadi draf {next.name}. Persempit judul bagian yang ditutup.</>}
              btn="Pecah" onClick={() => action({ action: 'split', id: d.id, nextSprintId: next.id }, `Dipecah: bagian selesai ditutup, sisa ke ${next.name}`)} disabled={busy === 'action'} />
          ))}
          {!(over > 0) && !groups.length && !splittable.length && <p className="text-[10px] text-gray-400">Tidak ada saran — kapasitas aman, tak ada yang perlu digabung/dipecah.</p>}
        </div>
      </Stage>

      {/* ③ */}
      <Stage n={3} title="Push ke OP" sub="tidak pernah otomatis — cek terakhir dulu" tone="violet"
        right={!review && (
          <div className="flex items-center gap-1.5">
            <button onClick={() => openReview([...sel])} disabled={!sel.size || busy === 'review'}
              className="text-[10px] font-bold px-2 py-0.5 rounded-lg border border-violet-300 text-violet-700 dark:text-violet-300 bg-white dark:bg-gray-900 hover:bg-violet-50 disabled:opacity-30">
              {busy === 'review' ? <Loader2 size={10} className="inline animate-spin" /> : <><Send size={9} className="inline mr-1" />Push yang dipilih ({sel.size})</>}
            </button>
            <button onClick={() => openReview(close.map(d => d.id))} disabled={!close.length || busy === 'review'}
              className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-30">
              Push semua yang siap ({close.length})
            </button>
          </div>
        )}>
        {review && (() => {
          const items = review.ids.map(id => drafts.find(d => d.id === id)).filter(Boolean) as Draft[]
          const blocked = review.results.filter(r => !r.ok)
          const warns = [...new Set(review.results.flatMap(r => r.issues.filter(i => i.level === 'warn').map(i => i.msg)))]
          const anoms = items.flatMap(d => anomaliesOf(d, sprintStart).map(a => ({ ...a, subject: d.subject })))
          return (
            <div className="px-4 py-3 space-y-2 text-[11px] bg-violet-50/40 dark:bg-violet-950/10">
              <p className="font-bold text-gray-700 dark:text-gray-200">{items.length} tiket akan jadi FINAL di OP dan tidak diubah lagi:</p>
              <ul className="space-y-0.5 pl-4 list-disc text-gray-600 dark:text-gray-300">
                {items.map(d => <li key={d.id}><b>{d.subject}</b> <span className="text-gray-400">— {stepsOf(d)}</span></li>)}
              </ul>
              {warns.map((w, k) => <p key={'w' + k} className="text-amber-600">⚠ {w}</p>)}
              {anoms.map((a, k) => <p key={'a' + k}><Anom a={a} /> <span className="text-gray-500">&quot;{a.subject}&quot; — {a.title}</span></p>)}
              {blocked.map(r => <p key={r.id} className="text-red-500">✗ &quot;{r.subject}&quot;: {r.issues.filter(i => i.level === 'error').map(i => i.msg).join('; ')}</p>)}
              <div className="flex items-center gap-2 pt-1">
                <button onClick={pushNow} disabled={!!blocked.length || busy === 'push'}
                  title={blocked.length ? 'Ada yang tak lolos cek terakhir — batalkan & perbaiki' : ''}
                  className="text-[11px] font-bold px-3 py-1 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-30">
                  {busy === 'push' ? <Loader2 size={11} className="inline animate-spin" /> : `Ya, push ${items.length} tiket`}
                </button>
                <button onClick={() => setReview(null)} className="text-[11px] text-gray-500 hover:underline">Batal</button>
              </div>
            </div>
          )
        })()}
        {results && (
          <div className="px-4 py-2 space-y-0.5 text-[10px]">
            <div className="flex items-center justify-between">
              <span className="font-bold text-gray-600 dark:text-gray-300">Hasil push: {results.filter(r => r.ok).length}/{results.length} tuntas</span>
              <button onClick={() => setResults(null)} className="text-gray-400 hover:text-gray-600"><X size={10} /></button>
            </div>
            {results.map(r => (
              <div key={r.id} className={r.ok ? 'text-emerald-600' : 'text-red-500'}>
                {r.ok ? '✓' : '✗'} {r.opWpId ? `#${r.opWpId} ` : ''}{r.subject}
                {r.steps?.length ? <span className="text-gray-400"> — {r.steps.join(' → ')}</span> : null}
                {!r.ok && <span> — {r.issues.filter(i => i.level === 'error').map(i => i.msg).join('; ')}</span>}
              </div>
            ))}
          </div>
        )}
      </Stage>
      {msg && <div className="px-2 text-[10px] font-semibold text-violet-700 dark:text-violet-300">{msg}</div>}
      <p className="px-1 text-[9px] text-gray-400"><ShieldCheck size={9} className="inline" /> Cek = aturan kita + validasi OP sendiri tanpa menyimpan. ⚑ = anomali, memberi tahu, tidak menghalangi push.</p>
    </div>
  )
}

function Stage({ n, title, sub, tone, right, children }: { n: number; title: string; sub: string; tone: 'amber' | 'emerald' | 'violet'; right?: ReactNode; children?: ReactNode }) {
  const head = { amber: 'bg-amber-50 dark:bg-amber-950/30', emerald: 'bg-emerald-50 dark:bg-emerald-950/30', violet: 'bg-violet-50 dark:bg-violet-950/30' }[tone]
  const dot = { amber: 'bg-amber-500', emerald: 'bg-emerald-600', violet: 'bg-violet-600' }[tone]
  return (
    <div className="rounded-2xl border border-gray-100 dark:border-gray-700/50 bg-white dark:bg-gray-800/60 overflow-hidden">
      <div className={`flex items-center gap-2 px-4 py-2 flex-wrap ${head}`}>
        <span className={`w-5 h-5 rounded-full grid place-items-center text-[10px] font-black text-white flex-shrink-0 ${dot}`}>{n}</span>
        <span className="text-xs font-black text-gray-700 dark:text-gray-100">{title}</span>
        <span className="text-[10px] text-gray-500">{sub}</span>
        <div className="flex-1" />
        {right}
      </div>
      {children && <div className="divide-y divide-gray-100 dark:divide-gray-700/50">{children}</div>}
    </div>
  )
}

function Sugg({ icon, text, btn, onClick, disabled }: { icon: ReactNode; text: ReactNode; btn: string; onClick: () => void; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-[11px] bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-lg px-2.5 py-1.5">
      <span className="text-violet-500 flex-shrink-0">{icon}</span>
      <span className="flex-1 min-w-0 text-gray-600 dark:text-gray-300">{text}</span>
      <button onClick={onClick} disabled={disabled}
        className="text-[10px] font-bold px-2 py-0.5 rounded-lg border border-violet-300 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950 disabled:opacity-40 flex-shrink-0">{btn}</button>
    </div>
  )
}
