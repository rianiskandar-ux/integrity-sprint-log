'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'

const HistorySearchModal = dynamic(() => import('./HistorySearchModal'), { ssr: false })

export default function HistorySearchToggle() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+Shift+F — avoid conflicting with existing Ctrl+K (OP search in AppShell)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'F') {
        e.preventDefault()
        setOpen(v => !v)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Search ISL history (Ctrl+Shift+F)"
        className="fixed bottom-16 right-4 z-40 w-9 h-9 rounded-full bg-gray-800 text-white text-sm shadow-lg flex items-center justify-center hover:bg-gray-700 transition-colors"
        aria-label="Search ISL history"
      >
        🗂
      </button>
      {open && <HistorySearchModal onClose={() => setOpen(false)} />}
    </>
  )
}
