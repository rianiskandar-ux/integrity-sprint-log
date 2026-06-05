'use client'

import { useState } from 'react'

interface Props { onClose: () => void }

const STEPS = [
  {
    icon: '👤',
    title: 'Setup Profil Kamu',
    desc: 'Buka Settings (⚙️ di kanan atas atau tekan ",") → tab Profile. Pilih nama kamu, set Accountable default, dan pilih project OP utama yang kamu kerjakan.',
    tip: 'Setiap anggota tim punya settingnya sendiri — tersimpan di browser lokal, tidak shared.',
  },
  {
    icon: '🔗',
    title: 'Sync OpenProject Cache',
    desc: 'Masih di Settings → tab Integrations. Klik "Sync Now" untuk ambil data task dan user story dari OP. Cache ini dipakai saat Add Session biar tidak perlu ketik manual.',
    tip: 'Cache otomatis refresh setiap hari jam 09:30. Kalau ada task baru, klik Sync Now.',
  },
  {
    icon: '📝',
    title: 'Tambah Session Kerja',
    desc: 'Klik "+ Session" (atau Ctrl+N). Isi title pekerjaan, waktu, dan bullets (detail apa yang dilakukan). Pilih OP mode: Skip / Link existing task / Create new task.',
    tip: 'Judul otomatis di-suggest ke task OP yang relevan. Bullets = progress detail di OP.',
  },
  {
    icon: '🔗',
    title: 'Link ke OpenProject',
    desc: 'Di Add Session, pilih mode "Link existing" → cari task → pilih → Save. Waktu kerjamu otomatis di-log ke task tersebut di OP sebagai Time Entry.',
    tip: 'Pilih "Create new" kalau task belum ada di OP — otomatis buat User Story + Task sekaligus.',
  },
  {
    icon: '🏃',
    title: 'Lihat Sprint Progress',
    desc: 'Klik SPRINT di sidebar. Pilih sprint yang ingin dilihat. Semua session dikelompokkan per project. Sprint Review akan muncul H-1 sebelum meeting.',
    tip: 'Connect Google Calendar di Settings → Integrations untuk lihat jadwal Sprint Review otomatis.',
  },
  {
    icon: '✅',
    title: 'Wrapup Harian',
    desc: 'Klik "Wrapup" di header → otomatis copy command ke clipboard → paste di Claude Code di terminal. Claude akan generate daily summary dari semua session hari ini.',
    tip: 'Lakukan ini setiap hari ~17:30 sebelum tutup kerja.',
  },
  {
    icon: '📊',
    title: 'Pull OP (Opsional)',
    desc: 'Klik "Pull OP" untuk tarik data task & activity terbaru dari OpenProject ke halaman daily. Berguna kalau ada update dari rekan tim yang belum keliatan.',
    tip: 'Pull OP otomatis jalan setiap kamu buka halaman hari ini.',
  },
]

const SHORTCUTS = [
  { key: 'D', desc: 'Ke Daily view' },
  { key: 'S', desc: 'Ke Sprint view' },
  { key: 'M', desc: 'Ke Month view' },
  { key: 'L', desc: 'Ke Skills view' },
  { key: '← / K', desc: 'Hari sebelumnya' },
  { key: '→ / J', desc: 'Hari berikutnya' },
  { key: 'T', desc: 'Ke hari ini' },
  { key: '⌘K', desc: 'Search session' },
  { key: '⌘N', desc: 'Add session' },
  { key: ',', desc: 'Buka Settings' },
  { key: 'Esc', desc: 'Tutup modal' },
]

export default function HelpModal({ onClose }: Props) {
  const [tab, setTab] = useState<'guide' | 'shortcuts'>('guide')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 dark:bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <span className="text-lg">📖</span>
            <div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Panduan Pemakaian</h3>
              <p className="text-[11px] text-gray-400">Integrity Sprint Log — Step by step</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition text-sm">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 pt-3">
          {[['guide', '🗺️ Panduan'], ['shortcuts', '⌨️ Shortcuts']] .map(([id, label]) => (
            <button key={id} onClick={() => setTab(id as 'guide' | 'shortcuts')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${tab === id ? 'bg-indigo-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
          {tab === 'guide' && (
            <div className="space-y-3">
              {STEPS.map((s, i) => (
                <div key={i} className="flex gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-sm">
                    {s.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-bold text-indigo-500 dark:text-indigo-400 uppercase tracking-wide">Langkah {i + 1}</span>
                    </div>
                    <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 mb-1">{s.title}</p>
                    <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">{s.desc}</p>
                    <p className="mt-1.5 text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 px-2 py-1 rounded-md">💡 {s.tip}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'shortcuts' && (
            <div className="grid grid-cols-2 gap-2">
              {SHORTCUTS.map((s) => (
                <div key={s.key} className="flex items-center gap-3 p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800">
                  <kbd className="px-2 py-1 text-[10px] font-bold bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-gray-700 dark:text-gray-200 font-mono shadow-sm min-w-[40px] text-center">
                    {s.key}
                  </kbd>
                  <span className="text-xs text-gray-600 dark:text-gray-400">{s.desc}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 flex items-center justify-between">
          <p className="text-[10px] text-gray-400">Tekan <kbd className="px-1 py-0.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-[10px] font-mono">?</kbd> kapanpun untuk buka panduan ini</p>
          <button onClick={onClose} className="px-4 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition">Mengerti</button>
        </div>
      </div>
    </div>
  )
}
