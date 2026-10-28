'use client'

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'

const BRAND = '#1d3a5c'
const PCT_OPTS = [0, 25, 50, 75, 100]

interface TimeEntry {
  id: number
  minutes: number
  spentOn: string
  comment: string
  user: string
}

interface Detail {
  id: number; subject: string; type: string; status: string; statusId: number | null
  project: string; assignee: string | null; accountable: string | null; version: string | null
  estimatedHours: number | null; spentHours: number | null; remainingHours: number | null
  percentDone: number; date: string | null; description: string; parent: { id: number; subject: string } | null
  comments: { user: string; at: string; text: string }[]
}

const STATUSES = [
  { id: 1, label: 'New' }, { id: 7, label: 'In progress' }, { id: 8, label: 'On hold' },
  { id: 12, label: 'Closed' }, { id: 14, label: 'Rejected' },
]

function fmtH(h: number | null): string {
  if (h == null || h < 0) return '—'
  if (h < 1 / 60) return '0m'
  if (h < 1) return `${Math.round(h * 60)}m`
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60)
  return mm > 0 ? `${hh}h ${mm}m` : `${hh}h`
}

function StatPill({ label, value, color }: { label: string; value: string; color: string }) {
  const cls: Record<string, string> = {
    violet:  'bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300',
    blue:    'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300',
    emerald: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300',
    amber:   'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300',
    gray:    'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300',
  }
  return (
    <div className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] ${cls[color] ?? cls.gray}`}>
      <span className="font-medium opacity-70">{label}</span>
      <span className="font-bold">{value}</span>
    </div>
  )
}

export default function OpTaskModal({ wpId, opUrl, onClose, onSaved, onChat }: {
  wpId: number
  opUrl: string
  onClose: () => void
  onSaved?: () => void
  onChat?: () => void
}) {
  const [d, setD]             = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [msg, setMsg]         = useState<string | null>(null)

  const [statusId, setStatusId] = useState<number | null>(null)
  const [estH, setEstH]         = useState<string>('')
  const [pct, setPct]           = useState<number>(0)
  const [spentH, setSpentH]     = useState<string>('')
  const [spentM, setSpentM]     = useState<string>('')
  const [comment, setComment]   = useState<string>('')
  const [subject, setSubject]   = useState<string>('')          // editable OP title
  const [suggestingTitle, setSuggestingTitle] = useState(false)

  // "Catatan Otomatis": AI-drafted progress note for the OP activity log
  const [drafting, setDrafting]           = useState(false)
  const [guardBanner, setGuardBanner]     = useState(false)
  const [guardTriggered, setGuardTriggered] = useState(false)

  const [entries, setEntries]       = useState<TimeEntry[]>([])
  const [entriesOpen, setEntriesOpen] = useState(false)
  const [loadingEntries, setLoadingEntries] = useState(false)
  const [editing, setEditing]       = useState<{ id: number; h: string; m: string; date: string; comment: string } | null>(null)
  const [confirmDel, setConfirmDel] = useState<number | null>(null)
  const [entryBusy, setEntryBusy]   = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/op/wp-detail?wpId=${wpId}`)
      .then(r => r.json())
      .then((data: Detail & { error?: string }) => {
        if (data.error) { setMsg(`⚠️ ${data.error}`); return }
        setD(data)
        setStatusId(data.statusId)
        setEstH(data.estimatedHours != null ? String(data.estimatedHours) : '')
        setPct(data.percentDone ?? 0)
        setSpentH('')
        setSpentM('')
        setSubject(data.subject ?? '')
      })
      .catch(e => setMsg(`⚠️ ${String(e)}`))
      .finally(() => setLoading(false))
  }, [wpId])

  useEffect(() => { load() }, [load])

  // Closed/Rejected always 100% done
  useEffect(() => {
    if (statusId === 12 || statusId === 14) setPct(100)
  }, [statusId])

  const loadEntries = useCallback(() => {
    setLoadingEntries(true)
    fetch(`/api/op/time-entries?wpId=${wpId}`)
      .then(r => r.json())
      .then(d => setEntries(d.entries ?? []))
      .catch(() => {})
      .finally(() => setLoadingEntries(false))
  }, [wpId])

  useEffect(() => { if (entriesOpen) loadEntries() }, [entriesOpen, loadEntries])

  async function saveEntry() {
    if (!editing || entryBusy) return
    setEntryBusy(true)
    const minutes = (parseInt(editing.h || '0') || 0) * 60 + (parseInt(editing.m || '0') || 0)
    const res = await fetch('/api/op/time-entries', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entryId: editing.id, minutes, date: editing.date, comment: editing.comment, wpId }),
    }).then(r => r.json()).catch(() => ({ error: 'network' }))
    setEntryBusy(false)
    if (!res.error) { setEditing(null); loadEntries(); load() }
    else setMsg(`⚠️ Edit gagal: ${String(res.error).slice(0, 100)}`)
  }

  async function deleteEntry(id: number) {
    setEntryBusy(true)
    const res = await fetch('/api/op/time-entries', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entryId: id, wpId }),
    }).then(r => r.json()).catch(() => ({ error: 'network' }))
    setEntryBusy(false)
    setConfirmDel(null)
    if (!res.error) { loadEntries(); load() }
    else setMsg(`⚠️ Hapus gagal: ${String(res.error).slice(0, 100)}`)
  }

  function fmtMins(m: number): string {
    if (m <= 0) return '0m'
    const h = Math.floor(m / 60), rem = m % 60
    return h > 0 ? (rem > 0 ? `${h}h ${rem}m` : `${h}h`) : `${rem}m`
  }

  // Remaining preview: recalculates as user changes pct / est / spent inputs
  const estHVal        = parseFloat(estH || '0') || 0
  const currentSpent   = d?.spentHours ?? 0
  const newSpentHours  = (parseInt(spentH || '0') || 0) + (parseInt(spentM || '0') || 0) / 60
  const totalSpentPrev = currentSpent + newSpentHours
  const remainPreview  = pct >= 100 ? 0 : Math.max(0, estHVal - totalSpentPrev)

  // Draft an ENGLISH progress note from the ticket's work history (task_memory,
  // sessions, chat, OP description). Returns null on any failure — never blocks.
  async function draftNote(): Promise<string | null> {
    const statusChanged = d != null && statusId !== d.statusId
    const statusTo   = statusChanged ? STATUSES.find(s => s.id === statusId)?.label : undefined
    const statusFrom = statusChanged ? d?.status : undefined
    const res = await fetch('/api/op/activity-summary', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'task-note', opTaskId: wpId, statusFrom, statusTo }),
    }).then(r => r.json()).catch(() => null)
    const summary = res && !res.error ? String(res.summary ?? '').trim() : ''
    return summary || null
  }

  async function handleDraftClick() {
    if (drafting || saving) return
    setDrafting(true); setMsg(null)
    const note = await draftNote()
    setDrafting(false)
    if (note) setComment(prev => prev.trim() ? `${prev.trimEnd()}\n\n${note}` : note)
    else setMsg('⚠️ Gagal membuat draft catatan')
  }

  // ✨ Suggest a clearer OP title from this item's description + activity
  // history (work-log comments). Suggest-only — fills the editable Subject
  // field; the rename only reaches OP when the user clicks Simpan. Works for
  // whatever this modal is showing (User Story or Task).
  async function suggestTitle() {
    if (!d || suggestingTitle || saving) return
    const srcLines = [
      ...(d.description ? [d.description.slice(0, 800)] : []),
      ...d.comments.flatMap(c => c.text.split('\n')),
    ].map(s => s.trim()).filter(l => l.length > 4).slice(0, 25)
    if (!srcLines.length) { setMsg('⚠️ Belum ada deskripsi/aktivitas untuk jadi dasar judul'); return }
    setSuggestingTitle(true); setMsg(null)
    try {
      const r = await fetch('/api/suggest/title', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bullets: srcLines, current: subject }),
      })
      const res = await r.json()
      if (r.ok && res.title) setSubject(String(res.title).slice(0, 200))
      else setMsg('⚠️ Gagal menyarankan judul')
    } catch { setMsg('⚠️ Gagal menyarankan judul') } finally { setSuggestingTitle(false) }
  }

  async function save(bypassGuard = false, skipComment = false) {
    if (!d || saving || drafting) return

    // SAVE GUARD ("Catatan Otomatis"): status changed + no note + not yet
    // intercepted this open → draft a note from work history ONCE, fill the
    // textarea and ask the user to review. Never auto-submits; if the draft
    // fails, fall through to the normal save (AI must never block a save).
    if (!bypassGuard && statusId !== d.statusId && !comment.trim() && !guardTriggered) {
      setGuardTriggered(true)
      setDrafting(true); setMsg(null)
      const note = await draftNote()
      setDrafting(false)
      if (note) {
        setComment(note)
        setGuardBanner(true)
        return
      }
      // draft failed → proceed with the original save below
    }

    setGuardBanner(false)
    setSaving(true); setMsg(null)
    try {
      // 1) status / estimate + pass spentMins so wp-update can set remaining correctly
      const estMins    = estH.trim() ? Math.round(parseFloat(estH) * 60) : undefined
      const spentHNum  = parseInt(spentH || '0') || 0
      const spentMNum  = parseInt(spentM || '0') || 0
      let totalMins    = spentHNum * 60 + spentMNum

      // Auto-fill Spent = Estimasi when a task is CLOSED with zero spent
      // recorded (Rian's decision 2026-07-24): closing a task that was never
      // timer-tracked shouldn't leave Spent stuck at 0 forever — assume the
      // planned work was done as estimated rather than leaving a misleading gap.
      // Only fires on the transition INTO Closed, and only if total spent
      // (existing OP spent + whatever's typed here) is still genuinely zero.
      let autoFilledSpent = false
      const closingNow = statusId === 12 && d.statusId !== 12
      const existingSpentMins = Math.round((d.spentHours ?? 0) * 60)
      const effEstMins = estMins ?? Math.round((d.estimatedHours ?? 0) * 60)
      if (closingNow && existingSpentMins + totalMins === 0) {
        if (effEstMins > 0) { totalMins = effEstMins; autoFilledSpent = true }
      }

      // Cap total Spent at the Estimate (Rian's rule 2026-07-27: spent boleh =
      // atau < estimasi, tidak boleh LEBIH). If adding this would push total
      // spent past the estimate, trim the added amount so total lands exactly
      // at the estimate — and tell the user (with the escape hatch: raise the
      // Est first if the work genuinely took longer). Never silently swallow.
      let cappedSpent = false
      if (effEstMins > 0 && existingSpentMins + totalMins > effEstMins) {
        totalMins = Math.max(0, effEstMins - existingSpentMins)
        cappedSpent = true
      }

      const upd = await fetch('/api/op/wp-update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wpId,
          statusId:      statusId !== d.statusId ? statusId : undefined,
          estimatedMins: estMins,
          addSpentMins:  totalMins > 0 ? totalMins : undefined,
          subject:       subject.trim() && subject.trim() !== d.subject ? subject.trim() : undefined,
        }),
      }).then(r => r.json())
      if (upd.error) throw new Error(upd.error)

      // 2) add spent time entry to OP — duration derived from totalMins directly
      // (not spentHNum/spentMNum) so the auto-fill-on-close path above also
      // produces a correct duration string, not "0m".
      if (totalMins > 0) {
        const h = Math.floor(totalMins / 60), m = totalMins % 60
        const dur = h > 0 && m > 0 ? `${h}h${m}m` : h > 0 ? `${h}h` : `${m}m`
        await fetch('/api/op/timelog', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wpId, duration: dur, date: new Date().toISOString().slice(0, 10), title: autoFilledSpent ? 'Auto-filled on close (= estimasi) via ISL' : 'Update via ISL' }),
        }).catch(() => {})
      }

      // 3) comment
      if (!skipComment && comment.trim()) {
        await fetch('/api/op/comment', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wpId, comment: comment.trim() }),
        }).catch(() => {})
      }

      const base = upd.pctSkipped ? '✅ Tersimpan ke OP (% Complete dikelola otomatis oleh Status)' : '✅ Tersimpan ke OP'
      const note = autoFilledSpent
        ? ` — Spent otomatis diisi = estimasi (${estH || fmtH(d.estimatedHours)}), belum pernah ditrack sebelumnya`
        : cappedSpent
          ? ` — Spent dibatasi = estimasi (max). Kalau kerjanya memang lebih lama, naikkan dulu Est-nya lalu isi lagi.`
          : ''
      setMsg(base + note)
      setComment('')
      load()
      onSaved?.()
    } catch (e) {
      setMsg(`⚠️ Gagal: ${String(e).slice(0, 140)}`)
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-start sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white dark:bg-gray-900 w-full sm:w-[92vw] sm:max-w-6xl sm:rounded-2xl shadow-2xl flex flex-col my-0 sm:my-4" style={{ height: '90vh', maxHeight: '90vh' }}>

        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-3 border-b border-gray-100 dark:border-gray-800"
          style={{ background: BRAND, borderRadius: '16px 16px 0 0' }}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-blue-200 uppercase tracking-widest">{d?.type ?? 'Task'}</span>
              <span className="text-[10px] text-blue-300">#{wpId}</span>
              {d?.version && <span className="text-[10px] text-blue-300">· {d.version}</span>}
            </div>
            <p className="text-sm font-bold text-white leading-tight mt-0.5">{d?.subject ?? `#${wpId}`}</p>
            {d?.parent && <p className="text-[10px] text-blue-300/80 mt-0.5">↳ #{d.parent.id} {d.parent.subject}</p>}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <a href={`${opUrl}/work_packages/${wpId}`} target="_blank" rel="noopener"
              className="text-[10px] font-bold px-2 py-1 rounded-lg text-white border border-white/30 hover:bg-white/20">↗ OP</a>
            {onChat && (
              <button onClick={onChat} className="text-[10px] font-bold px-2 py-1 rounded-lg text-white border border-white/30 hover:bg-white/20">💬 Chat</button>
            )}
            <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-white/70 hover:text-white hover:bg-white/20">✕</button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : !d ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">{msg ?? 'Gagal memuat'}</div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

            {/* Meta row */}
            <div className="grid grid-cols-2 gap-x-6 text-[12px]">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide w-20 flex-shrink-0">Assignee</span>
                <span className="text-gray-700 dark:text-gray-200 truncate">{d.assignee ?? '—'}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide w-20 flex-shrink-0">Project</span>
                <span className="text-gray-700 dark:text-gray-200 truncate">{d.project || '—'}</span>
              </div>
            </div>

            {/* Stat pills: current OP values */}
            <div className="flex items-center gap-2 flex-wrap">
              <StatPill label="Est"       value={fmtH(d.estimatedHours)} color="violet" />
              <StatPill label="Spent"     value={fmtH(d.spentHours)}     color="blue" />
              <StatPill label="Remaining" value={fmtH(d.remainingHours)} color={(d.remainingHours ?? 1) === 0 ? 'emerald' : 'amber'} />
              <StatPill label="Done"      value={`${d.percentDone}%`}    color={d.percentDone >= 100 ? 'emerald' : 'gray'} />
            </div>

            <div className="h-px bg-gray-100 dark:bg-gray-800" />

            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Edit langsung ke OP</p>

            {/* Subject (editable) + AI suggest */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Judul {d.type}</p>
                <button onClick={suggestTitle} disabled={suggestingTitle || saving}
                  className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 disabled:opacity-50 transition"
                  title="Sarankan judul lebih jelas dari deskripsi + riwayat activity (AI)">
                  {suggestingTitle
                    ? <><span className="w-3 h-3 border-2 border-indigo-200 dark:border-indigo-800 border-t-indigo-500 rounded-full animate-spin" />Menyusun…</>
                    : '✨ Suggest Judul'}
                </button>
              </div>
              <input value={subject} onChange={e => setSubject(e.target.value)}
                className="w-full text-[12px] border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100" />
              {d.subject && subject.trim() && subject.trim() !== d.subject && (
                <p className="mt-1 text-[9px] text-amber-600 dark:text-amber-400">Judul diubah — akan ditulis ke OP saat Simpan.</p>
              )}
            </div>

            {/* Status + Est */}
            <div className="grid grid-cols-2 gap-x-6">
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">Status</p>
                <select value={statusId ?? ''} onChange={e => setStatusId(Number(e.target.value))}
                  className="w-full text-[12px] border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800">
                  {STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">Work / Est (jam)</p>
                <input type="number" step="0.25" min="0" value={estH} onChange={e => setEstH(e.target.value)}
                  placeholder="mis. 2"
                  className="w-full text-[12px] border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800" />
              </div>
            </div>

            {/* % Complete — view only, derived from Status in OP */}
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">
                % Complete <span className="normal-case font-normal text-gray-400">(dihitung OP dari spent vs sisa — bukan status)</span>
              </p>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                    style={{ width: `${pct}%` }} />
                </div>
                <span className={`text-[13px] font-bold w-10 text-right ${pct >= 100 ? 'text-emerald-600' : 'text-indigo-600'}`}>{pct}%</span>
              </div>
            </div>

            {/* + Spent + Remaining preview */}
            <div className="grid grid-cols-2 gap-x-6">
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">+ Spent <span className="normal-case font-normal text-gray-400">(isi manual, tanpa timer)</span></p>
                <div className="flex items-center gap-1.5">
                  <input type="number" min="0" value={spentH} onChange={e => setSpentH(e.target.value)}
                    placeholder="0"
                    className="w-14 text-center text-[12px] border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800" />
                  <span className="text-[11px] text-gray-400 font-medium">jam</span>
                  <input type="number" min="0" max="59" value={spentM} onChange={e => setSpentM(e.target.value)}
                    placeholder="0"
                    className="w-14 text-center text-[12px] border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800" />
                  <span className="text-[11px] text-gray-400 font-medium">menit</span>
                </div>
                <p className="text-[9px] text-gray-400 mt-1">Sudah dikerjakan berapa lama? Isi di sini → otomatis jadi In progress. Maks = estimasi.</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Remaining (setelah simpan)</p>
                <div className="flex items-center h-[34px]">
                  <span className={`text-[15px] font-bold ${pct >= 100 ? 'text-emerald-500' : 'text-gray-700 dark:text-gray-200'}`}>
                    {pct >= 100 ? '0m ✅' : fmtH(remainPreview)}
                  </span>
                </div>
              </div>
            </div>

            {/* Time Entries */}
            <div className="border border-gray-100 dark:border-gray-800 rounded-xl overflow-hidden">
              <button
                onClick={() => setEntriesOpen(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-bold text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
              >
                <span>🕐 Time Entries {entries.length > 0 ? `(${entries.length})` : ''}</span>
                <span>{entriesOpen ? '▲' : '▼'}</span>
              </button>
              {entriesOpen && (
                <div className="px-3 pb-3 space-y-1.5">
                  {loadingEntries && <p className="text-[11px] text-gray-400 py-2">Memuat…</p>}
                  {!loadingEntries && entries.length === 0 && (
                    <p className="text-[11px] text-gray-400 py-2">Belum ada time entry tercatat.</p>
                  )}
                  {entries.map(e => (
                    <div key={e.id} className="rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-2.5 py-1.5">
                      {editing?.id === e.id ? (
                        /* ── inline edit form ── */
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <input type="number" min="0" value={editing.h} onChange={ev => setEditing(p => p && ({ ...p, h: ev.target.value }))}
                              placeholder="0" className="w-12 text-center text-[11px] border border-gray-200 dark:border-gray-600 rounded px-1 py-1 bg-white dark:bg-gray-700" />
                            <span className="text-[10px] text-gray-400">jam</span>
                            <input type="number" min="0" max="59" value={editing.m} onChange={ev => setEditing(p => p && ({ ...p, m: ev.target.value }))}
                              placeholder="0" className="w-12 text-center text-[11px] border border-gray-200 dark:border-gray-600 rounded px-1 py-1 bg-white dark:bg-gray-700" />
                            <span className="text-[10px] text-gray-400">menit</span>
                            <input type="date" value={editing.date} onChange={ev => setEditing(p => p && ({ ...p, date: ev.target.value }))}
                              className="text-[11px] border border-gray-200 dark:border-gray-600 rounded px-1 py-1 bg-white dark:bg-gray-700" />
                          </div>
                          <input type="text" value={editing.comment} onChange={ev => setEditing(p => p && ({ ...p, comment: ev.target.value }))}
                            placeholder="catatan…"
                            className="w-full text-[11px] border border-gray-200 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700" />
                          <div className="flex gap-1.5">
                            <button onClick={saveEntry} disabled={entryBusy}
                              className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition">
                              {entryBusy ? '…' : '✓ Simpan'}
                            </button>
                            <button onClick={() => setEditing(null)} disabled={entryBusy}
                              className="text-[10px] font-bold px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
                              Batal
                            </button>
                          </div>
                        </div>
                      ) : confirmDel === e.id ? (
                        /* ── delete confirm ── */
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-red-500 font-semibold flex-1">Hapus entry ini?</span>
                          <button onClick={() => deleteEntry(e.id)} disabled={entryBusy}
                            className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition">
                            {entryBusy ? '…' : 'Ya, hapus'}
                          </button>
                          <button onClick={() => setConfirmDel(null)} className="text-[10px] text-gray-400 hover:text-gray-600 px-1">Batal</button>
                        </div>
                      ) : (
                        /* ── normal row ── */
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 w-12 flex-shrink-0">{fmtMins(e.minutes)}</span>
                          <span className="text-[10px] text-gray-400 flex-shrink-0">{e.spentOn}</span>
                          <span className="text-[11px] text-gray-600 dark:text-gray-300 flex-1 truncate">{e.comment || <span className="italic text-gray-300">–</span>}</span>
                          <button
                            onClick={() => setEditing({ id: e.id, h: String(Math.floor(e.minutes / 60)), m: String(e.minutes % 60), date: e.spentOn, comment: e.comment })}
                            className="text-[10px] text-gray-400 hover:text-blue-500 px-1 flex-shrink-0 transition" title="Edit">✏️</button>
                          <button onClick={() => setConfirmDel(e.id)}
                            className="text-[10px] text-gray-400 hover:text-red-500 px-1 flex-shrink-0 transition" title="Hapus">🗑</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Comment */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">+ Komentar / progress note</p>
                <button onClick={handleDraftClick} disabled={drafting || saving}
                  className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 disabled:opacity-50 transition"
                  title="Buat draft catatan progress (English) dari riwayat kerja">
                  {drafting
                    ? <><span className="w-3 h-3 border-2 border-indigo-200 dark:border-indigo-800 border-t-indigo-500 rounded-full animate-spin" />Menyusun…</>
                    : '✨ Draft Catatan'}
                </button>
              </div>
              <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2}
                placeholder="catatan progress (opsional)…"
                className="w-full text-[12px] border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 resize-none" />
              {guardBanner && (
                <div className="mt-1.5 flex items-center gap-2 flex-wrap rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1.5">
                  <span className="text-[11px] text-amber-700 dark:text-amber-300 flex-1 min-w-[160px]">
                    Catatan dibuat otomatis dari riwayat kerja — cek sebentar, lalu klik Simpan lagi.
                  </span>
                  <button onClick={() => { setGuardBanner(false); setComment(''); void save(true, true) }}
                    className="text-[10px] font-bold text-amber-700 dark:text-amber-300 underline hover:text-amber-900 dark:hover:text-amber-100 flex-shrink-0">
                    simpan tanpa catatan
                  </button>
                </div>
              )}
            </div>

            {d.description && (
              <details open className="text-[13px]">
                <summary className="cursor-pointer text-[11px] text-gray-400 font-bold uppercase tracking-widest">Deskripsi OP</summary>
                <p className="mt-1.5 whitespace-pre-wrap leading-relaxed text-gray-700 dark:text-gray-300">{d.description}</p>
              </details>
            )}

            {d.comments.length > 0 && (
              <div>
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">Activity ({d.comments.length})</p>
                <div className="space-y-3">
                  {d.comments.map((c, i) => (
                    <div key={i} className="text-[13px] border-l-2 border-gray-200 dark:border-gray-700 pl-3">
                      <span className="font-semibold text-gray-700 dark:text-gray-300">{c.user}</span>
                      <span className="text-gray-400 text-[10px] ml-1.5">{c.at.slice(0, 16).replace('T', ' ')}</span>
                      <p className="mt-0.5 text-gray-600 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">{c.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        {d && (
          <div className="flex items-center gap-2 px-5 py-3 border-t border-gray-100 dark:border-gray-800">
            {msg && (
              <span className={`text-[11px] font-semibold ${msg.startsWith('✅') ? 'text-emerald-600' : 'text-amber-600'}`}>
                {msg}
              </span>
            )}
            <button onClick={() => { void save() }} disabled={saving || drafting}
              className="ml-auto px-4 py-1.5 text-[11px] font-bold text-white rounded-lg disabled:opacity-50 transition"
              style={{ background: BRAND }}>
              {saving ? 'Menyimpan…' : drafting ? 'Menyusun catatan…' : '💾 Simpan ke OP'}
            </button>
            <button onClick={onClose} className="text-[11px] text-gray-400 hover:text-gray-600 px-2">Tutup</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
