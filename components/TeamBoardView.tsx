'use client'

import { useState, useEffect, useCallback } from 'react'
import { Users, RefreshCw, Flame, Clock, AlertTriangle, Inbox } from 'lucide-react'

interface TopItem {
  id: number
  subject: string
  status: string
  islStatus: string
  dueDate: string | null
  sprintName: string | null
  updatedAt: string | null
}

type PresenceStatus = 'online' | 'idle' | 'offline' | 'no-data'

interface Card {
  uid: number
  name: string
  avatar: string | null
  openCount: number
  wipCount: number
  incomingCount: number
  dueSoonCount: number
  staleCount: number
  lastSync: string | null
  presenceStatus: PresenceStatus
  lastActivity: string | null
  topItems: TopItem[]
}

const PRESENCE_CFG: Record<PresenceStatus, { label: string; dot: string; text: string }> = {
  online:   { label: 'Online',    dot: 'bg-emerald-500', text: 'text-emerald-600' },
  idle:     { label: 'Idle',      dot: 'bg-amber-400',   text: 'text-amber-600' },
  offline:  { label: 'Offline',   dot: 'bg-gray-300',    text: 'text-gray-400' },
  'no-data':{ label: 'No data',   dot: 'bg-gray-200',    text: 'text-gray-300' },
}

const ISL_STATUS_DOT: Record<string, string> = {
  new: 'bg-gray-400', in_progress: 'bg-blue-500', on_hold: 'bg-amber-500',
  done: 'bg-emerald-500', rejected: 'bg-red-400',
}

function timeAgo(iso: string | null, noneLabel = 'belum ada data'): { label: string; tone: 'fresh' | 'ok' | 'stale' | 'none' } {
  if (!iso) return { label: noneLabel, tone: 'none' }
  const ms = Date.now() - new Date(iso).getTime()
  const h = ms / 3_600_000
  const label =
    h < 1  ? `${Math.max(1, Math.round(ms / 60_000))}m lalu` :
    h < 24 ? `${Math.round(h)}j lalu` :
    `${Math.round(h / 24)}h lalu`
  const tone = h < 2 ? 'fresh' : h < 48 ? 'ok' : 'stale'
  return { label, tone }
}

const TONE_CLS: Record<string, string> = {
  fresh: 'text-emerald-600 bg-emerald-50', ok: 'text-blue-600 bg-blue-50',
  stale: 'text-amber-600 bg-amber-50', none: 'text-gray-400 bg-gray-50',
}

