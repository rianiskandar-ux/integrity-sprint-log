'use client'

import { useState, useEffect, useCallback } from 'react'
import { ClipboardCheck, Info, ExternalLink, Copy, CheckCircle2, RefreshCw, Lock, MessageCircle, Send, Sparkles } from 'lucide-react'

// The shared Helpdesk QA queue (PRD §16.2 build A). Opened to the whole team
// 2026-07-21 (Rian: "tampilannya sama semua di semua orang") — everyone sees
// the same tickets + Tika's findings, full transparency instead of one
// designated verifier working in a silo. The DECISION stays concentrated
// though: only Aufa (role='qa') or the owner can actually click PASS — for
// everyone else it's visible but disabled, so the process is legible without
// diffusing who's accountable for it. Whoever can act may use Vera's findings
// (once build B ships) OR test themselves locally — ISL has no visibility
// into that process and needs none. REJECT happens directly in OP (status
// change) — no button for it, per the PRD's deliberate design (Inquiries
// scope = open tickets only, so a rejected ticket just drops out of intake
// on the next Tika poll).

interface TicketAnalysis {
  kind?: string
  reasoning?: string
  hasReproSteps?: boolean
  hasExpectedActual?: boolean
  missing?: string[]
}
interface TicketLink {
  relatedOpWpId: number
  similarity: number | null
}
interface QaTicket {
  id: string
  opWpId: number
  subject: string
  opType: string | null
  authorName: string | null
  assigneeName: string | null
  assigneeOpUserId: number | null
  updatedAt: string
  classify: TicketAnalysis | null
  clarity: TicketAnalysis | null
  draft: string | null
  links: TicketLink[]
}

