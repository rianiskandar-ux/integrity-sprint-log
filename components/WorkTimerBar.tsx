'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

interface Timer {
  startedAt: string
  accumulatedMs: number
  paused: boolean
  taskTitle: string
  sessionId?: string | null
  opTaskId?: number | null
}

const STALE_MINS = 600 // 10h — warn that the timer was probably forgotten

function elapsedSeconds(t: Timer, now: number): number {
  const ms = t.accumulatedMs + (t.paused ? 0 : now - new Date(t.startedAt).getTime())
  return Math.max(0, Math.floor(ms / 1000))
}
function fmtElapsed(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export default function WorkTimerBar() {
  const [timer, setTimer]   = useState<Timer | null>(null)
  const [now, setNow]       = useState(() => Date.now())
  const [toast, setToast]   = useState<string | null>(null)
  const [busy, setBusy]     = useState(false)
  const [mounted, setMounted] = useState(false)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => { setMounted(true) }, [])

  const refresh = useCallback(() => {
    fetch('/api/timer').then(r => r.json()).then(d => setTimer(d.timer ?? null)).catch(() => {})
  }, [])
  useEffect(() => { refresh() }, [refresh])

  // Other components start a timer by dispatching isl:start-timer
  useEffect(() => {
    async function onStart(e: Event) {
      const d = (e as CustomEvent).detail ?? {}
      setBusy(true)
      try {
        const r = await fetch('/api/timer', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'start', taskTitle: d.taskTitle, sessionId: d.sessionId, opTaskId: d.opTaskId }),
        }).then(res => res.json())
        if (r.timer) { setTimer(r.timer); setNow(Date.now()) }
      } catch { /* ignore */ } finally { setBusy(false) }
    }
    window.addEventListener('isl:start-timer', onStart as EventListener)
    return () => window.removeEventListener('isl:start-timer', onStart as EventListener)
  }, [])

  // Live tick while running (not while paused)
  useEffect(() => {
    if (timer && !timer.paused) tickRef.current = setInterval(() => setNow(Date.now()), 1000)
    return () => { if (tickRef.current) clearInterval(tickRef.current) }
  }, [timer])

  async function act(action: 'pause' | 'resume' | 'stop') {
    if (busy) return
    setBusy(true)
    try {
      const r = await fetch('/api/timer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      }).then(res => res.json())
      if (action === 'stop') {
        setTimer(null)
        if (r.suspicious) {
          setToast(`⏱ ${Math.round(r.elapsedMins / 60)}j terukur — kemungkinan lupa stop. Set waktu manual di session kalau perlu (ga otomatis ditulis).`)
          setTimeout(() => setToast(null), 9000)
        } else if (r.elapsedMins) {
          const accumulated = r.totalActual != null && r.totalActual !== r.elapsedMins
          setToast(accumulated
            ? `⏱ +${r.elapsedMins} menit → total ${r.totalActual} menit actual.`
            : `⏱ ${r.elapsedMins} menit tercatat${r.timer?.sessionId ? ' sebagai actual' : ''}.`)
          setTimeout(() => setToast(null), 5000)
        }
        window.dispatchEvent(new CustomEvent('isl:timer-stopped', { detail: r }))
      } else {
        setTimer(r.timer ?? null); setNow(Date.now())
      }
    } catch { /* ignore */ } finally { setBusy(false) }
  }

  if (!mounted) return null
  if (!timer && !toast) return null

  const sec   = timer ? elapsedSeconds(timer, now) : 0
  const stale = sec / 60 > STALE_MINS
  const bg    = timer?.paused ? 'linear-gradient(135deg,#b45309,#d97706)'
              : stale         ? 'linear-gradient(135deg,#b91c1c,#dc2626)'
              :                 'linear-gradient(135deg,#0f766e,#0d9488)'

  return createPortal(
    <div style={{ position: 'fixed', bottom: 84, left: 20, zIndex: 9997 }}>
      {timer && (
        <div className="flex items-center gap-2.5 rounded-2xl shadow-2xl px-4 py-2.5 text-white" style={{ background: bg }}>
          <span className="relative flex h-2.5 w-2.5">
            {!timer.paused && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-60" />}
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white/90" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] text-white/75 leading-none uppercase tracking-wider">
              {timer.paused ? 'Paused' : stale ? '⚠️ lupa stop?' : 'Lagi ngerjain'}
            </p>
            <p className="text-xs font-bold leading-tight truncate max-w-[190px]">
              {timer.opTaskId ? `#${timer.opTaskId} · ` : ''}{timer.taskTitle}
            </p>
          </div>
          <span className="font-mono text-base font-bold tabular-nums">{fmtElapsed(sec)}</span>
          {timer.paused ? (
            <button onClick={() => act('resume')} disabled={busy} title="Lanjut"
              className="text-[11px] font-bold px-2 py-1 rounded-lg bg-white/15 hover:bg-white/30 border border-white/25 transition disabled:opacity-50">▶</button>
          ) : (
            <button onClick={() => act('pause')} disabled={busy} title="Jeda (istirahat/meeting)"
              className="text-[11px] font-bold px-2 py-1 rounded-lg bg-white/15 hover:bg-white/30 border border-white/25 transition disabled:opacity-50">⏸</button>
          )}
          <button onClick={() => act('stop')} disabled={busy}
            className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/30 border border-white/25 transition disabled:opacity-50">⏹ Stop</button>
        </div>
      )}
      {!timer && toast && (
        <div className="rounded-2xl shadow-2xl px-4 py-2.5 text-xs font-semibold bg-emerald-600 text-white max-w-xs">{toast}</div>
      )}
    </div>,
    document.body,
  )
}
