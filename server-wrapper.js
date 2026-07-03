'use strict'
/**
 * ISL Terminal Server — wraps Next.js standalone with a WebSocket terminal.
 * Monkey-patches http.createServer so the terminal WS lives on the same port
 * as Next.js (3000 inside Docker → 4891 on host), no extra port needed.
 */
const http = require('http')
const { WebSocketServer } = require('ws')
const pty = require('@homebridge/node-pty-prebuilt-multiarch')

const ALLOWED_ORIGINS = new Set(['localhost', '127.0.0.1', '::1', 'daily-sprint.test'])

// ── Claude CLI self-heal ─────────────────────────────────────────────
// Corporate network blokir npm saat docker build, jadi binary sering hilang
// setelah rebuild. Install sekali ke /opt/claude-cli (named volume, survive
// rebuild); startup berikutnya menemukan binary dan skip. Non-blocking —
// Next.js tetap boot; provider claude-cli baru siap begitu install selesai.
;(function ensureClaudeCLI() {
  if (process.platform === 'win32') return
  const { existsSync } = require('fs')
  const { spawn } = require('child_process')
  const PREFIX = '/opt/claude-cli'
  if (existsSync(`${PREFIX}/bin/claude`)) { console.log('[claude-cli] binary ok:', `${PREFIX}/bin/claude`); return }
  if (existsSync('/usr/local/bin/claude')) { console.log('[claude-cli] binary ok: /usr/local/bin/claude'); return }
  console.log('[claude-cli] binary tidak ditemukan — install ke', PREFIX, '…')
  const inst = spawn('npm', ['install', '-g', `--prefix=${PREFIX}`, '@anthropic-ai/claude-code'], {
    env: { ...process.env, npm_config_cache: '/tmp/.npm' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  inst.stdout.on('data', d => process.stdout.write(`[claude-cli] ${d}`))
  inst.stderr.on('data', d => process.stderr.write(`[claude-cli] ${d}`))
  inst.on('close', code => console.log(code === 0
    ? '[claude-cli] install sukses — provider claude-cli siap'
    : `[claude-cli] install gagal (exit ${code}) — cek jaringan, atau jalankan manual: docker exec --user root integrity-sprint-log npm install -g @anthropic-ai/claude-code`))
  inst.on('error', e => console.error('[claude-cli] install error:', e.message))
})()

// Intercept the first http.createServer call (which is Next.js's server).
const _orig = http.createServer.bind(http)
let _attached = false

http.createServer = function (...args) {
  const server = _orig(...args)
  if (!_attached) {
    _attached = true
    attachTerminal(server)
  }
  return server
}

function attachTerminal(server) {
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost')
      if (pathname !== '/terminal') { socket.destroy(); return }

      // Origin check — only local hosts allowed
      const origin = req.headers.origin || ''
      let ok = !origin // allow no-origin (e.g. curl tests)
      if (!ok) {
        try { ok = ALLOWED_ORIGINS.has(new URL(origin).hostname) } catch {}
      }
      if (!ok) {
        console.log('[isl-terminal] 403 FORBIDDEN origin:', origin)
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
        socket.destroy()
        return
      }

      console.log('[isl-terminal] upgrade accepted, origin:', origin || '(none)')
      wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
    } catch (e) { console.error('[isl-terminal] upgrade error:', e.message); socket.destroy() }
  })

  wss.on('connection', (ws) => {
    console.log('[isl-terminal] WS connected, readyState:', ws.readyState)
    let proc
    try {
      proc = pty.spawn('sh', [], {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd: '/app',
        env: { ...process.env, TERM: 'xterm-color' },
      })
      console.log('[isl-terminal] pty spawned OK')
    } catch (e) {
      console.error('[isl-terminal] pty spawn error:', e.message)
      try { ws.send(`\r\n\x1b[31m[Terminal error: ${e.message}]\x1b[0m\r\n`) } catch {}
      ws.close()
      return
    }

    // Keep-alive ping every 20s to prevent proxy timeouts
    const pingInterval = setInterval(() => {
      if (ws.readyState === 1) { try { ws.ping() } catch {} }
      else clearInterval(pingInterval)
    }, 20000)

    proc.onData(d => { try { if (ws.readyState === 1) ws.send(d) } catch {} })

    ws.on('message', raw => {
      try {
        const msg = raw.toString()
        let json
        try { json = JSON.parse(msg) } catch {}
        if (json?.type === 'resize') {
          const cols = Math.max(1, json.cols | 0)
          const rows = Math.max(1, json.rows | 0)
          console.log('[isl-terminal] resize', cols, 'x', rows)
          proc.resize(cols, rows)
        } else {
          proc.write(msg)
        }
      } catch (e) { console.error('[isl-terminal] message error:', e.message) }
    })

    ws.on('close', (code, reason) => {
      clearInterval(pingInterval)
      console.log('[isl-terminal] WS closed code:', code, 'reason:', reason.toString())
      try { proc.kill() } catch {}
    })
    ws.on('error', (e) => console.error('[isl-terminal] WS error:', e.message))

    proc.onExit((e) => {
      console.log('[isl-terminal] pty exited:', JSON.stringify(e))
      clearInterval(pingInterval)
      try { ws.close() } catch {}
    })
  })

  console.log('[isl-terminal] WebSocket terminal ready on /terminal')
}

// Boot Next.js standalone server (it will use the patched http.createServer above)
require('./server.js')
