'use client'

import { useState, useEffect, useCallback } from 'react'
import { Bug, RefreshCw, Info, ExternalLink, Copy } from 'lucide-react'

// Tika — Helpdesk & QA Validation Pipeline, Phase 0 (SHADOW MODE).
// PRD: docs/PRD-helpdesk-qa-pipeline.md. Read-only view over what Tika found —
// classification, clarity gaps, duplicate suspects. Writes NOTHING to OP.
// This is a Phase 0 minimal view (not the full 5-tab Queue/Dedup/Runs/Comms/
// Settings spec in PRD §6.5) — enough to watch results and tune thresholds
// per the Phase 0 exit criteria; the full view comes if/when Phase 1 starts.

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
  status: string
}
interface HelpdeskTicket {
  id: string
  opWpId: number
  subject: string
  opType: string | null
  opStatus: string | null
  authorName: string | null
  pipelineState: string
  updatedAt: string
  classify: TicketAnalysis | null
  clarity: TicketAnalysis | null
  links: TicketLink[]
}

const STATE_BADGE: Record<string, string> = {
  new:          'bg-gray-100 dark:bg-gray-700 text-gray-500',
  triaged:      'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300',
  dup_suspect:  'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-300',
  needs_info:   'bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-300',
  ready_for_qa: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-300',
}

function kindBadgeCls(kind?: string): string {
  switch (kind) {
    case 'bug': return 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-300 border border-red-200 dark:border-red-800'
    case 'request': return 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
    case 'question': return 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
    default: return 'bg-gray-100 dark:bg-gray-700 text-gray-500 border border-gray-200 dark:border-gray-600'
  }
}

export default function HelpdeskPanel() {
  const [tickets, setTickets] = useState<HelpdeskTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [polling, setPolling] = useState(false)
  const [opUrl, setOpUrl] = useState('https://tokek.integrity-asia.com')
  const [toast, setToast] = useState<string | null>(null)
  const [lastPoll, setLastPoll] = useState<string | null>(null)

  function flash(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  const load = useCallback(() => {
    fetch('/api/helpdesk/tickets')
      .then(r => r.json())
      .then(d => setTickets(d.tickets ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/op/cache').then(r => r.json()).then(d => { if (d._opUrl) setOpUrl(d._opUrl) }).catch(() => {})
    load()
    setLoading(false)
  }, [load])

  async function pollNow() {
    setPolling(true)
    try {
      const r = await fetch('/api/helpdesk/tika/poll', { method: 'POST' })
      const d = await r.json()
      if (d.ok) {
        flash(`Scan selesai: ${d.scanned} tiket, ${d.analyzed} dianalisa, ${d.dupSuspects} dup suspect${d.errors?.length ? ` (${d.errors.length} error)` : ''}`)
        setLastPoll(new Date().toISOString())
        load()
      } else {
        flash(`Gagal: ${d.error ?? 'unknown error'}`)
      }
    } catch {
      flash('Gagal menghubungi Tika')
    } finally {
      setPolling(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Memuat Helpdesk…</div>
  )

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Bug size={16} /> Helpdesk — Tika (Shadow Mode)
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">Phase 0: baca &amp; analisa tiket Inquiries (query OP #112). Tidak menulis apa pun ke OP.</p>
        </div>
        <button
          onClick={pollNow}
          disabled={polling}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition">
          <RefreshCw size={12} className={polling ? 'animate-spin' : ''} /> {polling ? 'Scanning…' : 'Poll now'}
        </button>
      </div>

      {/* Info notice */}
      <div className="text-[11px] text-gray-400 bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700 rounded-lg px-3 py-2 flex items-start gap-1.5">
        <Info size={11} className="flex-shrink-0 mt-0.5" />
        <span>
          Shadow mode — Tika cuma baca, klasifikasi, cek kelengkapan, dan cari kemungkinan duplikat. Tidak ada komentar/perubahan status yang dikirim ke OP.
          {lastPoll && ` Terakhir poll manual: ${new Date(lastPoll).toLocaleTimeString('id-ID')}.`}
        </span>
      </div>

      {/* Empty state */}
      {tickets.length === 0 ? (
        <div className="text-center text-gray-400 text-sm py-12">
          <div className="flex justify-center mb-3"><Bug size={40} className="text-gray-300 dark:text-gray-600" /></div>
          <p>Belum ada tiket yang dianalisa.</p>
          <p className="text-xs mt-1 text-gray-300 dark:text-gray-600">Klik <strong>Poll now</strong>, atau tunggu cron Launcher jalan.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map(t => (
            <div key={t.id} className="rounded-xl border p-4 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    {t.classify?.kind && (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${kindBadgeCls(t.classify.kind)}`}>
                        {t.classify.kind}
                      </span>
                    )}
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATE_BADGE[t.pipelineState] ?? STATE_BADGE.new}`}>
                      {t.pipelineState}
                    </span>
                    {t.opType && (
                      <span className="text-[10px] font-semibold bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300 px-2 py-0.5 rounded-full">{t.opType}</span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <a href={`${opUrl}/work_packages/${t.opWpId}`} target="_blank" rel="noopener"
                      className="flex-shrink-0 text-sm font-bold text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 font-mono">
                      #{t.opWpId}
                    </a>
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 leading-snug">{t.subject}</p>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1">dari: <strong className="text-gray-600 dark:text-gray-300">{t.authorName ?? '—'}</strong></p>

                  {t.classify?.reasoning && (
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5 italic">"{t.classify.reasoning}"</p>
                  )}

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
                </div>
                <a href={`${opUrl}/work_packages/${t.opWpId}`} target="_blank" rel="noopener"
                  className="flex-shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition">
                  <ExternalLink size={14} />
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-sm px-4 py-2 rounded-lg shadow-lg z-50 max-w-sm text-center">
          {toast}
        </div>
      )}
    </div>
  )
}
