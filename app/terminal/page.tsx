'use client'

import { useEffect, useRef } from 'react'

export default function TerminalPage() {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef      = useRef<unknown>(null)
  const wsRef        = useRef<WebSocket | null>(null)

  useEffect(() => {
    let term: {
      open: (el: HTMLElement) => void
      write: (data: string) => void
      onData: (cb: (data: string) => void) => void
      onResize: (cb: (size: { cols: number; rows: number }) => void) => void
      dispose: () => void
      loadAddon: (addon: unknown) => void
    } | null = null

    async function init() {
      // Load xterm + FitAddon from CDN via dynamic script injection
      await loadScript('https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.min.js')
      await loadScript('https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.min.js')
      // Load CSS
      if (!document.getElementById('xterm-css')) {
        const link = document.createElement('link')
        link.id   = 'xterm-css'
        link.rel  = 'stylesheet'
        link.href = 'https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.min.css'
        document.head.appendChild(link)
      }

      const w = window as unknown as {
        Terminal: new (opts: object) => typeof term
        FitAddon: { FitAddon: new () => { fit: () => void } }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      term = new (w.Terminal as any)({
        cursorBlink: true,
        fontFamily: 'Cascadia Code, Consolas, monospace',
        fontSize: 14,
        theme: {
          background: '#0d1117',
          foreground: '#c9d1d9',
          cursor:     '#58a6ff',
        },
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fitAddon = new (w.FitAddon as any).FitAddon()
      term!.loadAddon(fitAddon)
      term!.open(containerRef.current!)
      fitAddon.fit()
      termRef.current = term

      // Connect to launcher dashboard WebSocket terminal
      const ws = new WebSocket('ws://localhost:9000/terminal')
      wsRef.current = ws

      ws.onopen = () => {
        // Send initial resize
        const el = containerRef.current
        if (el) {
          fitAddon.fit()
        }
      }

      ws.onmessage = (e) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(term as any).write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data as any))
      }

      ws.onclose = () => {
        term!.write('\r\n\x1b[31m[Connection closed]\x1b[0m\r\n')
      }

      ws.onerror = () => {
        term!.write('\r\n\x1b[31m[WebSocket error — is launcher-dashboard running on port 9000?]\x1b[0m\r\n')
      }

      term!.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data)
      })

      term!.onResize(({ cols, rows }: { cols: number; rows: number }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols, rows }))
        }
      })

      // Resize observer
      const ro = new ResizeObserver(() => fitAddon.fit())
      if (containerRef.current) ro.observe(containerRef.current)

      return () => {
        ro.disconnect()
        ws.close()
        term!.dispose()
      }
    }

    const cleanup = init()
    return () => { cleanup.then(fn => fn?.()) }
  }, [])

  return (
    <div className="flex flex-col h-screen bg-[#0d1117]">
      <div className="flex items-center gap-3 px-4 py-2 bg-[#161b22] border-b border-white/10">
        <a href="/" className="text-blue-400 hover:text-blue-300 text-sm transition">← ISL</a>
        <span className="text-white/60 text-sm font-mono">Terminal</span>
        <span className="ml-auto text-white/30 text-xs">ws://localhost:9000/terminal</span>
      </div>
      <div ref={containerRef} className="flex-1 p-2" style={{ minHeight: 0 }} />
    </div>
  )
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
    const s = document.createElement('script')
    s.src = src
    s.onload  = () => resolve()
    s.onerror = () => reject(new Error(`Failed to load ${src}`))
    document.head.appendChild(s)
  })
}
