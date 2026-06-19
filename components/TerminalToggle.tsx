'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'

const TerminalPanel = dynamic(() => import('./TerminalPanel'), { ssr: false })

export default function TerminalToggle() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const handler = () => setOpen(o => !o)
    window.addEventListener('isl:toggle-terminal', handler)
    return () => window.removeEventListener('isl:toggle-terminal', handler)
  }, [])

  return open ? <TerminalPanel onClose={() => setOpen(false)} /> : null
}
