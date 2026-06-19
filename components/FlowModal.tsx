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
              <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">ISL Flow — 4 Sides</h2>
              <p className="text-[11px] text-gray-400 mt-0.5">How the system works end-to-end</p>
            </div>
          </div>
          {/* Live status pills */}
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <StatusPill ok={live.opStatus === 'ok'} label={`OP ${live.opStatus === 'checking' ? '…' : live.opStatus}`} />
            <StatusPill ok={live.googleConnected} label={live.googleConnected ? live.googleName.split(' ')[0] : 'Google ✗'} />
            <StatusPill ok={null} label={live.modeLabel} />
            {live.pendingValidation > 0 && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                ⚠️ {live.pendingValidation} need validation
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
              <div className="text-[10px] text-gray-400">{live.pendingValidation > 0 ? 'need validation' : 'all validated'}</div>
            </div>
          </div>

          {/* Section: User */}
          <SectionHeader icon="🧑" title="Your Side (User)" />
          <Tree lines={[
            'START WORKING',
            '│',
            '├─ Open Claude Code (new chat)',
            '│   ├─ Continuing a task?  → type: !ticket:7XXX  in your first message',
            '│   └─ New task?           → just start chatting',
            '│',
            '├─ Work... (chat, code, debug, deploy)',
            '│',
            '├─ Want to set a status?  → type anywhere in the chat:',
            '│   !done       — fully completed',
            '│   !hold       — blocked',
            '│   !wip        — continuing tomorrow',
            '│   !abandon    — cancelled, skip OP',
            '│   !intermezzo — not real work, do not log',
            '│',
            '└─ Close chat / Claude finishes last response',
            '    → AUTOMATICALLY processed by hook (you do not need to do anything)',
            '',
            'AFTER WORKING',
            '│',
            '├─ Open ISL → Auto Log tab',
            '│   ├─ Check new entries',
            '│   ├─ AI status needs validation? → click ✅ Done / ⏸ Hold / ▶ Continue',
            '│   ├─ WIP task to continue?       → click ▶ Continue → copy !ticket:ID → paste in new chat',
            '│   └─ Wrong entry?                → click ↩ Backlog (OP task moved to [REVIEW])',
            '│',
            '└─ Check OP if needed (optional)',
            '    → Task exists, activity logged, time entry recorded',
          ]} />

          {/* Section: Hook */}
          <SectionHeader icon="🤖" title="Claude Code Side (Hook)" />
          <Tree lines={[
            'EVENT: Claude session ends (Stop hook)',
            '│',
            '├─ Read transcript JSONL from ~/.claude/projects/...',
            '│',
            '├─ Guard checks:',
            '│   ├─ < 3 messages?          → EXIT (not a real work session)',
            '│   ├─ < 2 minutes?           → EXIT (too short)',
            '│   ├─ !intermezzo detected?  → EXIT (user requested skip)',
            '│   └─ sessionId in processed-sessions.json? → EXIT (anti double-log)',
            '│',
            '├─ Detect commands (!done, !hold, !wip, !abandon, !ticket:ID)',
            '│',
            '├─ Send to Anthropic API (claude-haiku) to:',
            '│   ├─ Generate title: "[Project] Verb + Object"',
            '│   ├─ Generate bullets: 4-10 specific technical steps',
            '│   ├─ Determine isSubstantial (skip if Q&A only)',
            '│   └─ Determine taskStatus (conservative default: in_progress)',
            '│',
            '├─ Find task in OP:',
            '│   ├─ !ticket:ID present?  → fetch that task directly from OP',
            '│   ├─ No ticket?           → fuzzy match against myOpenTasks + myClosedTasks',
            '│   └─ No match?            → isNewTask = true, check related old task',
            '│',
            '├─ Call OP API:',
            '│   ├─ Existing task → POST activity to work_packages/{id}/activities',
            '│   ├─ New task      → POST /api/v3/work_packages (status: In Progress)',
            '│   │   ├─ Estimate: easy=60m / medium=120m / complex=240m',
            '│   │   └─ Sprint cap check: total sprint < 60h, skip create if >=',
            '│   └─ Time entry   → POST /api/v3/time_entries',
            '│',
            '├─ Write memory file:',
            '│   └─ memory/Epic-{id}-{slug}/Story-{id}-{slug}/Task-{id}-{slug}.md',
            '│',
            '├─ POST to ISL /api/isl/sessions',
            '│   └─ Saved to session-logs/{date}_{sid8}.json',
            '│',
            '├─ Send email notification (if needsValidation = true)',
            '│',
            '└─ Write sessionId to processed-sessions.json → done',
          ]} />

          {/* Section: ISL */}
          <SectionHeader icon="🖥️" title="ISL Side (Web App localhost:4891)" />
          <Tree lines={[
            'AUTO LOG VIEW  (/api/isl/sessions)',
            '│',
            `├─ ${live.sessionCount} sessions from session-logs/*.json`,
            '├─ Filter: All | Pushed | Backlog | Abandoned',
            '│',
            '├─ Each entry card:',
            '│   ├─ Badge: story/area (ISL / KYV / Verif / Phoenix)',
            '│   ├─ Status badge: 🔵 In Progress / ✅ Done / ⏸ On Hold / 🚫 Abandoned',
            '│   ├─ ⚠️ Needs validation → AI status, user has not confirmed yet',
            '│   ├─ Link #OPID → open OP task in browser',
            '│   ├─ Bullets (3 visible, rest collapsed)',
            '│   ├─ 🔗 Related old task panel (if AI detects a related past task)',
            '│   ├─ Meta: actual duration, date, token usage, ticket binding',
            '│   │',
            '│   └─ Action buttons:',
            '│       ▶ Continue → copy !ticket:ID to clipboard (WIP/Hold only)',
            '│       ✅ Done    → PATCH session + POST OP status sync',
            '│       ⏸ Hold    → PATCH session + POST OP status sync',
            '│       🚫 Abandon → PATCH session (ISL only, OP unchanged)',
            '│       ✨ Improve → AI improve title+bullets → PATCH session',
            '│       ↩ Backlog → move session to backlog (OP task → [REVIEW])',
            '│',
            '├─ Manual Input Form (for non-Claude AI work):',
            '│   └─ POST /api/isl/sessions → saved, can review + push to OP',
            '│',
            'OTHER VIEWS:',
            '├─ Daily View  — activities per day',
            '├─ Sprint View — sprint progress, tasks per project',
            '├─ Month View  — monthly activity calendar',
            '├─ Hub         — triage auto-captured sessions from Claude Code',
            '├─ Incoming    — OP tasks assigned to you, not yet worked on',
            '└─ Settings    — OP config, userId, watched projects',
          ]} />

          {/* Section: OP */}
          <SectionHeader icon="🗃️" title="OpenProject (OP) Side" />
          <Tree lines={[
            `OP: ${live.opStatus === 'ok' ? '✅ Connected' : live.opStatus === 'checking' ? '⏳ Checking...' : '❌ ' + live.opStatus}`,
            `Project: ${live.opProject}`,
            '',
            'AUTO-CREATED/UPDATED BY ISL:',
            '',
            'New task (if no match found):',
            '├─ Subject: AI-generated title',
            '├─ Description: 3 scope bullets + "Created by ISL"',
            '├─ Status: In Progress (#7)',
            '├─ Assignee: you (userId from OP /users/me)',
            '├─ Parent: matching User Story (keyword-based)',
            '├─ Version: active sprint',
            '└─ Estimated time: 60 / 120 / 240 min (KPI-aware)',
            '',
            'Activity/comment (every session):',
            '└─ Markdown: date, duration, status, bullets, token usage',
            '',
            'Time entry:',
            '└─ Actual time from transcript timestamps, linked to task',
            '',
            'NOT AUTO (you validate via ISL):',
            '├─ Status CLOSED  → click ✅ Done in ISL → syncs to OP Closed',
            '├─ Status ON HOLD → click ⏸ Hold in ISL → syncs to OP On Hold',
            '├─ Status REJECTED → never automatic (abandon = ISL-only)',
            '└─ Delete task → not possible via API (403), do it manually in OP',
          ]} />

          {/* Section: Storage */}
          <SectionHeader icon="📁" title="Local Storage" />
          <Tree lines={[
            'daily-sprint-next/',
            '├─ session-logs/         ← one .json per Claude session',
            `│   └─ ${live.sessionCount} files`,
            '│',
            '├─ memory/               ← notes per task, split by epic/story',
            '│   └─ Epic-{id}-{slug}/',
            '│       └─ Story-{id}-{slug}/',
            '│           └─ Task-{id}-{slug}.md',
            '│',
            '├─ op-cache.json         ← OP snapshot (epics, stories, tasks, sprints)',
            '├─ processed-sessions.json ← anti double-log tracker',
            '└─ op-mode.json          ← config: test/live, userId, projectId',
          ]} />

          <div className="text-[10px] text-gray-300 dark:text-gray-600 text-center pt-4 pb-2">
            Auto-refresh every 30 seconds · Last update: {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
        </div>
      </div>
    </div>
  )
}
