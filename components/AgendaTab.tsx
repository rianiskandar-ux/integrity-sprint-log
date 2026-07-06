'use client'

import { useState, useEffect } from 'react'
import {
  ClipboardList, Save, Sparkles, Loader2, BookOpen,
  ChevronRight, CheckCircle2, RefreshCw, Check,
  Upload, Square, CheckSquare, ExternalLink, Copy, Users,
} from 'lucide-react'

interface AgendaData {
  sprintName: string
  retrospective: string
  keyWins: string[]
  carriedOver: number
  doneCount: number
  notes: string
}

interface OPMeeting {
  id: number
  title: string
  state: string
  startTime: string
  project: string
  projectId: number | null
  autoMatched: boolean
}

export default function AgendaTab({ currentSprintNo }: { currentSprintNo: number }) {
  const storageKey = `agenda-${currentSprintNo}`
  const opUrl = 'https://tokek.integrity-asia.com'

  const [agenda,        setAgenda]       = useState<AgendaData>({ sprintName: '', retrospective: '', keyWins: [], carriedOver: 0, doneCount: 0, notes: '' })
  const [loading,       setLoading]      = useState(false)
  const [posting,       setPosting]      = useState(false)
  const [toast,         setToast]        = useState<string | null>(null)
  const [showPost,      setShowPost]     = useState(false)
  const [meetings,      setMeetings]     = useState<OPMeeting[]>([])
  const [meetLoading,   setMeetLoading]  = useState(false)
  const [selectedMeets, setSelectedMeets] = useState<Set<number>>(new Set())
  const [agendaTitle,   setAgendaTitle]  = useState('')
  const [durMins,       setDurMins]      = useState(15)
  const [postDone,      setPostDone]     = useState<number[]>([])
  const [savedSummaries, setSavedSummaries] = useState<{ sprint: string; summary: string; savedAt: string }[]>([])
  const [saving,        setSaving]       = useState(false)
  const [showSaved,     setShowSaved]    = useState(false)
  // Ringkasan Stakeholder (Bahasa Indonesia, non-teknis, copy-only — never posted to OP)
  const stkKey = `stakeholder-summary-${currentSprintNo}`
  const [stkSummary,    setStkSummary]   = useState('')
  const [stkLoading,    setStkLoading]   = useState(false)
  const [stkCopied,     setStkCopied]    = useState(false)
  // Track owned agenda item IDs: { [meetingId]: itemId } per sprint
  const idsKey = `agenda-item-ids-${currentSprintNo}`
  function getOwnedIds(): Record<number, number> {
    try { return JSON.parse(localStorage.getItem(idsKey) ?? '{}') } catch { return {} }
  }
  function saveOwnedId(meetingId: number, itemId: number) {
    const ids = getOwnedIds()
    ids[meetingId] = itemId
    localStorage.setItem(idsKey, JSON.stringify(ids))
  }

  useEffect(() => {
    const saved = localStorage.getItem(storageKey)
    if (saved) { try { setAgenda(JSON.parse(saved)) } catch { /* ignore */ } }
    setStkSummary(localStorage.getItem(stkKey) ?? '')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSprintNo])

  useEffect(() => {
    if (agenda.sprintName && !agendaTitle) setAgendaTitle(`Sprint Summary — ${agenda.sprintName}`)
  }, [agenda.sprintName, agendaTitle])

  function save(next: Partial<AgendaData>) {
    const updated = { ...agenda, ...next }
    setAgenda(updated)
    localStorage.setItem(storageKey, JSON.stringify(updated))
  }

  async function generate() {
    setLoading(true)
    try {
      // Parse safely — if a route returns an HTML error/redirect page, don't crash
      // on .json(); surface the reason instead.
      const safeJson = async (url: string) => {
        const r = await fetch(url)
        const body = await r.text()
        try { return JSON.parse(body) }
        catch { return { error: r.ok ? body.slice(0, 160) : `HTTP ${r.status}` } }
      }
      const [planRes, aiRes] = await Promise.all([
        safeJson('/api/op/sprint-plan'),
        safeJson('/api/op/sprint-plan/ai'),
      ])
      const sprint = planRes.currentSprint?.name ?? `Sprint #${currentSprintNo}`
      const done   = (planRes.doneTasks ?? []).length
      const carry  = (planRes.carryOver ?? []).length
      // Surface why nothing came back instead of failing silently.
      const retro  = aiRes.aiSummary
        ?? (aiRes.error ? `⚠️ AI error: ${String(aiRes.error).slice(0, 160)}`
                        : '⚠️ AI tidak mengembalikan hasil. Pastikan Claude Code sudah login (claude di terminal), lalu coba lagi.')
      const updated = { ...agenda, sprintName: sprint, retrospective: retro, keyWins: [], doneCount: done, carriedOver: carry }
      setAgenda(updated)
      localStorage.setItem(storageKey, JSON.stringify(updated))
      setAgendaTitle(`Sprint Summary — ${sprint}`)
    } catch (e) {
      setAgenda(prev => ({ ...prev, retrospective: `⚠️ Gagal generate: ${String(e).slice(0, 160)}` }))
    }
    setLoading(false)
  }

  async function loadMeetings() {
    setMeetLoading(true)
    setPostDone([])
    try {
      const d = await fetch('/api/op/meetings').then(r => r.json())
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7)
      const open: OPMeeting[] = (d.meetings ?? [])
        .filter((m: OPMeeting) => m.state === 'open' && new Date(m.startTime) >= cutoff)
        .sort((a: OPMeeting, b: OPMeeting) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      setMeetings(open)
      // Auto-select matched ones
      const matched = new Set(open.filter((m: OPMeeting) => m.autoMatched).map((m: OPMeeting) => m.id))
      setSelectedMeets(matched)
    } catch { /* ignore */ }
    setMeetLoading(false)
  }

  function openPostPanel() {
    setShowPost(true)
    loadMeetings()
  }

  function toggleMeeting(id: number) {
    setSelectedMeets(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function postToMeetings() {
    if (selectedMeets.size === 0) return
    setPosting(true)
    const notes   = buildAgendaText()
    const title   = agendaTitle || `Sprint Summary — ${agenda.sprintName}`
    const ownedIds = getOwnedIds()
    const succeeded: number[] = []
    const actions: string[] = []

    for (const meetId of selectedMeets) {
      const existingItemId = ownedIds[meetId]
      try {
        if (existingItemId) {
          // Try PATCH first
          const r = await fetch('/api/op/meetings/agenda-item', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ meetingId: meetId, itemId: existingItemId, title, notes, durationMins: durMins }),
          }).then(r => r.json())

          if (r.ok) {
            succeeded.push(meetId)
            actions.push('updated')
            continue
          }
          // 404 = item deleted by someone else — fall through to POST
          if (!r.notFound) { showToast(`Meeting #${meetId}: ${r.error ?? 'failed'}`); continue }
        }

        // POST new item
        const r = await fetch('/api/op/meetings/agenda-item', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ meetingId: meetId, title, notes, durationMins: durMins }),
        }).then(r => r.json())

        if (r.ok && r.id) {
          saveOwnedId(meetId, r.id)
          succeeded.push(meetId)
          actions.push('created')
        } else {
          showToast(`Meeting #${meetId}: ${r.error ?? 'failed'}`)
        }
      } catch { showToast(`Meeting #${meetId}: network error`) }
    }

    setPostDone(prev => [...prev, ...succeeded])
    if (succeeded.length > 0) {
      const names = meetings.filter(m => succeeded.includes(m.id)).map(m => m.title).join(', ')
      const updCount = actions.filter(a => a === 'updated').length
      const newCount = actions.filter(a => a === 'created').length
      const detail = [updCount > 0 && `${updCount} updated`, newCount > 0 && `${newCount} new`].filter(Boolean).join(', ')
      showToast(`${names} — ${detail}`)
    }
    setPosting(false)
  }

  function buildAgendaText(): string {
    const lines: string[] = []

    if (agenda.retrospective) {
      // If AI-generated, it already contains full structured report — use as-is
      // If manually typed, wrap with a header
      const isStructured = /COMPLETED|CARRYING OVER|SELESAI|LANJUT KE|TEMUAN/i.test(agenda.retrospective)
      if (isStructured) {
        lines.push(agenda.retrospective)
      } else {
        lines.push('### Retrospective')
        lines.push(agenda.retrospective)
        lines.push('')
        if (agenda.keyWins.length) {
          lines.push('### Key Wins')
          agenda.keyWins.filter(w => w.trim()).forEach(w => lines.push(`- ${w}`))
          lines.push('')
        }
        if (agenda.doneCount > 0)
          lines.push(`**Done:** ${agenda.doneCount} tasks  |  **Carried over:** ${agenda.carriedOver} tasks`)
      }
    }

    if (agenda.notes) {
      lines.push('')
      lines.push('### Additional Notes')
      lines.push(agenda.notes)
    }
    return lines.join('\n').trim()
  }

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 4000) }

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  const matchedMeetings = meetings.filter(m => m.autoMatched)
  const otherMeetings   = meetings.filter(m => !m.autoMatched)

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    fetch('/api/sprint/summary').then(r => r.json()).then(d => setSavedSummaries(d.summaries ?? [])).catch(() => {})
  }, [])

  async function saveSummaryToMemory() {
    if (saving || !agenda.retrospective.trim() || !agenda.sprintName) return
    setSaving(true)
    try {
      const r = await fetch('/api/sprint/summary', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sprint: agenda.sprintName, summary: agenda.retrospective }),
      }).then(res => res.json())
      if (r.summaries) { setSavedSummaries(r.summaries); showToast('Saved to memory') }
      else showToast(`⚠️ ${r.error ?? 'Gagal simpan'}`)
    } catch { showToast('⚠️ Gagal simpan') }
    setSaving(false)
  }

  async function generateStakeholderSummary() {
    if (stkLoading) return
    setStkLoading(true)
    try {
      const r = await fetch('/api/sprint/stakeholder-summary', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sprintName: agenda.sprintName || undefined }),
      })
      const body = await r.text()
      let d: { ok?: boolean; summary?: string; error?: string }
      try { d = JSON.parse(body) } catch { d = { error: r.ok ? body.slice(0, 160) : `HTTP ${r.status}` } }
      if (d.ok && d.summary) {
        setStkSummary(d.summary)
        localStorage.setItem(stkKey, d.summary)
      } else {
        showToast(`⚠️ ${String(d.error ?? 'Gagal generate ringkasan').slice(0, 160)}`)
      }
    } catch (e) {
      showToast(`⚠️ Gagal generate: ${String(e).slice(0, 120)}`)
    }
    setStkLoading(false)
  }

  function copyStakeholderSummary() {
    if (!stkSummary) return
    navigator.clipboard.writeText(stkSummary).then(() => {
      setStkCopied(true)
      setTimeout(() => setStkCopied(false), 2000)
    })
  }

  async function deleteSavedSummary(sprint: string) {
    const r = await fetch('/api/sprint/summary', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sprint }),
    }).then(res => res.json()).catch(() => ({}))
    if (r.summaries) setSavedSummaries(r.summaries)
  }

  return (
    <div className="space-y-5 pb-10 max-w-2xl">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100 flex items-center gap-1.5"><ClipboardList size={14} /> Sprint Agenda</h3>
          <p className="text-xs text-gray-400 mt-0.5">Sprint summary — auto-posted to relevant OP meetings</p>
        </div>
        <div className="flex items-center gap-1.5">
          {agenda.retrospective?.trim() && !agenda.retrospective.startsWith('⚠️') && (
            <button onClick={saveSummaryToMemory} disabled={saving}
              title="Simpan summary sprint ini ke memory"
              className="text-[10px] font-semibold px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition disabled:opacity-50">
              {saving ? <Loader2 size={11} className="inline animate-spin" /> : <><Save size={11} className="inline" /> Save to memory</>}
            </button>
          )}
          <button onClick={generate} disabled={loading}
            className="text-[10px] font-semibold px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition disabled:opacity-50">
            {loading ? <><Loader2 size={11} className="inline animate-spin" /> Generating…</> : <><Sparkles size={11} className="inline" /> Generate from AI</>}
          </button>
        </div>
      </div>

      {/* Saved summaries (memory) */}
      {savedSummaries.length > 0 && (
        <div className="rounded-xl border border-gray-100 dark:border-gray-700/50 bg-white dark:bg-gray-800/40 overflow-hidden">
          <button onClick={() => setShowSaved(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2 text-[11px] font-bold text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition">
            <span className="flex items-center gap-1"><BookOpen size={11} /> Tersimpan di memory ({savedSummaries.length})</span>
            <ChevronRight size={11} className={`transition-transform ${showSaved ? 'rotate-90' : ''}`} />
          </button>
          {showSaved && (
            <div className="divide-y divide-gray-50 dark:divide-gray-800 max-h-72 overflow-y-auto">
              {savedSummaries.map(s => (
                <div key={s.sprint} className="px-4 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-300">{s.sprint}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-gray-400">{fmtDate(s.savedAt)}</span>
                      <button onClick={() => setAgenda(prev => ({ ...prev, sprintName: s.sprint, retrospective: s.summary }))}
                        className="text-[9px] font-semibold text-indigo-500 hover:underline">muat</button>
                      <button onClick={() => deleteSavedSummary(s.sprint)}
                        className="text-[9px] font-semibold text-gray-400 hover:text-red-500">hapus</button>
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 whitespace-pre-wrap line-clamp-3">{s.summary.slice(0, 240)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sprint name badge */}
      {agenda.sprintName && (
        <div className="flex items-center gap-3 px-4 py-3 bg-indigo-50 dark:bg-indigo-950/30 rounded-xl border border-indigo-100 dark:border-indigo-900">
          <span className="text-sm font-bold text-indigo-700 dark:text-indigo-300">{agenda.sprintName}</span>
          {agenda.doneCount > 0 && <span className="text-[11px] text-gray-500 flex items-center gap-1"><CheckCircle2 size={10} /> {agenda.doneCount} done · <RefreshCw size={10} /> {agenda.carriedOver} carry-over</span>}
        </div>
      )}

      {/* Sprint Report */}
      {(() => {
        const isStructured = /COMPLETED|CARRYING OVER|SELESAI|LANJUT KE|TEMUAN/i.test(agenda.retrospective)
        return (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">
                {isStructured ? 'Sprint Report' : 'Retrospective'}
              </label>
              {isStructured && (
                <span className="text-[9px] text-emerald-500 font-semibold flex items-center gap-1"><Sparkles size={9} /> AI Generated</span>
              )}
            </div>
            <textarea value={agenda.retrospective} onChange={e => save({ retrospective: e.target.value })}
              placeholder="Klik 'Generate from AI' atau tulis manual…"
              rows={isStructured ? 14 : 5}
              className="w-full text-[12px] border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-300 resize-none leading-relaxed font-mono" />
          </div>
        )
      })()}

      {/* Ringkasan Stakeholder — Bahasa Indonesia, non-teknis. Copy-only:
          TIDAK di-wire ke "Post to OP Meeting" (konten OP wajib English). */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wide flex items-center gap-1">
              <Users size={9} /> Ringkasan Stakeholder
            </label>
            <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-teal-50 dark:bg-teal-950/40 text-teal-600 dark:text-teal-300 border border-teal-100 dark:border-teal-900">
              Bahasa Indonesia · non-teknis
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {stkSummary && (
              <button onClick={copyStakeholderSummary}
                title="Copy markdown ke clipboard"
                className="text-[10px] font-semibold px-3 py-1.5 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition">
                {stkCopied ? <><Check size={11} className="inline text-emerald-500" /> Tersalin ✓</> : <><Copy size={11} className="inline" /> Copy</>}
              </button>
            )}
            <button onClick={generateStakeholderSummary} disabled={stkLoading}
              title="Generate ringkasan non-teknis untuk client/manajemen"
              className="text-[10px] font-semibold px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition disabled:opacity-50">
              {stkLoading ? <><Loader2 size={11} className="inline animate-spin" /> Generating…</> : <><Sparkles size={11} className="inline" /> Generate Ringkasan</>}
            </button>
          </div>
        </div>
        {stkSummary ? (
          <div className="rounded-xl border border-teal-100 dark:border-teal-900 bg-teal-50/40 dark:bg-teal-950/20 px-4 py-3">
            <div className="text-[12px] leading-relaxed text-gray-700 dark:text-gray-200 whitespace-pre-wrap">{stkSummary}</div>
            <p className="text-[9px] text-gray-400 mt-2">Copy-only — tidak dipost ke OP meeting (konten OP wajib English). Tersimpan otomatis secara lokal.</p>
          </div>
        ) : (
          <p className="text-[10px] text-gray-300 italic px-1">
            Ringkasan sprint untuk client/manajemen — tanpa jargon teknis, fokus temuan & dampak bisnis. Klik &quot;Generate Ringkasan&quot;.
          </p>
        )}
      </div>

      {/* Key Wins — only show when NOT structured (manual mode) */}
      {!agenda.retrospective.includes('COMPLETED') && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Key Wins</label>
            <button onClick={() => save({ keyWins: [...agenda.keyWins, ''] })} className="text-[9px] text-indigo-500 hover:text-indigo-700 font-semibold">+ Add</button>
          </div>
          <div className="space-y-1.5">
            {agenda.keyWins.map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <Check size={12} className="text-green-400 flex-shrink-0" />
                <input value={w} onChange={e => save({ keyWins: agenda.keyWins.map((x, j) => j === i ? e.target.value : x) })}
                  placeholder={`Win ${i + 1}`}
                  className="flex-1 text-[11px] border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-indigo-300" />
                <button onClick={() => save({ keyWins: agenda.keyWins.filter((_, j) => j !== i) })} className="text-[10px] text-gray-300 hover:text-red-400">✕</button>
              </div>
            ))}
            {agenda.keyWins.length === 0 && <p className="text-[10px] text-gray-300 italic">Tambah manual atau generate AI</p>}
          </div>
        </div>
      )}

      {/* Notes */}
      <div>
        <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Additional Notes</label>
        <textarea value={agenda.notes} onChange={e => save({ notes: e.target.value })}
          placeholder="Catatan tambahan, keputusan, action items…" rows={3}
          className="mt-1.5 w-full text-[12px] border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-300 resize-none" />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={openPostPanel}
          className="text-[11px] font-semibold px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition">
          <Upload size={12} className="inline mr-1" />Post to OP Meeting
        </button>
        <button onClick={() => navigator.clipboard.writeText(buildAgendaText()).then(() => showToast('Copied!'))}
          className="text-[11px] font-semibold px-4 py-2 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition">
          <ClipboardList size={12} className="inline mr-1" />Copy Markdown
        </button>
        <span className="text-[10px] text-gray-400">Auto-saved locally</span>
      </div>

      {/* Post panel */}
      {showPost && (
        <div className="border border-indigo-100 dark:border-indigo-900 bg-indigo-50/30 dark:bg-indigo-950/10 rounded-xl p-4 space-y-4">

          {/* Agenda item config */}
          <div className="flex gap-3 flex-wrap items-end">
            <div className="flex-1 min-w-0">
              <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Judul agenda item</label>
              <input value={agendaTitle} onChange={e => setAgendaTitle(e.target.value)}
                className="mt-1 w-full text-[11px] border border-indigo-200 dark:border-indigo-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Durasi</label>
              <div className="flex items-center gap-1 mt-1">
                <input type="number" value={durMins} onChange={e => setDurMins(Number(e.target.value))} min={1} max={60}
                  className="w-14 text-[11px] border border-indigo-200 dark:border-indigo-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-900 text-center focus:outline-none" />
                <span className="text-[10px] text-gray-400">mnt</span>
              </div>
            </div>
          </div>

          {/* Meeting list */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Pilih meeting</span>
                {selectedMeets.size > 0 && (
                  <span className="ml-2 text-[9px] font-bold text-indigo-500">{selectedMeets.size} dipilih</span>
                )}
              </div>
              <button onClick={loadMeetings} className="text-[9px] text-indigo-400 hover:text-indigo-600 flex items-center gap-1"><RefreshCw size={9} /> Refresh</button>
            </div>

            {meetLoading && <p className="text-[11px] text-gray-400 py-3 text-center">Loading meetings dari OP…</p>}

            {!meetLoading && meetings.length === 0 && (
              <p className="text-[10px] text-gray-400 italic py-2">Tidak ada open meeting di OP</p>
            )}

            {/* Matched meetings */}
            {!meetLoading && matchedMeetings.length > 0 && (
              <div className="mb-3">
                <p className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 mb-1.5 flex items-center gap-1">
                  <CheckCircle2 size={9} /> Auto-matched — your project
                </p>
                <div className="space-y-1.5">
                  {matchedMeetings.map(m => (
                    <MeetingRow key={m.id} m={m} checked={selectedMeets.has(m.id)} done={postDone.includes(m.id)}
                      onToggle={() => toggleMeeting(m.id)} opUrl={opUrl} fmtDate={fmtDate} highlight />
                  ))}
                </div>
              </div>
            )}

            {/* Other meetings */}
            {!meetLoading && otherMeetings.length > 0 && (
              <div>
                {matchedMeetings.length > 0 && (
                  <p className="text-[9px] font-bold text-gray-400 mb-1.5">Other meetings</p>
                )}
                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                  {otherMeetings.map(m => (
                    <MeetingRow key={m.id} m={m} checked={selectedMeets.has(m.id)} done={postDone.includes(m.id)}
                      onToggle={() => toggleMeeting(m.id)} opUrl={opUrl} fmtDate={fmtDate} highlight={false} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Content preview */}
          {selectedMeets.size > 0 && (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-3 max-h-28 overflow-y-auto">
              <p className="text-[9px] font-bold text-gray-400 mb-1">Preview konten yang akan dipost:</p>
              <pre className="text-[9px] text-gray-500 whitespace-pre-wrap font-mono">{buildAgendaText().slice(0, 400)}{buildAgendaText().length > 400 ? '…' : ''}</pre>
            </div>
          )}

          {/* Summary of what will happen */}
          {selectedMeets.size > 0 && (() => {
            const ids = getOwnedIds()
            const updateCount = [...selectedMeets].filter(id => ids[id]).length
            const newCount    = selectedMeets.size - updateCount
            return (
              <div className="text-[10px] text-gray-500 flex gap-3">
                {updateCount > 0 && <span className="flex items-center gap-1"><RefreshCw size={9} /> {updateCount} akan di-update</span>}
                {newCount    > 0 && <span className="flex items-center gap-1"><Sparkles size={9} /> {newCount} akan dibuat baru</span>}
              </div>
            )
          })()}

          <div className="flex gap-2 items-center">
            <button onClick={postToMeetings} disabled={selectedMeets.size === 0 || posting}
              className="px-4 py-1.5 text-[11px] font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition disabled:opacity-40">
              {posting
                ? <><Loader2 size={11} className="inline animate-spin" /> Posting…</>
                : selectedMeets.size > 0
                  ? <><Upload size={11} className="inline" /> Confirm {selectedMeets.size} meeting</>
                  : <><Upload size={11} className="inline" /> Pilih meeting dulu</>}
            </button>
            <button onClick={() => setShowPost(false)} className="text-[10px] text-gray-400 hover:text-gray-600 px-2">Cancel</button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-sm px-4 py-2 rounded-lg shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  )
}

function MeetingRow({ m, checked, done, onToggle, opUrl, fmtDate, highlight }: {
  m: OPMeeting; checked: boolean; done: boolean; onToggle: () => void
  opUrl: string; fmtDate: (s: string) => string; highlight: boolean
}) {
  return (
    <button onClick={onToggle}
      className={`w-full text-left px-3 py-2.5 rounded-xl border text-[11px] transition ${
        done
          ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 opacity-70'
          : checked
            ? highlight
              ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30'
              : 'border-indigo-400 bg-indigo-50 dark:bg-indigo-950/50'
            : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-indigo-200'
      }`}>
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-bold w-4 flex-shrink-0 ${checked ? (highlight ? 'text-emerald-500' : 'text-indigo-500') : 'text-gray-300'}`}>
          {done ? <CheckCircle2 size={12} /> : checked ? <CheckSquare size={12} /> : <Square size={12} />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">{m.title}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{m.project} · {fmtDate(m.startTime)}</div>
        </div>
        <a href={`${opUrl}/meetings/${m.id}`} target="_blank" rel="noopener"
          onClick={e => e.stopPropagation()}
          className="text-[9px] text-indigo-400 hover:underline flex-shrink-0"><ExternalLink size={9} /></a>
      </div>
    </button>
  )
}
