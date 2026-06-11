'use client'

import { useEffect, useState } from 'react'

interface LiveStatus {
  opStatus: 'ok' | 'error' | 'unconfigured' | 'checking'
  opProject: string
  googleConnected: boolean
  googleName: string
  sessionCount: number
  sprintName: string
  modeLabel: string
  pendingValidation: number
}

function Tree({ lines }: { lines: string[] }) {
  return (
    <pre className="text-[11px] leading-[1.65] text-gray-700 dark:text-gray-300 font-mono whitespace-pre overflow-x-auto">
      {lines.join('\n')}
    </pre>
  )
}

function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="flex items-center gap-2 mt-6 mb-2 pb-1 border-b border-gray-200 dark:border-gray-700">
      <span className="text-base">{icon}</span>
      <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{title}</span>
    </div>
  )
}

function StatusPill({ ok, label }: { ok: boolean | null; label: string }) {
  const color = ok === null
    ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
    : ok
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300'
    : 'bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-300'
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${ok === null ? 'bg-yellow-400 animate-pulse' : ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
      {label}
    </span>
  )
}

export default function FlowModal({ onClose }: { onClose: () => void }) {
  const [live, setLive] = useState<LiveStatus>({
    opStatus: 'checking',
    opProject: '…',
    googleConnected: false,
    googleName: '…',
    sessionCount: 0,
    sprintName: '…',
    modeLabel: '…',
    pendingValidation: 0,
  })

  useEffect(() => {
    async function load() {
      const [statusRes, profileRes, sessionsRes, modeRes] = await Promise.allSettled([
        fetch('/api/status').then(r => r.json()),
        fetch('/api/auth/profile').then(r => r.json()),
        fetch('/api/isl/sessions').then(r => r.json()),
        fetch('/api/op/mode').then(r => r.json()),
      ])

      const status   = statusRes.status   === 'fulfilled' ? statusRes.value   : {}
      const profile  = profileRes.status  === 'fulfilled' ? profileRes.value  : {}
      const sessions = sessionsRes.status === 'fulfilled' ? sessionsRes.value : {}
      const mode     = modeRes.status     === 'fulfilled' ? modeRes.value     : {}

      const allSessions: any[] = sessions.sessions ?? []
      const pendingVal = allSessions.filter(s => s.needsValidation && s.pushStatus === 'pushed').length

      setLive({
        opStatus:         status.op?.status ?? 'error',
        opProject:        status.op?.project ?? '—',
        googleConnected:  !!profile.profile?.email,
        googleName:       profile.profile?.name ?? '—',
        sessionCount:     sessions.total ?? 0,
        sprintName:       mode.sprint?.name ?? `Sprint ${mode.sprint?.id ?? '—'}`,
        modeLabel:        mode.mode === 'live' ? '🟢 LIVE' : '🟡 TEST',
        pendingValidation: pendingVal,
      })
    }
    load()
    const interval = setInterval(load, 30000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-xl">🗺️</span>
            <div>
              <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">ISL Flow — 4 Sisi</h2>
              <p className="text-[11px] text-gray-400 mt-0.5">Cara kerja sistem end-to-end</p>
            </div>
          </div>
          {/* Live status pills */}
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <StatusPill ok={live.opStatus === 'ok'} label={`OP ${live.opStatus === 'checking' ? '…' : live.opStatus}`} />
            <StatusPill ok={live.googleConnected} label={live.googleConnected ? live.googleName.split(' ')[0] : 'Google ✗'} />
            <StatusPill ok={null} label={live.modeLabel} />
            {live.pendingValidation > 0 && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                ⚠️ {live.pendingValidation} perlu validasi
              </span>
            )}
          </div>
          <button onClick={onClose} className="ml-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none flex-shrink-0">×</button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-1">

          {/* Live summary bar */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
              <div className="text-lg font-bold text-gray-800 dark:text-gray-100">{live.sessionCount}</div>
              <div className="text-[10px] text-gray-400">sessions logged</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
              <div className="text-sm font-bold text-gray-800 dark:text-gray-100 truncate">{live.opProject}</div>
              <div className="text-[10px] text-gray-400">OP project</div>
            </div>
            <div className={`rounded-lg p-3 text-center ${live.pendingValidation > 0 ? 'bg-amber-50 dark:bg-amber-950' : 'bg-gray-50 dark:bg-gray-800'}`}>
              <div className={`text-lg font-bold ${live.pendingValidation > 0 ? 'text-amber-600 dark:text-amber-300' : 'text-emerald-600 dark:text-emerald-300'}`}>
                {live.pendingValidation > 0 ? live.pendingValidation : '✓'}
              </div>
              <div className="text-[10px] text-gray-400">{live.pendingValidation > 0 ? 'butuh validasi' : 'semua tervalidasi'}</div>
            </div>
          </div>

          {/* Section: User */}
          <SectionHeader icon="🧑" title="Sisi Kamu (User)" />
          <Tree lines={[
            'MULAI KERJA',
            '│',
            '├─ Buka Claude Code (chat baru)',
            '│   ├─ Ada task lanjutan?  → ketik: !ticket:7XXX  di pesan pertama',
            '│   └─ Task baru?         → langsung ngobrol aja',
            '│',
            '├─ Kerja... (ngobrol, coding, debug, deploy)',
            '│',
            '├─ Mau kasih status?  → ketik di pesan manapun:',
            '│   !done       — selesai tuntas',
            '│   !hold       — ada blocker',
            '│   !wip        — lanjut besok',
            '│   !abandon    — cancel, skip OP',
            '│   !intermezzo — bukan kerja, jangan dicatat',
            '│',
            '└─ Tutup chat / Claude selesai respond terakhir',
            '    → OTOMATIS diproses hook (kamu tidak perlu lakukan apapun)',
            '',
            'SETELAH KERJA',
            '│',
            '├─ Buka ISL → Auto Log tab',
            '│   ├─ Lihat entry baru masuk',
            '│   ├─ Status AI perlu validasi? → klik ✅ Done / ⏸ Hold / ▶ Continue',
            '│   ├─ Task WIP mau dilanjut?   → klik ▶ Continue → copy !ticket:ID → paste di chat baru',
            '│   └─ Entry salah?              → klik ↩ Backlog (OP dipindah ke [REVIEW])',
            '│',
            '└─ Cek OP jika perlu (opsional)',
            '    → Task sudah ada, activity sudah tercatat, time log sudah masuk',
          ]} />

          {/* Section: Hook */}
          <SectionHeader icon="🤖" title="Sisi Claude Code (Hook)" />
          <Tree lines={[
            'EVENT: Claude session selesai (Stop hook)',
            '│',
            '├─ Baca transcript JSONL dari ~/.claude/projects/...',
            '│',
            '├─ Guard checks:',
            '│   ├─ < 3 pesan?            → EXIT (bukan sesi kerja)',
            '│   ├─ < 2 menit?            → EXIT (terlalu singkat)',
            '│   ├─ !intermezzo detected? → EXIT (user minta skip)',
            '│   └─ sessionId sudah di processed-sessions.json? → EXIT (anti double-log)',
            '│',
            '├─ Detect commands (!done, !hold, !wip, !abandon, !ticket:ID)',
            '│',
            '├─ Kirim ke Anthropic API (claude-haiku) untuk:',
            '│   ├─ Generate title: "[Project] Verb + Object"',
            '│   ├─ Generate bullets: 4-10 langkah teknis spesifik',
            '│   ├─ Determine isSubstantial (skip jika hanya Q&A)',
            '│   └─ Determine taskStatus (conservative default: in_progress)',
            '│',
            '├─ Cari task di OP:',
            '│   ├─ !ticket:ID ada?   → fetch task itu langsung dari OP',
            '│   ├─ Tidak ada ticket? → fuzzy match ke myOpenTasks + myClosedTasks',
            '│   └─ Tidak ada match?  → isNewTask = true, cek related old task',
            '│',
            '├─ Ke OP API:',
            '│   ├─ Existing task → POST activity ke work_packages/{id}/activities',
            '│   ├─ New task      → POST /api/v3/work_packages (status: In Progress)',
            '│   │   ├─ Estimasi: easy=60m / medium=120m / complex=240m',
            '│   │   └─ Sprint cap check: total sprint < 60h, kalau >= skip create',
            '│   └─ Time entry   → POST /api/v3/time_entries',
            '│',
            '├─ Tulis memory file:',
            '│   └─ memory/Epic-{id}-{slug}/Story-{id}-{slug}/Task-{id}-{slug}.md',
            '│',
            '├─ POST ke ISL /api/isl/sessions',
            '│   └─ Simpan ke session-logs/{date}_{sid8}.json',
            '│',
            '├─ Kirim email notifikasi (jika needsValidation = true)',
            '│',
            '└─ Tulis sessionId ke processed-sessions.json → selesai',
          ]} />

          {/* Section: ISL */}
          <SectionHeader icon="🖥️" title="Sisi ISL (Web App localhost:3000)" />
          <Tree lines={[
            'AUTO LOG VIEW  (/api/isl/sessions)',
            '│',
            `├─ ${live.sessionCount} sessions dari session-logs/*.json`,
            '├─ Filter: All | Pushed | Backlogged | Abandoned',
            '│',
            '├─ Tiap entry card:',
            '│   ├─ Badge: story/area (ISL / KYV / Verif / Phoenix)',
            '│   ├─ Status badge: 🔵 In Progress / ✅ Done / ⏸ On Hold / 🚫 Abandoned',
            '│   ├─ ⚠️ Validasi status AI → user belum confirm command',
            '│   ├─ Link #OPID → buka OP task di browser',
            '│   ├─ Bullets (3 terlihat, sisanya collapsed)',
            '│   ├─ 🔗 Related old task panel (jika AI detect task lama)',
            '│   ├─ Meta: durasi aktual, tanggal, token usage, ticket binding',
            '│   │',
            '│   └─ Action buttons:',
            '│       ▶ Continue → copy !ticket:ID ke clipboard (WIP/Hold only)',
            '│       ✅ Done    → PATCH session + POST OP status sync',
            '│       ⏸ Hold    → PATCH session + POST OP status sync',
            '│       🚫 Abandon → PATCH session (ISL only, OP tidak berubah)',
            '│       ✨ Improve → AI improve title+bullets → PATCH session',
            '│       ↩ Backlog → DELETE session (OP task → [REVIEW] + sprint null)',
            '│',
            '├─ Manual Input Form (untuk non-Claude AI):',
            '│   └─ POST /api/isl/sessions → tersimpan, bisa review + push ke OP',
            '│',
            'OTHER VIEWS:',
            '├─ Daily View  — aktivitas per hari dari sprint markdown files',
            '├─ Sprint View — progress sprint, tasks per project',
            '├─ Month View  — kalender aktivitas bulanan',
            '├─ Incoming    — task OP yang masuk tapi belum dikerjain',
            '├─ Old Tasks   — epic/story/task sprint lama (read-only reference)',
            '└─ Settings    — OP config, userId, watched projects',
          ]} />

          {/* Section: OP */}
          <SectionHeader icon="🗃️" title="Sisi OpenProject (OP)" />
          <Tree lines={[
            `OP: ${live.opStatus === 'ok' ? '✅ Connected' : live.opStatus === 'checking' ? '⏳ Checking...' : '❌ ' + live.opStatus}`,
            `Project: ${live.opProject}`,
            '',
            'YANG OTOMATIS DIBUAT/DIUPDATE OLEH ISL:',
            '',
            'Task baru (jika tidak ada match):',
            '├─ Subject: title dari AI',
            '├─ Description: scope 3 bullets + "Created by ISL"',
            '├─ Status: In Progress (#7)',
            '├─ Assignee: kamu (userId dari OP /users/me)',
            '├─ Parent: User Story sesuai (berdasarkan keyword match)',
            '├─ Version: sprint aktif',
            '└─ Estimated time: 60 / 120 / 240 menit (KPI-aware)',
            '',
            'Activity/comment (setiap session):',
            '└─ Markdown: tanggal, durasi, status, bullets, token usage',
            '',
            'Time entry:',
            '└─ Waktu aktual dari transcript timestamp, linked ke task',
            '',
            'YANG TIDAK OTOMATIS (kamu validasi via ISL):',
            '├─ Status CLOSED  → klik ✅ Done di ISL → sync ke OP Closed',
            '├─ Status ON HOLD → klik ⏸ Hold di ISL → sync ke OP On Hold',
            '├─ Status REJECTED → tidak pernah otomatis (abandon = ISL-only)',
            '└─ Delete task → tidak bisa via API (403), manual di OP',
          ]} />

          {/* Section: Storage */}
          <SectionHeader icon="📁" title="Storage Lokal" />
          <Tree lines={[
            'daily-sprint-next/',
            '├─ session-logs/         ← satu .json per sesi Claude',
            `│   └─ ${live.sessionCount} files`,
            '│',
            '├─ memory/               ← notes per task, terpisah per epic/story',
            '│   └─ Epic-{id}-{slug}/',
            '│       └─ Story-{id}-{slug}/',
            '│           └─ Task-{id}-{slug}.md',
            '│',
            '├─ op-cache.json         ← snapshot OP (epics, stories, tasks, sprints)',
            '├─ processed-sessions.json ← anti double-log tracker',
            '└─ op-mode.json          ← config: test/live, userId, projectId',
          ]} />

          <div className="text-[10px] text-gray-300 dark:text-gray-600 text-center pt-4 pb-2">
            Auto-refresh setiap 30 detik · Terakhir update: {new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
        </div>
      </div>
    </div>
  )
}
