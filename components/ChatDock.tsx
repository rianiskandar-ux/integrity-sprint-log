'use client'

import { useState, useEffect } from 'react'
import TaskChatModal, { type TaskChatContext } from './TaskChatModal'

interface Props {
  chats: TaskChatContext[]
  onClose: (id: string) => void
  onPushed?: (sessionId: string, taskId: number) => void
}

/**
 * A single docked chat window hosting multiple open chats as tabs. Every chat is
 * kept mounted (inactive ones are hidden, not unmounted) so each keeps its own
 * conversation state and any in-flight streaming continues in the background.
 */
export default function ChatDock({ chats, onClose, onPushed }: Props) {
  const [activeId, setActiveId]   = useState<string | null>(null)
  const [minimized, setMinimized] = useState(false)

  // Keep a valid active tab — default to the most recently opened chat
  useEffect(() => {
    if (chats.length === 0) { setActiveId(null); return }
    if (!activeId || !chats.some(c => c.id === activeId)) {
      setActiveId(chats[chats.length - 1].id)
      setMinimized(false)
    }
  }, [chats, activeId])

  if (chats.length === 0) return null

  return (
    <div className="fixed bottom-3 right-3 z-40 flex flex-col rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden"
      style={{ width: 384, height: minimized ? 42 : 560, maxHeight: '82vh' }}>

      {/* Tab strip */}
      <div className="flex items-stretch bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <div className="flex-1 flex items-stretch overflow-x-auto">
          {chats.map(c => {
            const active = c.id === activeId
            return (
              <div key={c.id}
                onClick={() => { setActiveId(c.id); setMinimized(false) }}
                title={c.title}
                className={`group flex items-center gap-1 pl-2.5 pr-1.5 py-2 text-[11px] cursor-pointer border-r border-gray-200 dark:border-gray-700 max-w-[150px] flex-shrink-0 transition
                  ${active
                    ? 'bg-white dark:bg-gray-900 font-semibold text-gray-800 dark:text-gray-100'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                <span className="truncate flex-1">{c.title}</span>
                <button onClick={e => { e.stopPropagation(); onClose(c.id) }}
                  className="opacity-40 group-hover:opacity-100 hover:text-red-500 flex-shrink-0 px-0.5">✕</button>
              </div>
            )
          })}
        </div>
        <button onClick={() => setMinimized(m => !m)}
          title={minimized ? 'Restore' : 'Minimize'}
          className="px-2.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex-shrink-0 border-l border-gray-200 dark:border-gray-700">
          {minimized ? '▢' : '–'}
        </button>
      </div>

      {/* Bodies — all mounted, only the active one visible */}
      {!minimized && (
        <div className="flex-1 relative min-h-0">
          {chats.map(c => (
            <div key={c.id} className={c.id === activeId ? 'absolute inset-0' : 'hidden'}>
              <TaskChatModal
                embedded
                task={c}
                onClose={() => onClose(c.id)}
                onPushed={onPushed}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
