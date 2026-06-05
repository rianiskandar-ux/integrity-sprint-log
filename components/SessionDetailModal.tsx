'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Session } from '@/lib/parser'
import type { Project } from '@/lib/projects'

interface Props {
  session: Session & { date?: string }
  project: Project
  onClose: () => void
}

export default function SessionDetailModal({ session, project, onClose }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(session.title)
  const [bullets, setBullets] = useState<string[]>([...session.bullets, ''])
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function updateBullet(i: number, val: string) {
    setBullets(prev => {
      const next = [...prev]
      next[i] = val
      if (i === next.length - 1 && val.length > 0) next.push('')
      return next
    })
  }

  async function handleSave() {
    if (!title.trim()) { setError('Title wajib diisi'); return }
    setSaving(true)
    setError(null)
    const res = await fetch('/api/sessions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: session.date,
        oldTitle: session.title,
        newTitle: title.trim(),
        time: session.time,
        bullets: bullets.filter(Boolean),
      }),
    })
    const d = await res.json()
    if (!d.ok) { setError(d.error ?? 'Gagal menyimpan'); setSaving(false); return }
    router.refresh()
    onClose()
  }

  async function handleDelete() {
    setSaving(true)
    const res = await fetch('/api/sessions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: session.date, title: session.title }),
    })
    const d = await res.json()
    if (!d.ok) { setError(d.error ?? 'Gagal hapus'); setSaving(false); return }
    router.refresh()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 dark:bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-lg flex-shrink-0" style={{ background: project.color }}>
            {project.icon}
          </div>
          <div className="flex-1 min-w-0">
            {editing
              ? <input value={title} onChange={e => setTitle(e.target.value)} autoFocus
                  className="w-full text-sm font-bold px-2 py-1 rounded-lg border border-indigo-300 dark:border-indigo-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-indigo-400" />
              : <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 leading-snug">{session.title}</h3>
            }
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full text-white" style={{ background: project.color }}>{project.name}</span>
              {session.time && <span className="text-[11px] text-gray-400">{session.time}</span>}
              {session.date && <span className="text-[11px] text-gray-400">· {session.date}</span>}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => { setEditing(e => !e); setConfirmDelete(false) }}
              className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition text-xs font-semibold"
              title={editing ? 'Cancel edit' : 'Edit'}>
              {editing ? '✕' : '✏️'}
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition text-sm">✕</button>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 max-h-96 overflow-y-auto">
          {editing ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">Bullets</p>
              {bullets.map((b, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-gray-300 dark:text-gray-600 text-xs">–</span>
                  <input value={b} onChange={e => updateBullet(i, e.target.value)}
                    placeholder={`Bullet ${i + 1}`}
                    className="flex-1 text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-indigo-400 placeholder-gray-400" />
                </div>
              ))}
            </div>
          ) : (
            session.bullets.length === 0
              ? <p className="text-sm text-gray-400 italic">Tidak ada detail.</p>
              : <ul className="space-y-2.5">
                  {session.bullets.map((b, i) => (
                    <li key={i} className="flex items-start gap-2.5">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                      <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{b}</p>
                    </li>
                  ))}
                </ul>
          )}
          {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          {editing ? (
            <>
              <div>
                {!confirmDelete
                  ? <button onClick={() => setConfirmDelete(true)} disabled={saving}
                      className="text-xs text-red-500 hover:text-red-600 font-semibold">🗑 Hapus session</button>
                  : <div className="flex items-center gap-2">
                      <span className="text-xs text-red-600 font-semibold">Yakin hapus?</span>
                      <button onClick={handleDelete} disabled={saving} className="text-xs bg-red-500 text-white px-2 py-1 rounded-lg font-semibold hover:bg-red-600 transition">Ya, hapus</button>
                      <button onClick={() => setConfirmDelete(false)} className="text-xs text-gray-500 hover:text-gray-700">Batal</button>
                    </div>
                }
              </div>
              <button onClick={handleSave} disabled={saving}
                className="px-4 py-2 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition">
                {saving ? 'Menyimpan…' : 'Simpan'}
              </button>
            </>
          ) : (
            <p className="text-[10px] text-gray-400">{session.bullets.length} deliverables recorded</p>
          )}
        </div>
      </div>
    </div>
  )
}
