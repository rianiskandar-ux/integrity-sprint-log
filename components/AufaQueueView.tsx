'use client'

import { useState, useEffect, useCallback } from 'react'
import { ClipboardCheck, Info, ExternalLink, Copy, CheckCircle2 } from 'lucide-react'

// Aufa's QA decision queue (PRD §16.2 build A). She may use Vera's findings
// (once build B ships) OR test herself locally with her own tools — ISL has
// no visibility into her process and needs none. Her only action here is
// PASS; REJECT happens directly in OP (status change) — no button for it,
// per the PRD's deliberate design (Inquiries scope = open tickets only, so
// a rejected ticket just drops out of intake on the next Tika poll).

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
  links: TicketLink[]
}

export default function AufaQueueView() {
  const [tickets, setTickets] = useState<QaTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [passing, setPassing] = useState<string | null>(null)
  const [opUrl, setOpUrl] = useState('https://tokek.integrity-asia.com')
  const [toast, setToast] = useState<string | null>(null)

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
    load()
  }, [load])

  async function pass(t: QaTicket) {
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

  if (loading) return (
    <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Memuat antrian QA…</div>
  )

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <div>
        <h2 className="text-base font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <ClipboardCheck size={16} /> Helpdesk — Antrian QA
        </h2>
        <p className="text-xs text-gray-400 mt-0.5">Tiket bug yang perlu diverifikasi sebelum masuk ke developer.</p>
      </div>

      <div className="text-[11px] text-gray-400 bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700 rounded-lg px-3 py-2 flex items-start gap-1.5">
        <Info size={11} className="flex-shrink-0 mt-0.5" />
        <span>Bebas pakai cara apa pun buat verifikasi (temuan otomatis di bawah, atau cek sendiri). <strong>PASS</strong> kalau valid. Kalau tidak valid, tolak langsung di OP — tiketnya otomatis hilang dari sini.</span>
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
                </div>
                <div className="flex-shrink-0 flex flex-col items-end gap-2">
                  <a href={`${opUrl}/work_packages/${t.opWpId}`} target="_blank" rel="noopener" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition"><ExternalLink size={14} /></a>
                  <button
                    onClick={() => pass(t)}
                    disabled={passing === t.id}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition">
                    <CheckCircle2 size={12} /> {passing === t.id ? 'Menyimpan…' : 'PASS'}
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
