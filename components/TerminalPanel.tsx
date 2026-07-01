'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

type PanelMode = 'floating' | 'fullscreen' | 'minimized'

interface Props {
  onClose: () => void
}

export default function TerminalPanel({ onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef      = useRef<unknown>(null)
  const fitRef       = useRef<{ fit: () => void } | null>(null)
  const wsRef        = useRef<WebSocket | null>(null)
  const dragRef      = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const resizeRef    = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null)

  const [mode, setMode]       = useState<PanelMode>('floating')
  const [pos,  setPos]        = useState({ x: 80, y: 120 })
  const [size, setSize]       = useState({ w: 720, h: 400 })
  const [connected, setConnected] = useState(false)

  const fit = useCallback(() => {
    setTimeout(() => fitRef.current?.fit(), 50)
  }, [])

  // ── init xterm — dynamic import to avoid SSR `self is not defined` ───────
  useEffect(() => {
    if (!containerRef.current) return
    let disposed = false

    async function init() {
      // Dynamic imports: xterm uses `self` (browser global), cannot be static-imported
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('xterm'),
        import('xterm-addon-fit'),
      ])
      await import('xterm/css/xterm.css')

      // Bail out immediately if cleanup ran during the (fast, local-bundle) import phase
      if (disposed || !containerRef.current) return

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const term = new Terminal({
        cursorBlink: true,
        fontFamily: 'Cascadia Code, Consolas, monospace',
        fontSize: 13,
        theme: { background: '#0d1117', foreground: '#c9d1d9', cursor: '#58a6ff' },
      }) as { open: (el: HTMLElement) => void; write: (d: unknown) => void; onData: (cb: (d: string) => void) => void; onResize: (cb: (s: { cols: number; rows: number }) => void) => void; dispose: () => void; loadAddon: (a: unknown) => void }

      const fitAddon = new FitAddon()
      term.loadAddon(fitAddon)
      term.open(containerRef.current)
      fitAddon.fit()
      termRef.current = term
      fitRef.current  = fitAddon

      // Bypass nginx proxy — direct to Docker port 4891 avoids proxy WebSocket issues.
      // ISL is local-only; 4891 is always the exposed container port.
      const ws = new WebSocket('ws://localhost:4891/terminal')
      wsRef.current = ws

      ws.onopen  = () => { setConnected(true); fitAddon.fit() }
      ws.onclose = (e) => {
        setConnected(false)
        ;(term as { write: (d: string) => void }).write(`\r\n\x1b[31m[disconnected — code ${e.code}]\x1b[0m\r\n`)
      }
      ws.onerror = () => { (term as { write: (d: string) => void }).write('\r\n\x1b[31m[error — ISL terminal server not available]\x1b[0m\r\n') }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ws.onmessage = (e) => { (term as any).write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data as ArrayBuffer)) }

      term.onData((d) => { if (ws.readyState === WebSocket.OPEN) ws.send(d) })
      term.onResize(({ cols, rows }) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows })) })

      const ro = new ResizeObserver(() => fitAddon.fit())
      ro.observe(containerRef.current!)

      return () => { ro.disconnect(); ws.close(); term.dispose() }
    }

    const cleanup = init()
    return () => {
      disposed = true  // Set immediately — checked after await in init()
      cleanup.then(fn => fn?.())
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // re-fit when mode/size changes
  useEffect(() => { fit() }, [mode, size, fit])

  // ── drag title bar ───────────────────────────────────────────────────────
  const onDragStart = (e: React.MouseEvent) => {
    if (mode !== 'floating') return
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y }
    e.preventDefault()
  }
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragRef.current) return
      setPos({ x: dragRef.current.origX + e.clientX - dragRef.current.startX, y: dragRef.current.origY + e.clientY - dragRef.current.startY })
    }
    const up = () => { dragRef.current = null }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [])

  // ── resize handle ────────────────────────────────────────────────────────
  const onResizeStart = (e: React.MouseEvent) => {
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: size.w, origH: size.h }
    e.preventDefault(); e.stopPropagation()
  }
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!resizeRef.current) return
      const w = Math.max(400, resizeRef.current.origW + e.clientX - resizeRef.current.startX)
      const h = Math.max(200, resizeRef.current.origH + e.clientY - resizeRef.current.startY)
      setSize({ w, h })
    }
    const up = () => { if (resizeRef.current) { resizeRef.current = null; fit() } }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [fit])

  // ── panel styles ─────────────────────────────────────────────────────────
  const panelStyle: React.CSSProperties = mode === 'fullscreen'
    ? { position: 'fixed', inset: 0, zIndex: 9999 }
    : mode === 'minimized'
    ? { position: 'fixed', bottom: 0, right: 24, width: 280, zIndex: 9999 }
    : { position: 'fixed', left: pos.x, top: pos.y, width: size.w, height: size.h, zIndex: 9999 }

  return (
    <div style={panelStyle} className="flex flex-col rounded-t-lg overflow-hidden shadow-2xl border border-white/10"
      onMouseDown={(e) => e.stopPropagation()}>

      {/* Title bar */}
      <div
        onMouseDown={onDragStart}
        className="flex items-center gap-2 px-3 py-1.5 bg-[#161b22] border-b border-white/10 select-none"
        style={{ cursor: mode === 'floating' ? 'move' : 'default' }}>
        <span className="text-white/40 text-xs font-mono">⬛</span>
        <span className="text-white/70 text-xs font-mono flex-1">Terminal</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${connected ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900/50 text-red-400'}`}>
          {connected ? 'connected' : 'disconnected'}
        </span>
        <div className="flex gap-1 ml-2">
          <button onClick={() => setMode(m => m === 'minimized' ? 'floating' : 'minimized')}
            title={mode === 'minimized' ? 'Restore' : 'Minimize'}
            className="w-5 h-5 rounded flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 text-xs">
            {mode === 'minimized' ? '▲' : '▂'}
          </button>
          <button onClick={() => setMode(m => m === 'fullscreen' ? 'floating' : 'fullscreen')}
            title={mode === 'fullscreen' ? 'Exit Fullscreen' : 'Fullscreen'}
            className="w-5 h-5 rounded flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 text-xs">
            {mode === 'fullscreen' ? '⊡' : '⊞'}
          </button>
          <button onClick={onClose}
            title="Close"
            className="w-5 h-5 rounded flex items-center justify-center text-white/40 hover:text-red-400 hover:bg-white/10 text-xs">
            ✕
          </button>
        </div>
      </div>

      {/* Terminal body */}
      {mode !== 'minimized' && (
        <div className="flex-1 relative bg-[#0d1117] min-h-0">
          <div ref={containerRef} className="absolute inset-0 p-1" />
          {/* Resize handle */}
          {mode === 'floating' && (
            <div onMouseDown={onResizeStart}
              className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
              style={{ background: 'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.15) 50%)' }} />
          )}
        </div>
      )}
    </div>
  )
}
