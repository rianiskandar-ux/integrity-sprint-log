'use client'

import { useState, useEffect } from 'react'
import { useI18n } from '@/lib/i18n'

interface Props {
  onNavigate: () => void
}

export default function AutoLogIndicator({ onNavigate }: Props) {
  const { t } = useI18n()
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    const check = () => {
      fetch('/api/op/undo')
        .then(r => r.json())
        .then(d => setCount(d.total ?? 0))
        .catch(() => {})
    }
    check()
    const iv = setInterval(check, 60000)
    return () => clearInterval(iv)
  }, [])

  return (
    <button
      onClick={onNavigate}
      className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
      title={t('autolog.tooltip')}
    >
      <span className="text-[11px]">🤖</span>
      {count !== null && count > 0
        ? <span className="text-violet-600 dark:text-violet-400 font-bold">{count} log</span>
        : <span>Auto Log</span>
      }
    </button>
  )
}
