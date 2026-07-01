'use client'

import { useState, useEffect, useCallback } from 'react'
import type { SessionLog } from '@/lib/session-store'
import type { KBEntry } from '@/lib/kb-store'
import {
  Bot, Inbox, Brain, ClipboardList, FileText,
  Sparkles, PartyPopper, Lightbulb, Zap,
  CircleDot, MapPin, ChevronDown, ChevronUp, ArrowRight, Layers,
} from 'lucide-react'

interface SprintContext {
  sprint?: { id: number; name: string; startDate: string; endDate: string }
  openTasks?: Array<{ id: number; subject: string; status?: string; estimatedTime?: string }>
}

interface HubData {
  hubSessions: SessionLog[]
  kbEntries: KBEntry[]
  sprintContext: SprintContext | null
  date: string
}

type Tab = 'today' | 'sessions' | 'triage'

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function durationLabel(mins?: number | null) {
  if (!mins) return null
  if (mins >= 60) return `${Math.floor(mins / 60)}h${mins % 60 > 0 ? ` ${mins % 60}m` : ''}`
  return `${mins}m`
}

// ── Today Tab — AI Suggest ───────────────────────────────────────────────────
const SUGGEST_KEY = 'isl-daily-hub-suggest'

function TodayTab({ data, onRefresh }: { data: HubData; onRefresh: () => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const [suggest, setSuggest] = useState<string | null>(() => {
    try {
      const saved = localStorage.getItem(SUGGEST_KEY)
      if (!saved) return null
      const { date, text } = JSON.parse(saved)
      return date === today ? text : null
    } catch { return null }
  })
  const [loading, setLoading] = useState(false)

  const generateSuggest = useCallback(async () => {
    setLoading(true)
    try {
      const context = {
        sprint: data.sprintContext?.sprint,
        openTasks: data.sprintContext?.openTasks?.slice(0, 5),
        hubSessions: data.hubSessions.slice(0, 5).map(s => ({ title: s.title, bullets: s.bullets.slice(0, 3), actualMins: s.actualMins, date: s.date })),
        kbEntries: data.kbEntries.slice(0, 3).map(e => ({ title: e.title, summary: e.summary, keyPoints: e.keyPoints.slice(0, 3) })),
      }
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: [{
            role: 'user',
            content: `You are an AI assistant in ISL (Integrity Sprint Log).

Based on the data below, suggest 2-3 of the most important tasks to work on today.
Format: numbered list, each item: task name + time estimate + one-sentence reason.
Be concise and actionable. Reply in English.

Sprint context data:
${JSON.stringify(context, null, 2)}`,
          }],
        }),
      })
      if (res.ok) {
        // Handle streaming response
        const reader = res.body?.getReader()
        if (!reader) { setSuggest(await res.text()); return }
        const decoder = new TextDecoder()
        let full = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          // Strip SSE prefix if present
          const lines = chunk.split('\n')
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try { const d = JSON.parse(line.slice(6)); full += d.text ?? d.content ?? '' } catch { full += line.slice(6) }
            } else if (!line.startsWith(':') && line.trim()) {
              full += line
            }
          }
          setSuggest(full)
          try { localStorage.setItem(SUGGEST_KEY, JSON.stringify({ date: today, text: full })) } catch {}
        }
      }
    } catch {}
    setLoading(false)
  }, [data, today])

  const sprint = data.sprintContext?.sprint
  const pendingCount = data.hubSessions.length
  const kbCount = data.kbEntries.length

  return (
    <div className="space-y-4">
      {/* Sprint status */}
      {sprint && (
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block" />
          <span className="font-medium text-gray-700 dark:text-gray-300">{sprint.name}</span>
          <span>·</span>
          <span>{sprint.endDate} ends</span>
          {pendingCount > 0 && <><span>·</span><span className="text-amber-600 dark:text-amber-400">{pendingCount} sessions need triage</span></>}
        </div>
      )}

      {/* AI Suggest card */}
      <div className="border border-indigo-100 dark:border-indigo-900 rounded-xl bg-indigo-50/40 dark:bg-indigo-950/20 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot size={16} className="text-indigo-500" />
            <span className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">Today's Focus</span>
          </div>
          <button
            onClick={generateSuggest}
            disabled={loading}
            className="text-xs px-3 py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition font-medium"
          >
            {loading ? 'Generating...' : suggest ? 'Refresh' : 'Generate'}
          </button>
        </div>

        {suggest ? (
          <div className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">{suggest}</div>
        ) : (
          <p className="text-xs text-gray-400 dark:text-gray-500 italic">
            Click Generate to get AI suggestions based on your active sprint and recent sessions.
          </p>
        )}
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Hub Sessions" value={pendingCount} color="amber" icon={<Inbox size={20} />} />
        <StatCard label="KB Entries" value={kbCount} color="violet" icon={<Brain size={20} />} />
        <StatCard label="OP Open Tasks" value={data.sprintContext?.openTasks?.length ?? 0} color="blue" icon={<ClipboardList size={20} />} />
      </div>

      {/* Recent hub sessions preview */}
      {data.hubSessions.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Recent Sessions (not yet triaged)</p>
          {data.hubSessions.slice(0, 3).map(s => (
            <div key={s.id} className="flex items-start gap-3 px-3 py-2.5 rounded-lg border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
              <FileText size={14} className="mt-0.5 text-gray-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">{s.title}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{s.date} · {durationLabel(s.actualMins) ?? '?'}</p>
              </div>
            </div>
          ))}
          {data.hubSessions.length > 3 && (
            <p className="text-xs text-gray-400 text-center">+{data.hubSessions.length - 3} more — open Sessions tab</p>
          )}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, color, icon }: { label: string; value: number; color: string; icon: React.ReactNode }) {
  const colors: Record<string, string> = {
    amber: 'border-amber-100 dark:border-amber-900 bg-amber-50/40 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300',
    violet: 'border-violet-100 dark:border-violet-900 bg-violet-50/40 dark:bg-violet-950/20 text-violet-700 dark:text-violet-300',
    blue: 'border-blue-100 dark:border-blue-900 bg-blue-50/40 dark:bg-blue-950/20 text-blue-700 dark:text-blue-300',
  }
  return (
    <div className={`rounded-xl border p-3 text-center ${colors[color] ?? ''}`}>
      <div className="flex justify-center">{icon}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
      <div className="text-[10px] mt-0.5 opacity-80">{label}</div>
    </div>
  )
}

