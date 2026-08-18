'use client'

import { useEffect, useRef } from 'react'

const PING_INTERVAL_MS = 30_000
const IDLE_AFTER_MS    = 10 * 60_000  // no interaction for 10 min = idle

// Mounted once in AppShell, renders nothing. Tracks real browser interaction
// (mouse/keyboard/scroll/visibility) purely client-side and posts a single
// `idle` boolean every 30s — the only signal that ever leaves this component.
// No window title, no page content, no per-action logging: see the Team Board
// design discussion (2026-08-05) for why that line was deliberately not crossed.
export default function PresenceHeartbeat() {
  const lastActive = useRef(Date.now())

  useEffect(() => {
    const bump = () => { lastActive.current = Date.now() }
    const events: Array<keyof WindowEventMap> = ['mousemove', 'keydown', 'scroll', 'click', 'touchstart']
    events.forEach(e => window.addEventListener(e, bump, { passive: true }))

    function ping() {
      const idle = document.visibilityState === 'hidden' || (Date.now() - lastActive.current) > IDLE_AFTER_MS
      fetch('/api/presence/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idle }),
        keepalive: true,
      }).catch(() => { /* best-effort — a missed heartbeat just means one stale minute on the board */ })
    }

    ping() // immediate, so a quick visit still registers
    const timer = setInterval(ping, PING_INTERVAL_MS)
    return () => {
      clearInterval(timer)
      events.forEach(e => window.removeEventListener(e, bump))
    }
  }, [])

  return null
}
