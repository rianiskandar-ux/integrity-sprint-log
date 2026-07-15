'use client'

import { useState, useEffect } from 'react'
import { loadSettings } from '@/lib/op-config'
import { useI18n } from '@/lib/i18n'

type Mode = 'test' | 'live'

interface ModeState {
  mode: Mode
  project?: string
}

export default function EnvModeBadge() {
  const { t } = useI18n()
  const [state, setState] = useState<ModeState>({ mode: 'test' })
  const [toggling, setToggling] = useState(false)
  // POST/PATCH /api/op/mode is owner-only — a non-owner previously saw this
  // control, went through the confirm() dialog, and had it silently do
  // nothing (403 swallowed). Hide it instead now that GET reports ownership.
  const [isOwner, setIsOwner] = useState(true)

  useEffect(() => {
    fetch('/api/op/mode')
      .then(r => r.json())
      .then(d => { setState({ mode: d.mode, project: d.project }); setIsOwner(!!d.owner) })
      .catch(() => {})
  }, [])

  async function toggle() {
    const next: Mode = state.mode === 'test' ? 'live' : 'test'

    if (next === 'live') {
      const s = loadSettings()
      const projectId = s.defaultProjectIdentifier || 'integritys-websites'
      if (!confirm(t('envmode.confirm_live', { project: projectId }))) return

      setToggling(true)
      try {
        const r = await fetch('/api/op/mode', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: 'live', project: projectId, userId: s.userId }),
        })
        if (r.ok) {
          const d = await r.json()
          setState({ mode: 'live', project: d.project })
        }
      } finally { setToggling(false) }

    } else {
      setToggling(true)
      try {
        const r = await fetch('/api/op/mode', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: 'test' }),
        })
        if (r.ok) setState({ mode: 'test', project: 'scrum-project' })
      } finally { setToggling(false) }
    }
  }

  const isTest = state.mode === 'test'
  const label  = isTest ? 'TEST' : 'LIVE'
  const tooltip = !isOwner
    ? 'Dikontrol owner instance'
    : isTest
      ? t('envmode.test_tooltip')
      : t('envmode.live_tooltip', { project: state.project ?? 'project' })

  return (
    <button
      onClick={isOwner ? toggle : undefined}
      disabled={toggling || !isOwner}
      title={tooltip}
      className={`hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border transition disabled:opacity-50 ${!isOwner ? 'cursor-default' : ''} ${
        isTest
          ? 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900'
          : 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700 hover:bg-emerald-100 dark:hover:bg-emerald-900'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${isTest ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
      {toggling ? '…' : label}
    </button>
  )
}