// ── Sessions Tab — semua hub sessions ────────────────────────────────────────
function SessionsTab({ sessions, onTriage }: { sessions: SessionLog[]; onTriage: (id: string, action: string) => void }) {
  if (!sessions.length) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3 text-gray-400">
        <Sparkles size={28} />
        <p className="text-sm">No sessions need triage</p>
        <p className="text-xs text-center max-w-xs">Sessions appear here live while chats are active, then finalize when closed</p>
      </div>
    )
  }

  // Group by date, newest first
  const liveCount = sessions.filter(s => s.pushStatus === 'live').length
  const grouped = sessions.reduce<Record<string, SessionLog[]>>((acc, s) => {
    const d = s.date ?? s.startedAt?.slice(0, 10) ?? 'unknown'
    if (!acc[d]) acc[d] = []
    acc[d].push(s)
    return acc
  }, {})
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a))
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {liveCount > 0 && <span className="text-emerald-600 font-semibold inline-flex items-center gap-1"><CircleDot size={10} className="text-emerald-500" /> {liveCount} live · </span>}
        {sessions.filter(s => s.pushStatus !== 'live').length} pending triage · saved until you decide
      </p>
      {sortedDates.map(date => (
        <div key={date} className="space-y-2">
          <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
            {date === today ? <span className="inline-flex items-center gap-1"><MapPin size={10} /> Today</span> : date}
          </p>
          {grouped[date].map(s => (
            <SessionCard key={s.id} session={s} onTriage={onTriage} />
          ))}
        </div>
      ))}
    </div>
  )
}

