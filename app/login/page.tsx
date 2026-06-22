'use client'

import { useState } from 'react'

export default function LoginPage() {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(''); setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok && d.ok) {
        window.location.href = '/'
      } else {
        setErr(d.error ?? 'PIN salah')
      }
    } catch {
      setErr('Koneksi error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#0f1117' }}>
      <form onSubmit={submit}
        className="w-full max-w-xs bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 space-y-4">
        <div className="text-center">
          <div className="w-12 h-12 rounded-xl mx-auto flex items-center justify-center text-white text-xl"
            style={{ background: 'linear-gradient(135deg, #1d3a5c, #2a5298)' }}>🔒</div>
          <h1 className="text-sm font-bold text-gray-800 dark:text-gray-100 mt-3">Integrity Sprint Log</h1>
          <p className="text-[11px] text-gray-400 mt-0.5">Masukkan PIN untuk masuk</p>
        </div>
        <input
          type="password" inputMode="numeric" autoFocus value={pin}
          onChange={e => setPin(e.target.value)}
          placeholder="PIN"
          className="w-full text-center tracking-widest text-lg rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2.5 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {err && <p className="text-[11px] text-red-500 text-center">{err}</p>}
        <button type="submit" disabled={loading || !pin}
          className="w-full py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-40 transition"
          style={{ background: 'linear-gradient(135deg, #1d3a5c, #2a5298)' }}>
          {loading ? 'Memeriksa…' : 'Masuk'}
        </button>
      </form>
    </div>
  )
}