export default function TeamBoardView() {
  const [board, setBoard]       = useState<Card[] | null>(null)
  const [syncing, setSyncing]   = useState(false)
  const [syncMsg, setSyncMsg]   = useState<string | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await fetch('/api/team/board')
    if (!r.ok) return
    const d = await r.json()
    setBoard(d.board)
    setGeneratedAt(d.generatedAt)
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 30_000) // presence moves faster than workload — keep it feeling live
    return () => clearInterval(t)
  }, [load])

  async function syncNow() {
    setSyncing(true)
    setSyncMsg(null)
    try {
      const r = await fetch('/api/team/board/sync', { method: 'POST' })
      const d = await r.json()
      const failed = (d.synced ?? []).filter((s: { ok: boolean }) => !s.ok)
      setSyncMsg(failed.length
        ? `Sync selesai — ${failed.length} gagal (${failed.map((f: { name: string }) => f.name).join(', ')})`
        : 'Sync selesai — semua orang ter-update')
      await load()
    } catch {
      setSyncMsg('Sync gagal — cek koneksi ke OP')
    } finally {
      setSyncing(false)
    }
  }

  if (!board) {
    return <div className="p-6 text-sm text-gray-400">Memuat papan tim…</div>
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-bold text-gray-800 flex items-center gap-2">
          <Users size={18} className="text-teal-500" /> Team Board
        </h1>
        <button
          onClick={syncNow}
          disabled={syncing}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 transition"
        >
          <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Sync…' : 'Sync now'}
        </button>
      </div>
      <p className="text-[11px] text-gray-400 mb-4">
        Beban kerja tiap orang, ditarik dari OpenProject — bukan status online.
        {generatedAt && ` Dihitung ${new Date(generatedAt).toLocaleTimeString('id-ID')}.`}
        {syncMsg && <span className="ml-2 text-teal-600 font-medium">{syncMsg}</span>}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {board.map(card => {
          const cacheAge = timeAgo(card.lastSync, 'belum pernah sync')
          const activity = timeAgo(card.lastActivity, 'belum ada sinyal')
          const presence = PRESENCE_CFG[card.presenceStatus]
          return (
            <div key={card.uid} className="border border-gray-200 rounded-xl p-4 bg-white shadow-sm">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-xs font-bold">
                    {card.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-gray-800 leading-tight">{card.name}</div>
                    <div className={`flex items-center gap-1 text-[10px] font-medium ${presence.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${presence.dot}`} />
                      {presence.label}
                      <span className="text-gray-300 font-normal">· aktivitas {activity.label}</span>
                    </div>
                  </div>
                </div>
                <span className={`text-[9px] font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${TONE_CLS[cacheAge.tone]}`} title="Umur cache OP — kapan terakhir ditarik dari OpenProject">
                  cache {cacheAge.label}
                </span>
              </div>

              <div className="grid grid-cols-4 gap-2 mb-3 mt-2 text-center">
                <div className="bg-blue-50 rounded-lg py-1.5">
                  <div className="text-sm font-bold text-blue-600">{card.wipCount}</div>
                  <div className="text-[9px] text-blue-400 uppercase font-semibold">WIP</div>
                </div>
                <div className="bg-gray-50 rounded-lg py-1.5">
                  <div className="text-sm font-bold text-gray-600">{card.openCount}</div>
                  <div className="text-[9px] text-gray-400 uppercase font-semibold">Open</div>
                </div>
                <div className={`rounded-lg py-1.5 ${card.dueSoonCount ? 'bg-amber-50' : 'bg-gray-50'}`}>
                  <div className={`text-sm font-bold ${card.dueSoonCount ? 'text-amber-600' : 'text-gray-400'}`}>{card.dueSoonCount}</div>
                  <div className={`text-[9px] uppercase font-semibold ${card.dueSoonCount ? 'text-amber-500' : 'text-gray-400'}`}>Due ≤2h</div>
                </div>
                <div className={`rounded-lg py-1.5 ${card.staleCount ? 'bg-red-50' : 'bg-gray-50'}`}>
                  <div className={`text-sm font-bold ${card.staleCount ? 'text-red-600' : 'text-gray-400'}`}>{card.staleCount}</div>
                  <div className={`text-[9px] uppercase font-semibold ${card.staleCount ? 'text-red-500' : 'text-gray-400'}`}>Macet</div>
                </div>
              </div>

              {card.incomingCount > 0 && (
                <div className="flex items-center gap-1.5 text-[11px] text-sky-600 mb-2">
                  <Inbox size={11} /> {card.incomingCount} tugas baru masuk belum direspon
                </div>
              )}

              {card.topItems.length === 0 ? (
                <div className="text-[11px] text-gray-300 italic py-2 text-center">tidak ada task terbuka</div>
              ) : (
                <div className="space-y-1">
                  {card.topItems.map(t => (
                    <div key={t.id} className="flex items-center gap-2 text-[11px] py-1 border-t border-gray-50 first:border-0">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${ISL_STATUS_DOT[t.islStatus] ?? 'bg-gray-300'}`} />
                      <span className="flex-1 truncate text-gray-600">{t.subject}</span>
                      {t.dueDate && (
                        <span className="flex-shrink-0 text-gray-400 flex items-center gap-0.5">
                          <Clock size={9} /> {t.dueDate.slice(5)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {card.staleCount > 0 && (
                <div className="mt-2 flex items-center gap-1 text-[10px] text-red-400">
                  <AlertTriangle size={10} /> ada in-progress tanpa update &gt;5 hari
                </div>
              )}
            </div>
          )
        })}
      </div>

      <p className="text-[10px] text-gray-300 mt-4 flex items-center gap-1">
        <Flame size={10} /> Diurutkan dari WIP tertinggi. Data ini sama untuk semua orang, termasuk kamu.
      </p>
    </div>
  )
}