export default function AufaQueueView() {
  const [tickets, setTickets] = useState<QaTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [passing, setPassing] = useState<string | null>(null)
  const [polling, setPolling] = useState(false)
  const [opUrl, setOpUrl] = useState('https://tokek.integrity-asia.com')
  const [toast, setToast] = useState<string | null>(null)
  // canAct = isOwner || role='qa' (backend already enforces this on POST
  // /qa/pass — this is purely so the button renders disabled for everyone
  // else instead of failing silently after a click).
  const [canAct, setCanAct] = useState(false)
  const [isOwner, setIsOwner] = useState(false)
  // "Tanya ke pelapor" (2026-07-21, Rian: bisa nanya dari ISL tanpa buka OP?)
  // Posts a REAL OP comment via the existing /api/op/comment route — under
  // the CALLER's own OP identity (their session token), not a Tika/system
  // write. Open to everyone (like the view itself), unlike PASS: asking a
  // question doesn't change routing/ownership, it's just attributed to
  // whoever sends it, same as if they'd typed it in OP directly.
  const [askingId, setAskingId] = useState<string | null>(null)
  const [askText, setAskText] = useState<Record<string, string>>({})
  const [sendingAsk, setSendingAsk] = useState<string | null>(null)

  function flash(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 4500)
  }

  const load = useCallback(() => {
    fetch('/api/helpdesk/qa/tickets')
      .then(r => r.json())
      .then(d => setTickets(d.tickets ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetch('/api/op/cache').then(r => r.json()).then(d => { if (d._opUrl) setOpUrl(d._opUrl) }).catch(() => {})
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      setIsOwner(!!d.isOwner)
      setCanAct(!!d.isOwner || !!d.isQa)
    }).catch(() => {})
    load()
  }, [load])

  async function pollNow() {
    setPolling(true)
    try {
      const r = await fetch('/api/helpdesk/tika/poll', { method: 'POST' })
      const d = await r.json()
      flash(d.ok ? `Scan selesai: ${d.scanned} tiket, ${d.analyzed} dianalisa` : `Gagal: ${d.error ?? 'unknown error'}`)
      load()
    } catch {
      flash('Gagal menghubungi Tika')
    } finally {
      setPolling(false)
    }
  }

  async function pass(t: QaTicket) {
    if (!canAct) return
    if (!confirm(`PASS tiket #${t.opWpId}?\n\n${t.assigneeName ? `Akan masuk ke Push Queue milik ${t.assigneeName}.` : 'Belum ada assignee di OP — akan menunggu di Helpdesk sampai di-assign.'}`)) return
    setPassing(t.id)
    try {
      const r = await fetch('/api/helpdesk/qa/pass', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId: t.id }),
      })
      const d = await r.json()
      if (d.ok) {
        flash(d.message ?? 'Tersimpan')
        setTickets(prev => prev.filter(x => x.id !== t.id))
      } else {
        flash(`Gagal: ${d.error ?? 'unknown error'}`)
      }
    } catch {
      flash('Gagal menghubungi server')
    } finally {
      setPassing(null)
    }
  }

  async function sendAsk(t: QaTicket) {
    const comment = (askText[t.id] ?? '').trim()
    if (!comment) return
    setSendingAsk(t.id)
    try {
      const r = await fetch('/api/op/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wpId: t.opWpId, comment }),
      })
      const d = await r.json()
      if (r.ok && d.ok !== false) {
        flash(`Terkirim ke OP #${t.opWpId}`)
        setAskText(prev => ({ ...prev, [t.id]: '' }))
        setAskingId(null)
      } else {
        flash(`Gagal kirim: ${d.error ?? 'unknown error'}`)
      }
    } catch {
      flash('Gagal menghubungi OP')
    } finally {
      setSendingAsk(null)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Memuat antrian QA…</div>
  )

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <ClipboardCheck size={16} /> Helpdesk — Antrian QA
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">Tiket bug yang perlu diverifikasi sebelum masuk ke developer.</p>
        </div>
        {isOwner && (
          <button
            onClick={pollNow}
            disabled={polling}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition">
            <RefreshCw size={12} className={polling ? 'animate-spin' : ''} /> {polling ? 'Scanning…' : 'Poll now'}
          </button>
        )}
      </div>

      <div className="text-[11px] text-gray-400 bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700 rounded-lg px-3 py-2 flex items-start gap-1.5">
        <Info size={11} className="flex-shrink-0 mt-0.5" />
        <span>
          Terbuka buat semua orang lihat — bebas bantu cek, atau <strong>tanya ke pelapor</strong> langsung dari sini (terkirim ke OP atas nama akunmu). <strong>PASS</strong> cuma bisa ditekan Aufa/owner biar keputusannya tetap jelas siapa yang tanggung jawab.
          Kalau tidak valid, tolak langsung di OP — tiketnya otomatis hilang dari sini.
        </span>
      </div>

      {tickets.length === 0 ? (
        <div className="text-center text-gray-400 text-sm py-12">
          <div className="flex justify-center mb-3"><ClipboardCheck size={40} className="text-gray-300 dark:text-gray-600" /></div>
          <p>Tidak ada tiket menunggu keputusan.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map(t => (
            <div key={t.id} className="rounded-xl border p-4 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-300 border border-red-200 dark:border-red-800">bug</span>
                    {t.opType && <span className="text-[10px] font-semibold bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300 px-2 py-0.5 rounded-full">{t.opType}</span>}
                    {!t.assigneeOpUserId && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-300 border border-amber-200 dark:border-amber-800">[UNASSIGNED]</span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <a href={`${opUrl}/work_packages/${t.opWpId}`} target="_blank" rel="noopener"
                      className="flex-shrink-0 text-sm font-bold text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 font-mono">#{t.opWpId}</a>
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 leading-snug">{t.subject}</p>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1">
                    dari: <strong className="text-gray-600 dark:text-gray-300">{t.authorName ?? '—'}</strong>
                    {' · '}assignee: <strong className="text-gray-600 dark:text-gray-300">{t.assigneeName ?? '(belum ada)'}</strong>
                  </p>

                  {t.classify?.reasoning && <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5 italic">"{t.classify.reasoning}"</p>}

                  {t.clarity && (t.clarity.missing?.length ?? 0) > 0 && (
                    <div className="mt-2 text-[11px] text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/30 rounded-lg px-2.5 py-1.5">
                      Kurang lengkap: {t.clarity.missing!.join(', ')}
                    </div>
                  )}

                  {t.links.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {t.links.map(l => (
                        <a key={l.relatedOpWpId} href={`${opUrl}/work_packages/${l.relatedOpWpId}`} target="_blank" rel="noopener"
                          className="flex items-center gap-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-2 py-0.5 rounded-full hover:bg-amber-100 transition">
                          <Copy size={9} /> mirip #{l.relatedOpWpId}{l.similarity != null ? ` (${(1 - l.similarity).toFixed(2)})` : ''}
                        </a>
                      ))}
                    </div>
                  )}

                  {/* Vera's findings panel lands here once build B ships (PRD §16.2) */}

                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => setAskingId(prev => prev === t.id ? null : t.id)}
                      className="flex items-center gap-1 text-[10px] font-semibold text-gray-400 hover:text-indigo-500 dark:hover:text-indigo-400 transition">
                      <MessageCircle size={10} /> {askingId === t.id ? 'Batal tanya' : 'Tanya ke pelapor'}
                    </button>
                    {t.draft && (
                      <button
                        onClick={() => { setAskingId(t.id); setAskText(prev => ({ ...prev, [t.id]: t.draft ?? '' })) }}
                        title="Isi kotak dengan draft pertanyaan dari Tika — bisa diedit sebelum kirim"
                        className="flex items-center gap-1 text-[10px] font-semibold text-violet-500 hover:text-violet-600 dark:text-violet-400 transition">
                        <Sparkles size={10} /> Pakai draft Tika
                      </button>
                    )}
                  </div>
                  {askingId === t.id && (
                    <div className="mt-1.5 flex gap-1.5">
                      <textarea
                        value={askText[t.id] ?? ''}
                        onChange={e => setAskText(prev => ({ ...prev, [t.id]: e.target.value }))}
                        placeholder="Tulis pertanyaan — terkirim sebagai komentar OP atas nama akun kamu sendiri"
                        rows={2}
                        className="flex-1 text-[11px] rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-2.5 py-1.5 text-gray-700 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
                      />
                      <button
                        onClick={() => sendAsk(t)}
                        disabled={sendingAsk === t.id || !(askText[t.id] ?? '').trim()}
                        className="flex-shrink-0 self-end flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition">
                        <Send size={10} /> {sendingAsk === t.id ? '…' : 'Kirim'}
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex-shrink-0 flex flex-col items-end gap-2">
                  <a href={`${opUrl}/work_packages/${t.opWpId}`} target="_blank" rel="noopener" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition"><ExternalLink size={14} /></a>
                  <button
                    onClick={() => pass(t)}
                    disabled={!canAct || passing === t.id}
                    title={canAct ? undefined : 'Hanya Aufa atau owner yang bisa PASS'}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition ${
                      canAct
                        ? 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                    }`}>
                    {canAct ? <CheckCircle2 size={12} /> : <Lock size={11} />} {passing === t.id ? 'Menyimpan…' : 'PASS'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-sm px-4 py-2 rounded-lg shadow-lg z-50 max-w-sm text-center">{toast}</div>
      )}
    </div>
  )
}
