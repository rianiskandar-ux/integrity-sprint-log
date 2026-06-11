'use client'

import { useState } from 'react'
import { useI18n } from '@/lib/i18n'

interface Props { onClose: () => void }

export default function HelpModal({ onClose }: Props) {
  const { t, lang } = useI18n()
  const [tab, setTab] = useState<'guide' | 'shortcuts' | 'commands'>('guide')

  const STEPS = lang === 'id' ? [
    {
      icon: '👤',
      title: 'Setup Profil Kamu',
      desc: 'Buka Pengaturan (⚙️ di kanan atas atau tekan ",") → tab Profil. Pilih nama kamu, set Accountable default, dan pilih project OP utama yang kamu kerjakan.',
      tip: 'Setiap anggota tim punya pengaturannya sendiri — tersimpan di browser lokal, tidak shared.',
    },
    {
      icon: '🔗',
      title: 'Sync Data OpenProject',
      desc: 'Masih di Pengaturan → tab Integrasi. Klik "Sync Now" untuk ambil data task dan user story dari OP. Data ini dipakai saat Tambah Aktivitas biar tidak perlu ketik manual.',
      tip: 'Data otomatis refresh setiap hari jam 09:30. Kalau ada task baru dari OP, klik Sync Now.',
    },
    {
      icon: '🤖',
      title: 'Auto Catat (Otomatis dari Claude)',
      desc: 'Setiap selesai chat di Claude Code, hook otomatis kirim ringkasan pekerjaan ke ISL. Indikator "Auto Catat" di header akan menyala (ungu) saat ada aktivitas yang siap dikirim ke OP.',
      tip: 'Kalau indikator berubah kuning (idle 15+ menit), segera klik untuk review dan kirim ke OP sebelum terlupa.',
    },
    {
      icon: '📝',
      title: 'Tambah Aktivitas Manual',
      desc: 'Klik "+ Aktivitas" (atau Ctrl+N). Isi judul pekerjaan, waktu, dan detail kegiatan (apa yang dilakukan). Pilih mode OP: Skip / Tautkan ke task / Buat task baru.',
      tip: 'Judul otomatis di-suggest ke task OP yang relevan. Detail kegiatan = catatan progress di OP.',
    },
    {
      icon: '🔗',
      title: 'Kaitkan ke OpenProject',
      desc: 'Di Tambah Aktivitas, pilih mode "Tautkan ke task" → cari task → pilih → Simpan. Waktu kerjamu otomatis di-log ke task tersebut di OP sebagai Time Entry.',
      tip: 'Pilih "Buat task baru" kalau task belum ada di OP — otomatis buat User Story + Task sekaligus.',
    },
    {
      icon: '🏃',
      title: 'Lihat Progress Sprint',
      desc: 'Klik SPRINT di sidebar. Pilih sprint yang ingin dilihat. Semua aktivitas dikelompokkan per project. Jadwal Sprint Review akan muncul H-1 sebelum meeting.',
      tip: 'Hubungkan Google Calendar di Pengaturan → Integrasi untuk lihat jadwal Sprint Review otomatis.',
    },
    {
      icon: '✅',
      title: 'Ringkasan Harian',
      desc: 'Klik "Ringkasan" di header. ISL akan generate summary harian dari semua aktivitas hari ini menggunakan AI. Edit jika perlu, lalu Copy untuk dibagikan ke tim.',
      tip: 'Lakukan ini setiap hari ~17:30 sebelum tutup kerja. Butuh ANTHROPIC_API_KEY di .env.local.',
    },
    {
      icon: '🔄',
      title: 'Refresh Data OP (Opsional)',
      desc: 'Klik "Refresh Data" untuk tarik data task & aktivitas terbaru dari OpenProject ke halaman harian. Berguna kalau ada update dari rekan tim yang belum kelihatan.',
      tip: 'Refresh Data otomatis jalan setiap kamu buka halaman hari ini.',
    },
  ] : [
    {
      icon: '👤',
      title: 'Set Up Your Profile',
      desc: 'Open Settings (⚙️ top right or press ",") → Profile tab. Choose your name, set a default Accountable, and select the main OP project you work on.',
      tip: 'Each team member has their own settings — saved locally in the browser, not shared.',
    },
    {
      icon: '🔗',
      title: 'Sync OpenProject Data',
      desc: 'In Settings → Integrations tab. Click "Sync Now" to pull task and user story data from OP. This data is used when adding activities so you don\'t need to type manually.',
      tip: 'Data auto-refreshes daily at 09:30. If there are new tasks in OP, click Sync Now.',
    },
    {
      icon: '🤖',
      title: 'Auto Record (from Claude)',
      desc: 'Every time you finish a chat in Claude Code, the hook automatically sends a work summary to ISL. The "Auto Record" indicator in the header lights up (purple) when an activity is ready to send to OP.',
      tip: 'If the indicator turns yellow (idle 15+ minutes), click it to review and send to OP before you forget.',
    },
    {
      icon: '📝',
      title: 'Add Activity Manually',
      desc: 'Click "+ Activity" (or Ctrl+N). Fill in the work title, time, and activity details (what was done). Choose OP mode: Skip / Link to task / Create new task.',
      tip: 'The title is automatically suggested to the relevant OP task. Activity details = progress notes in OP.',
    },
    {
      icon: '🔗',
      title: 'Link to OpenProject',
      desc: 'In Add Activity, choose "Link to task" → search task → select → Save. Your work time is automatically logged to that task in OP as a Time Entry.',
      tip: 'Choose "Create new task" if the task doesn\'t exist in OP yet — automatically creates a User Story + Task at once.',
    },
    {
      icon: '🏃',
      title: 'View Sprint Progress',
      desc: 'Click SPRINT in the sidebar. Choose the sprint to view. All activities are grouped by project. Sprint Review schedule appears 1 day before the meeting.',
      tip: 'Connect Google Calendar in Settings → Integrations to see Sprint Review schedules automatically.',
    },
    {
      icon: '✅',
      title: 'Daily Summary',
      desc: 'Click "Summary" in the header. ISL will generate a daily summary from all today\'s activities using AI. Edit if needed, then Copy to share with the team.',
      tip: 'Do this every day ~17:30 before closing work. Requires ANTHROPIC_API_KEY in .env.local.',
    },
    {
      icon: '🔄',
      title: 'Refresh OP Data (Optional)',
      desc: 'Click "Refresh Data" to pull the latest tasks & activities from OpenProject to the daily view. Useful if there are updates from teammates not yet visible.',
      tip: 'Refresh Data runs automatically every time you open today\'s page.',
    },
  ]

  const SHORTCUTS = lang === 'id' ? [
    { key: 'D', desc: 'Ke tampilan Harian' },
    { key: 'S', desc: 'Ke tampilan Sprint' },
    { key: 'M', desc: 'Ke tampilan Bulan' },
    { key: 'L', desc: 'Ke Rekap Topik' },
    { key: '← / K', desc: 'Hari sebelumnya' },
    { key: '→ / J', desc: 'Hari berikutnya' },
    { key: 'T', desc: 'Ke hari ini' },
    { key: '⌘K', desc: 'Cari aktivitas' },
    { key: '⌘N', desc: 'Tambah aktivitas' },
    { key: ',', desc: 'Buka Pengaturan' },
    { key: 'Esc', desc: 'Tutup popup' },
  ] : [
    { key: 'D', desc: 'Daily view' },
    { key: 'S', desc: 'Sprint view' },
    { key: 'M', desc: 'Month view' },
    { key: 'L', desc: 'Topic Recap' },
    { key: '← / K', desc: 'Previous day' },
    { key: '→ / J', desc: 'Next day' },
    { key: 'T', desc: 'Go to today' },
    { key: '⌘K', desc: 'Search activities' },
    { key: '⌘N', desc: 'Add activity' },
    { key: ',', desc: 'Open Settings' },
    { key: 'Esc', desc: 'Close popup' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 dark:bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <span className="text-lg">📖</span>
            <div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{t('help.title')}</h3>
              <p className="text-[11px] text-gray-400">{t('help.subtitle')}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition text-sm">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 pt-3">
          {([['guide', t('help.tab_guide')], ['shortcuts', t('help.tab_shortcuts')], ['commands', t('help.tab_commands')]] as [string,string][]).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id as 'guide' | 'shortcuts' | 'commands')}
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
                      <span className="text-[10px] font-bold text-indigo-500 dark:text-indigo-400 uppercase tracking-wide">{t('help.step_label')} {i + 1}</span>
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

          {tab === 'commands' && (
            <div className="space-y-4">
              <div className="p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900 rounded-xl text-[11px] text-blue-700 dark:text-blue-300">
                💡 {t('help.cmd_hint')}
              </div>

              {/* Status commands */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">{t('help.cmd_status_label')}</p>
                <div className="space-y-1.5">
                  {[
                    { cmd: '!done',    color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/40', desc: t('help.cmd_done_desc'),    op: 'OP → Closed' },
                    { cmd: '!hold',    color: 'text-amber-600 dark:text-amber-400',    bg: 'bg-amber-50 dark:bg-amber-950/40',    desc: t('help.cmd_hold_desc'),    op: 'OP → On Hold' },
                    { cmd: '!wip',     color: 'text-blue-600 dark:text-blue-400',      bg: 'bg-blue-50 dark:bg-blue-950/40',      desc: t('help.cmd_wip_desc'),     op: 'OP → In Progress' },
                    { cmd: '!backlog', color: 'text-gray-600 dark:text-gray-400',      bg: 'bg-gray-50 dark:bg-gray-800',         desc: t('help.cmd_backlog_desc'), op: t('help.cmd_backlog_op') },
                    { cmd: '!abandon', color: 'text-red-600 dark:text-red-400',        bg: 'bg-red-50 dark:bg-red-950/40',        desc: t('help.cmd_abandon_desc'), op: 'OP → Rejected' },
                  ].map(c => (
                    <div key={c.cmd} className={`flex items-center gap-3 p-2.5 rounded-lg ${c.bg}`}>
                      <code className={`text-xs font-bold font-mono ${c.color} w-20 flex-shrink-0`}>{c.cmd}</code>
                      <span className="text-xs text-gray-700 dark:text-gray-300 flex-1">{c.desc}</span>
                      <span className="text-[10px] text-gray-400 flex-shrink-0">{c.op}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Special commands */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">{t('help.cmd_session_label')}</p>
                <div className="space-y-1.5">
                  {[
                    { cmd: '!intermezzo', color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-950/40', desc: t('help.cmd_intermezzo_desc'), op: 'Skip total' },
                    { cmd: '!ticket:ID',  color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-950/40', desc: t('help.cmd_ticket_desc'),     op: 'Direct bind' },
                  ].map(c => (
                    <div key={c.cmd} className={`flex items-start gap-3 p-2.5 rounded-lg ${c.bg}`}>
                      <code className={`text-xs font-bold font-mono ${c.color} w-24 flex-shrink-0 mt-0.5`}>{c.cmd}</code>
                      <span className="text-[11px] text-gray-700 dark:text-gray-300 flex-1 leading-relaxed">{c.desc}</span>
                      <span className="text-[10px] text-gray-400 flex-shrink-0 mt-0.5">{c.op}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-[11px] text-gray-500 dark:text-gray-400">
                {t('help.cmd_no_command')}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 flex items-center justify-between">
          <p className="text-[10px] text-gray-400">
            <kbd className="px-1 py-0.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-[10px] font-mono">?</kbd>
            {' '}{t('help.hint_text')}
          </p>
          <button onClick={onClose} className="px-4 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition">{t('help.understand')}</button>
        </div>
      </div>
    </div>
  )
}