function SessionCard({ session: s, onTriage }: { session: SessionLog; onTriage: (id: string, action: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const isLive = s.pushStatus === 'live'

  return (
    <div className={`border rounded-xl overflow-hidden ${
      isLive
        ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/20'
        : 'border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900'
    }`}>
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition"
      >
        {isLive
          ? <CircleDot size={14} className="mt-0.5 text-emerald-500 flex-shrink-0 animate-pulse" />
          : <FileText size={14} className="mt-0.5 text-gray-400 flex-shrink-0" />
        }
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 leading-snug truncate">{s.title}</p>
            {isLive && (
              <span className="flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 animate-pulse">
                LIVE
              </span>
            )}
          </div>
          <p className="text-[10px] text-gray-400 mt-0.5">
            {isLive ? `Started ${timeAgo(s.startedAt)} · still active` : `${s.date} · ${durationLabel(s.actualMins) ?? '?'} · ${timeAgo(s.createdAt)}`}
          </p>
        </div>
        {expanded ? <ChevronUp size={12} className="text-gray-300 dark:text-gray-600 flex-shrink-0 mt-1" /> : <ChevronDown size={12} className="text-gray-300 dark:text-gray-600 flex-shrink-0 mt-1" />}
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-3 border-t border-gray-100 dark:border-gray-800">
          {isLive ? (
            <div className="mt-2 space-y-1.5">
              {s.bullets.length > 0 ? (
                <>
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-emerald-500 dark:text-emerald-400">Topics discussed so far</p>
                  <ul className="space-y-1">
                    {s.bullets.map((b, i) => (
                      <li key={i} className="text-[11px] text-gray-600 dark:text-gray-400 pl-3 border-l-2 border-emerald-200 dark:border-emerald-800 flex items-start gap-1">
                        <span className="text-emerald-400 flex-shrink-0">·</span>{b}
                      </li>
                    ))}
                  </ul>
                  <p className="text-[9px] text-gray-300 dark:text-gray-600 italic">Auto-updating · full analysis when session closes</p>
                </>
              ) : (
                <p className="text-[11px] text-gray-400 italic">Session in progress — topics will appear as you chat</p>
              )}
            </div>
          ) : s.bullets.length > 0 && (
            <ul className="mt-2 space-y-1">
              {s.bullets.map((b, i) => (
                <li key={i} className="text-[11px] text-gray-600 dark:text-gray-400 pl-3 border-l-2 border-gray-200 dark:border-gray-700">{b}</li>
              ))}
            </ul>
          )}
          {!isLive && (
            <div className="flex gap-2 flex-wrap pt-1">
              <ActionBtn onClick={() => onTriage(s.id, 'queue')} color="indigo" label="→ Push Queue" />
              <ActionBtn onClick={() => onTriage(s.id, 'backlog')} color="gray" label="→ Backlog" />
              <ActionBtn onClick={() => onTriage(s.id, 'discard')} color="red" label="Discard" />
            </div>
          )}
          {isLive && (
            <p className="text-[10px] text-gray-400 pt-1">Triage options available after session ends</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Triage Tab — semua sekaligus ─────────────────────────────────────────────
function TriageTab({ sessions, kbEntries, onTriage, onTriageKB }: {
  sessions: SessionLog[]
  kbEntries: KBEntry[]
  onTriage: (id: string, action: string) => void
  onTriageKB: (id: string, action: string) => void
}) {
  const [bulkConfirm, setBulkConfirm] = useState<'queue' | 'backlog' | null>(null)
  const all = sessions.length + kbEntries.length

  if (!all) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3 text-gray-400">
        <PartyPopper size={28} />
        <p className="text-sm font-medium">All triaged!</p>
      </div>
    )
  }

  const executeBulk = (action: 'queue' | 'backlog') => {
    sessions.forEach(s => onTriage(s.id, action))
    setBulkConfirm(null)
  }

  return (
    <div className="space-y-4">
      {/* Bulk confirm dialog */}
      {bulkConfirm && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 flex items-center justify-between gap-3">
          <p className="text-xs text-amber-800 dark:text-amber-300 font-medium">
            {bulkConfirm === 'queue'
              ? `Push semua ${sessions.length} sesi ke Queue?`
              : `Pindah semua ${sessions.length} sesi ke Backlog?`}
          </p>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => executeBulk(bulkConfirm)}
              className="text-xs px-3 py-1 rounded-lg font-semibold bg-amber-600 text-white hover:bg-amber-700 transition"
            >
              Ya, lanjut
            </button>
            <button
              onClick={() => setBulkConfirm(null)}
              className="text-xs px-3 py-1 rounded-lg font-medium bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 transition"
            >
              Batal
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{all} items need a decision</p>
        <div className="flex gap-2">
          <button
            onClick={() => setBulkConfirm('queue')}
            className="text-xs px-2 py-1 rounded bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 transition"
          >
            All → Queue
          </button>
          <button
            onClick={() => setBulkConfirm('backlog')}
            className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 transition"
          >
            All → Backlog
          </button>
        </div>
      </div>

      {sessions.map(s => (
        <div key={s.id} className="border border-amber-100 dark:border-amber-900/50 rounded-xl p-4 bg-amber-50/30 dark:bg-amber-950/10 space-y-2">
          <div className="flex items-start gap-2">
            <FileText size={14} className="text-gray-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">{s.title}</p>
              <p className="text-[10px] text-gray-400">{s.date} · {durationLabel(s.actualMins) ?? '?'}</p>
              {s.bullets.slice(0, 2).map((b, i) => (
                <p key={i} className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 pl-2 border-l border-gray-200 dark:border-gray-700">{b}</p>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <ActionBtn onClick={() => onTriage(s.id, 'queue')} color="indigo" label="→ Push Queue" />
            <ActionBtn onClick={() => onTriage(s.id, 'backlog')} color="gray" label="→ Backlog" />
            <ActionBtn onClick={() => onTriage(s.id, 'discard')} color="red" label="Discard" />
          </div>
        </div>
      ))}

      {kbEntries.map(e => (
        <div key={e.id} className="border border-violet-100 dark:border-violet-900/50 rounded-xl p-4 bg-violet-50/30 dark:bg-violet-950/10 space-y-2">
          <div className="flex items-start gap-2">
            <Layers size={14} className="text-violet-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">{e.title}</p>
              <p className="text-[10px] text-gray-400">{e.date} · KB Entry</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{e.summary}</p>
              {e.suggestedTask && (
                <p className="text-[11px] text-indigo-600 dark:text-indigo-400 mt-1 flex items-start gap-1"><Lightbulb size={11} className="flex-shrink-0 mt-0.5" /> Suggested task: {e.suggestedTask}</p>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <ActionBtn onClick={() => onTriageKB(e.id, 'queue')} color="indigo" label="→ Push Queue" />
            <ActionBtn onClick={() => onTriageKB(e.id, 'backlog')} color="gray" label="→ Backlog" />
            <ActionBtn onClick={() => onTriageKB(e.id, 'discard')} color="red" label="Discard" />
          </div>
        </div>
      ))}
    </div>
  )
}

function ActionBtn({ onClick, color, label }: { onClick: () => void; color: string; label: string }) {
  const styles: Record<string, string> = {
    indigo: 'bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-900',
    gray: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700',
    red: 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/60',
  }
  return (
    <button onClick={onClick} className={`text-xs px-3 py-1 rounded-lg font-medium transition ${styles[color] ?? ''}`}>
      {label}
    </button>
  )
}

// ── Main DailyHub Component ──────────────────────────────────────────────────
export default function DailyHub() {
  const [tab, setTab] = useState<Tab>('today')
  const [data, setData] = useState<HubData | null>(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/daily-hub')
      if (res.ok) setData(await res.json())
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const handleTriage = async (sessionId: string, action: string) => {
    await fetch('/api/daily-hub', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, action }),
    })
    showToast(action === 'queue' ? 'Added to Push Queue' : action === 'backlog' ? 'Moved to Backlog' : 'Discarded')
    fetchData()
  }

  const handleTriageKB = async (kbId: string, action: string) => {
    await fetch('/api/daily-hub', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kbId, action }),
    })
    showToast(action === 'queue' ? 'Added to Push Queue' : action === 'backlog' ? 'Moved to Backlog' : 'Discarded')
    fetchData()
  }

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode; count?: number }> = [
    { id: 'today',    label: 'Today',    icon: <Bot size={13} /> },
    { id: 'sessions', label: 'Sessions', icon: <FileText size={13} />, count: data?.hubSessions.length },
    { id: 'triage',   label: 'Triage',   icon: <Zap size={13} />, count: (data?.hubSessions.length ?? 0) + (data?.kbEntries.length ?? 0) },
  ]

  return (
    <div className="space-y-4 relative">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-medium shadow-lg">
          {toast}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition ${
              tab === t.id
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
            {t.count !== undefined && t.count > 0 && (
              <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 text-[9px] font-bold">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center h-32 text-gray-400 text-sm">Loading...</div>
      ) : !data ? (
        <div className="flex items-center justify-center h-32 text-gray-400 text-sm">Failed to load data</div>
      ) : (
        <div>
          {tab === 'today' && <TodayTab data={data} onRefresh={fetchData} />}
          {tab === 'sessions' && <SessionsTab sessions={data.hubSessions} onTriage={handleTriage} />}
          {tab === 'triage' && (
            <TriageTab
              sessions={data.hubSessions}
              kbEntries={data.kbEntries}
              onTriage={handleTriage}
              onTriageKB={handleTriageKB}
            />
          )}
        </div>
      )}
    </div>
  )
}
