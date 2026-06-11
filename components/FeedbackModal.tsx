'use client'

import { useState } from 'react'

const BRAND = '#1d3a5c'

const CATEGORIES = ['Bug / Error', 'Fitur baru', 'Tampilan / UI', 'Performance', 'Lainnya']

interface Props { onClose: () => void }

export default function FeedbackModal({ onClose }: Props) {
  const [name,     setName]     = useState('')
  const [role,     setRole]     = useState('')
  const [category, setCategory] = useState('Lainnya')
  const [rating,   setRating]   = useState(0)
  const [hovered,  setHovered]  = useState(0)
  const [message,  setMessage]  = useState('')
  const [sending,  setSending]  = useState(false)
  const [sent,     setSent]     = useState(false)
  const [error,    setError]    = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!message.trim()) return
    setSending(true); setError('')
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, role, category, rating: rating || undefined, message }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError((d as { error?: string }).error ?? 'Gagal mengirim')
      } else {
        setSent(true)
      }
    } catch {
      setError('Connection error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-xl"
            style={{ background: BRAND + '15' }}>
            💬
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-black text-gray-900 dark:text-gray-100">Give Feedback</h2>
            <p className="text-[10px] text-gray-400">Bantu improve ISL untuk tim</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition">✕</button>
        </div>

        {sent ? (
          <div className="px-5 py-10 text-center space-y-3">
            <div className="text-4xl">🎉</div>
            <p className="text-sm font-bold text-gray-800 dark:text-gray-100">Terima kasih!</p>
            <p className="text-xs text-gray-400">Feedback kamu sudah diterima dan akan dipertimbangkan.</p>
            <button onClick={onClose}
              className="mt-4 px-6 py-2 rounded-xl text-sm font-bold text-white"
              style={{ background: BRAND }}>
              Tutup
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="px-5 py-4 space-y-4">

            {/* Name + Role */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Nama</label>
                <input value={name} onChange={e => setName(e.target.value)}
                  placeholder="Rian"
                  className="mt-1 w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Role</label>
                <input value={role} onChange={e => setRole(e.target.value)}
                  placeholder="Developer"
                  className="mt-1 w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
            </div>

            {/* Category */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Kategori</label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {CATEGORIES.map(c => (
                  <button key={c} type="button" onClick={() => setCategory(c)}
                    className="px-3 py-1 rounded-full text-[10px] font-bold border transition"
                    style={category === c
                      ? { background: BRAND, color: 'white', borderColor: BRAND }
                      : { background: 'transparent', color: '#6b7280', borderColor: '#e5e7eb' }}>
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {/* Rating */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Rating ISL</label>
              <div className="mt-1.5 flex gap-1">
                {[1,2,3,4,5].map(s => (
                  <button key={s} type="button"
                    onClick={() => setRating(s)}
                    onMouseEnter={() => setHovered(s)}
                    onMouseLeave={() => setHovered(0)}
                    className="text-2xl transition hover:scale-110">
                    {s <= (hovered || rating) ? '★' : '☆'}
                  </button>
                ))}
                {rating > 0 && (
                  <button type="button" onClick={() => setRating(0)}
                    className="text-[10px] text-gray-400 ml-1 hover:text-gray-600">reset</button>
                )}
              </div>
            </div>

            {/* Message */}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                Feedback <span className="text-red-400">*</span>
              </label>
              <textarea value={message} onChange={e => setMessage(e.target.value)}
                placeholder="Ceritakan pengalamanmu, masalah yang ditemui, atau fitur yang diinginkan…"
                rows={4}
                required
                className="mt-1 w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none" />
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}

            <button type="submit" disabled={sending || !message.trim()}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white transition disabled:opacity-40"
              style={{ background: BRAND }}>
              {sending ? 'Mengirim…' : '📨 Kirim Feedback'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
