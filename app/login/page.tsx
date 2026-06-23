'use client'

import { useState, useEffect } from 'react'

export default function LoginPage() {
  const [multiUser, setMultiUser] = useState<boolean | null>(null)
  const [pin, setPin] = useState('')
  const [opToken, setOpToken] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => setMultiUser(!!d.multiUser)).catch(() => setMultiUser(false))
  }, [])

  async function submitPin(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setLoading(true)
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) })
      const d = await res.json().catch(() => ({}))
      if (res.ok && d.ok) window.location.href = '/'
      else setErr(d.error ?? 'PIN salah')
    } catch { setErr('Koneksi error') } finally { setLoading(false) }
  }

  async function submitOp(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setLoading(true)
    try {
      const res = await fetch('/api/auth/op-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ opToken }) })
      const d = await res.json().catch(() => ({}))
      if (res.ok && d.ok) window.location.href = '/'
      else setErr(d.error ?? 'Login gagal')
    } catch { setErr('Koneksi error') } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#0f1117' }}>
      <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 space-y-4">
        <div className="text-center">
          <div className="w-12 h-12 rounded-xl mx-auto flex items-center justify-center text-white text-xl"
            style={{ background: 'linear-gradient(135deg, #1d3a5c, #2a5298)' }}>🔒</div>
          <h1 className="text-sm font-bold text-gray-800 dark:text-gray-100 mt-3">Integrity Sprint Log</h1>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {multiUser ? 'Login pakai OP API Token kamu' : 'Masukkan PIN untuk masuk'}
          </p>
        </div>

        {multiUser === null ? (
          <p className="text-center text-xs text-gray-400 py-4">Loading…</p>
        ) : multiUser ? (
          <form onSubmit={submitOp} className="space-y-3">
            <input type="password" autoFocus value={opToken} onChange={e => setOpToken(e.target.value)}
              placeholder="OP API Token"
              className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <p className="text-[10px] text-gray-400 leading-relaxed">
              Ambil token: OpenProject → My account → Access tokens → API. Token disimpan terenkripsi & jadi identitasmu.
            </p>
            {err && <p className="text-[11px] text-red-500 text-center">{err}</p>}
            <button type="submit" disabled={loading || !opToken}
              className="w-full py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #1d3a5c, #2a5298)' }}>
              {loading ? 'Memeriksa…' : 'Masuk'}
            </button>
          </form>
        ) : (
          <form onSubmit={submitPin} className="space-y-3">
            <input type="password" inputMode="numeric" autoFocus value={pin} onChange={e => setPin(e.target.value)}
              placeholder="PIN"
              className="w-full text-center tracking-widest text-lg rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2.5 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            {err && <p className="text-[11px] text-red-500 text-center">{err}</p>}
            <button type="submit" disabled={loading || !pin}
              className="w-full py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #1d3a5c, #2a5298)' }}>
              {loading ? 'Memeriksa…' : 'Masuk'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
