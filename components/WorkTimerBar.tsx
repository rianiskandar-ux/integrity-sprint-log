'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

interface Timer {
  startedAt: string
  taskTitle: string
  sessionId?: string | null
  opTaskId?: number | null
}

function fmtElapsed(startedAt: string, now: number): string {
  const s = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
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

  // Other components start a timer by dispatching isl:start-timer with the task detail
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

  // Live tick while a timer is running
  useEffect(() => {
    if (timer) {
      tickRef.current = setInterval(() => setNow(Date.now()), 1000)
    }
    return () => { if (tickRef.current) clearInterval(tickRef.current) }
  }, [timer])

  async function stop() {
    if (busy) return
    setBusy(true)
    try {
      const r = await fetch('/api/timer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      }).then(res => res.json())
      setTimer(null)
      if (r.elapsedMins) {
        setToast(`⏱ ${r.elapsedMins} menit tercatat${r.timer?.sessionId ? ' sebagai actual' : ''}.`)
        setTimeout(() => setToast(null), 5000)
        // let other views refresh (e.g. session actualMins updated)
        window.dispatchEvent(new CustomEvent('isl:timer-stopped', { detail: r }))
      }
    } catch { /* ignore */ } finally { setBusy(false) }
  }

  if (!mounted) return null
  if (!timer && !toast) return null

  return createPortal(
    <div style={{ position: 'fixed', bottom: 84, left: 20, zIndex: 9997 }}>
      {timer && (
        <div className="flex items-center gap-3 rounded-2xl shadow-2xl px-4 py-2.5 text-white"
          style={{ background: 'linear-gradient(135deg,#0f766e,#0d9488)' }}>
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-200" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] text-emerald-100/80 leading-none uppercase tracking-wider">Lagi ngerjain</p>
            <p className="text-xs font-bold leading-tight truncate max-w-[200px]">
              {timer.opTaskId ? `#${timer.opTaskId} · ` : ''}{timer.taskTitle}
            </p>
          </div>
          <span className="font-mono text-base font-bold tabular-nums">{fmtElapsed(timer.startedAt, now)}</span>
          <button onClick={stop} disabled={busy}
            className="ml-1 text-[11px] font-bold px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/30 border border-white/25 transition disabled:opacity-50">
            ⏹ Stop
          </button>
        </div>
      )}
      {!timer && toast && (
        <div className="rounded-2xl shadow-2xl px-4 py-2.5 text-xs font-semibold bg-emerald-600 text-white">
          {toast}
        </div>
      )}
    </div>,
    document.body,
  )
}
