'use client'

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'

const BRAND = '#1d3a5c'

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
  if (h == null) return '—'
  if (h < 1) return `${Math.round(h * 60)}m`
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60)
  return mm > 0 ? `${hh}h ${mm}m` : `${hh}h`
}

export default function OpTaskModal({ wpId, opUrl, onClose, onSaved, onChat }: {
  wpId: number
  opUrl: string
  onClose: () => void
  onSaved?: () => void
  onChat?: () => void
}) {
  const [d, setD]           = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [msg, setMsg]         = useState<string | null>(null)

  // editable fields
  const [statusId, setStatusId]   = useState<number | null>(null)
  const [estH, setEstH]           = useState<string>('')
  const [pct, setPct]             = useState<string>('')
  const [addSpent, setAddSpent]   = useState<string>('')
  const [comment, setComment]     = useState<string>('')

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/op/wp-detail?wpId=${wpId}`)
      .then(r => r.json())
      .then((data: Detail & { error?: string }) => {
        if (data.error) { setMsg(`⚠️ ${data.error}`); return }
        setD(data)
        setStatusId(data.statusId)
        setEstH(data.estimatedHours != null ? String(data.estimatedHours) : '')
        setPct(String(data.percentDone ?? 0))
      })
      .catch(e => setMsg(`⚠️ ${String(e)}`))
      .finally(() => setLoading(false))
  }, [wpId])

  useEffect(() => { load() }, [load])

  async function save() {
    if (!d || saving) return
    setSaving(true); setMsg(null)
    try {
      // 1) status / % / estimate via wp-update
      const estMins = estH.trim() ? Math.round(parseFloat(estH) * 60) : undefined
      const pctNum  = pct.trim() ? Math.max(0, Math.min(100, parseInt(pct))) : undefined
      const upd = await fetch('/api/op/wp-update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wpId,
          statusId: statusId !== d.statusId ? statusId : undefined,
          percentDone: pctNum !== d.percentDone ? pctNum : undefined,
          estimatedMins: estMins,
        }),
      }).then(r => r.json())
      if (upd.error) throw new Error(upd.error)

      // 2) add spent time via timelog (real time entry)
      if (addSpent.trim()) {
        await fetch('/api/op/timelog', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wpId, duration: addSpent.trim(), date: new Date().toISOString().slice(0, 10), title: 'Update via ISL' }),
        }).catch(() => {})
      }
      // 3) add comment
      if (comment.trim()) {
        await fetch('/api/op/comment', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wpId, comment: comment.trim() }),
        }).catch(() => {})
      }

      setMsg('✅ Tersimpan ke OP')
      setAddSpent(''); setComment('')
      load()
      onSaved?.()
    } catch (e) {
      setMsg(`⚠️ Gagal: ${String(e).slice(0, 140)}`)
    } finally {
      setSaving(false)
    }
  }

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide w-24 flex-shrink-0">{label}</span>
      <div className="flex-1 min-w-0 text-[12px] text-gray-700 dark:text-gray-200">{children}</div>
    </div>
  )

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-start sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white dark:bg-gray-900 w-full sm:max-w-2xl sm:rounded-2xl shadow-2xl flex flex-col my-4" style={{ maxHeight: '92vh' }}>

        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-3 border-b border-gray-100 dark:border-gray-800" style={{ background: BRAND, borderRadius: '16px 16px 0 0' }}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-blue-200 uppercase tracking-widest">{d?.type ?? 'Task'}</span>
              <span className="text-[10px] text-blue-300">#{wpId}</span>
              {d?.version && <span className="text-[10px] text-blue-300">· {d.version}</span>}
            </div>
            <p className="text-sm font-bold text-white leading-tight mt-0.5">{d?.subject ?? `#${wpId}`}</p>
            {d?.parent && <p className="text-[10px] text-blue-300/80 mt-0.5">↳ parent: #{d.parent.id} {d.parent.subject}</p>}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <a href={`${opUrl}/work_packages/${wpId}`} target="_blank" rel="noopener"
              className="text-[10px] font-bold px-2 py-1 rounded-lg text-white border border-white/30 hover:bg-white/20" title="Buka di OpenProject">↗ OP</a>
            {onChat && (
              <button onClick={onChat} className="text-[10px] font-bold px-2 py-1 rounded-lg text-white border border-white/30 hover:bg-white/20">💬 Chat</button>
            )}
            <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-white/70 hover:text-white hover:bg-white/20">✕</button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" /></div>
        ) : !d ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">{msg ?? 'Gagal memuat'}</div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

            {/* People / meta (read) */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              <Row label="Assignee">{d.assignee ?? '—'}</Row>
              <Row label="Project">{d.project || '—'}</Row>
              <Row label="Spent">{fmtH(d.spentHours)}</Row>
              <Row label="Remaining">{fmtH(d.remainingHours)}</Row>
            </div>

            <div className="h-px bg-gray-100 dark:bg-gray-800" />

            {/* Editable */}
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Edit langsung ke OP</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <Row label="Status">
                <select value={statusId ?? ''} onChange={e => setStatusId(Number(e.target.value))}
                  className="w-full text-[12px] border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 bg-white dark:bg-gray-800">
                  {STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </Row>
              <Row label="Work (jam)">
                <input type="number" step="0.25" value={estH} onChange={e => setEstH(e.target.value)} placeholder="mis. 2"
                  className="w-full text-[12px] border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 bg-white dark:bg-gray-800" />
              </Row>
              <Row label="% Complete">
                <input type="number" min="0" max="100" value={pct} onChange={e => setPct(e.target.value)}
                  className="w-full text-[12px] border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 bg-white dark:bg-gray-800" />
              </Row>
              <Row label="+ Spent">
                <input value={addSpent} onChange={e => setAddSpent(e.target.value)} placeholder="mis. 30m / 1h"
                  className="w-full text-[12px] border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 bg-white dark:bg-gray-800" />
              </Row>
            </div>
            <div>
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">+ Komentar / progress note</span>
              <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2} placeholder="catatan progress (opsional)…"
                className="mt-1 w-full text-[12px] border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 resize-none" />
            </div>

            {d.description && (
              <details className="text-[11px]">
                <summary className="cursor-pointer text-gray-400 font-semibold">Deskripsi OP</summary>
                <p className="mt-1 whitespace-pre-wrap text-gray-600 dark:text-gray-300">{d.description.slice(0, 1500)}</p>
              </details>
            )}

            {d.comments.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Activity ({d.comments.length})</p>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {d.comments.slice(-6).map((c, i) => (
                    <div key={i} className="text-[11px] border-l-2 border-gray-100 dark:border-gray-700 pl-2">
                      <span className="font-semibold text-gray-600 dark:text-gray-300">{c.user}</span>
                      <span className="text-gray-400 text-[9px] ml-1">{c.at.slice(0, 10)}</span>
                      <p className="text-gray-500 dark:text-gray-400 whitespace-pre-wrap">{c.text}</p>
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
            {msg && <span className={`text-[11px] font-semibold ${msg.startsWith('✅') ? 'text-emerald-600' : 'text-amber-600'}`}>{msg}</span>}
            <button onClick={save} disabled={saving}
              className="ml-auto px-4 py-1.5 text-[11px] font-bold text-white rounded-lg disabled:opacity-50 transition" style={{ background: BRAND }}>
              {saving ? 'Menyimpan…' : '💾 Simpan ke OP'}
            </button>
            <button onClick={onClose} className="text-[11px] text-gray-400 hover:text-gray-600 px-2">Tutup</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
