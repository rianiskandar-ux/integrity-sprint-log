'use client'

import { useEffect, useRef } from 'react'

export default function TerminalPage() {
  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef        = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    let disposed = false

    async function init() {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('xterm'),
        import('xterm-addon-fit'),
      ])
      await import('xterm/css/xterm.css')

      if (disposed || !containerRef.current) return

      const term = new Terminal({
        cursorBlink: true,
        fontFamily: 'Cascadia Code, Consolas, monospace',
        fontSize: 14,
        theme: { background: '#0d1117', foreground: '#c9d1d9', cursor: '#58a6ff' },
      })
      const fitAddon = new FitAddon()
      term.loadAddon(fitAddon)
      term.open(containerRef.current)
      fitAddon.fit()

      // Bypass nginx proxy — direct to Docker port 4891 avoids proxy WebSocket issues.
      const ws = new WebSocket('ws://localhost:4891/terminal')
      wsRef.current = ws

      ws.onopen  = () => { fitAddon.fit() }
      ws.onmessage = (e) => { term.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data as ArrayBuffer)) }
      ws.onclose = () => { term.write('\r\n\x1b[31m[Connection closed]\x1b[0m\r\n') }
      ws.onerror = () => { term.write('\r\n\x1b[31m[WebSocket error — ISL terminal server not available]\x1b[0m\r\n') }

      term.onData((d) => { if (ws.readyState === WebSocket.OPEN) ws.send(d) })
      term.onResize(({ cols, rows }) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows })) })

      const ro = new ResizeObserver(() => fitAddon.fit())
      ro.observe(containerRef.current!)

      return () => { ro.disconnect(); ws.close(); term.dispose() }
    }

    const cleanup = init()
    return () => {
      disposed = true
      cleanup.then(fn => fn?.())
    }
  }, [])

  return (
    <div className="flex flex-col h-screen bg-[#0d1117]">
      <div className="flex items-center gap-3 px-4 py-2 bg-[#161b22] border-b border-white/10">
        <a href="/" className="text-blue-400 hover:text-blue-300 text-sm transition">← ISL</a>
        <span className="text-white/60 text-sm font-mono">Terminal</span>
        <span className="ml-auto text-white/30 text-xs">ISL Terminal</span>
      </div>
      <div ref={containerRef} className="flex-1 p-2" style={{ minHeight: 0 }} />
    </div>
  )
}
