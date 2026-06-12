'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

const BRAND = '#1d3a5c'
const RED   = '#cc1a2e'

export interface TaskChatContext {
  id: string
  title: string
  taskType: 'session' | 'incoming' | 'new'
  opTaskId?: number | null
  opStoryId?: number | null
  sprintName?: string | null
  date?: string
  status?: string
  bullets?: string[]
}

interface Message { role: 'user' | 'assistant'; content: string; id: string }

interface Props {
  task: TaskChatContext
  onClose: () => void
  onPush?: (id: string) => void
}

const BRAND_LIGHT = '#e8eef5'

export default function TaskChatModal({ task, onClose, onPush }: Props) {
  const [messages,  setMessages]  = useState<Message[]>([])
  const [input,     setInput]     = useState('')
  const [streaming, setStreaming] = useState(false)
  const [loading,   setLoading]   = useState(true)
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Load existing chat history
  useEffect(() => {
    fetch(`/api/chat/history/${encodeURIComponent(task.id)}`)
      .then(r => r.json())
      .then(d => {
        if (d.chat?.messages?.length) {
          setMessages(d.chat.messages.map((m: { role: string; content: string }, i: number) => ({
            ...m, id: `hist-${i}`
          })))
        } else {
          // First open — show a greeting with task context
          setMessages([{
            role: 'assistant',
            id: 'greeting',
            content: buildGreeting(task),
          }])
        }
      })
      .catch(() => {
        setMessages([{ role: 'assistant', id: 'greeting', content: buildGreeting(task) }])
      })
      .finally(() => setLoading(false))
  }, [task.id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function buildGreeting(t: TaskChatContext): string {
    const lines = [`Halo! Gw siap bantu kamu lanjutkan task ini:`]
    lines.push(`\n**${t.title}**`)
    if (t.sprintName) lines.push(`Sprint: ${t.sprintName}`)
    if (t.opTaskId)   lines.push(`OP Task: #${t.opTaskId}`)
    if (t.status)     lines.push(`Status: ${t.status}`)
    if (t.bullets?.length) {
      lines.push(`\nProgress sebelumnya:`)
      t.bullets.slice(0, 4).forEach(b => lines.push(`• ${b}`))
    }
    lines.push(`\nMau lanjut ngapain? Gw bisa bantu draft update, cek blockers, atau tulis summary.`)
    return lines.join('\n')
  }

  const send = useCallback(async (text?: string) => {
    const content = (text ?? input).trim()
    if (!content || streaming) return

    const userMsg: Message = { role: 'user', content, id: Date.now().toString() }
    const assistantId = (Date.now() + 1).toString()
    const assistantMsg: Message = { role: 'assistant', content: '', id: assistantId }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setInput('')
    setStreaming(true)
    abortRef.current = new AbortController()

    try {
      // Build history excluding greeting
      const history = [...messages, userMsg]
        .filter(m => m.id !== 'greeting')
        .map(m => ({ role: m.role, content: m.content }))

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history,
          taskContext: {
            id:        task.id,
            title:     task.title,
            opTaskId:  task.opTaskId,
            opStoryId: task.opStoryId,
            sprintName:task.sprintName,
            status:    task.status,
            bullets:   task.bullets,
          },
        }),
        signal: abortRef.current.signal,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        let msg = (err as { error?: string }).error ?? 'Error'
        if (msg.includes('credit balance')) msg = 'API credit habis.'
        if (msg.includes('429') || msg.includes('quota')) msg = 'Rate limit — coba lagi sebentar.'
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: `⚠️ ${msg}` } : m))
        return
      }

      const reader = res.body!.getReader()
      const dec = new TextDecoder()
      let full = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        full += dec.decode(value, { stream: true })
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: full } : m))
      }

      // Persist to server
      const allMsgs = [...messages, userMsg, { role: 'assistant' as const, content: full, id: assistantId }]
        .filter(m => m.id !== 'greeting')
        .map(m => ({ role: m.role, content: m.content, ts: new Date().toISOString() }))

      fetch(`/api/chat/history/${encodeURIComponent(task.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:      task.title,
          taskType:   task.taskType,
          opTaskId:   task.opTaskId,
          opStoryId:  task.opStoryId,
          sprintName: task.sprintName,
          date:       task.date,
          messages:   allMsgs,
        }),
      }).catch(() => {})

    } catch (e: unknown) {
      if ((e as Error).name === 'AbortError') return
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: '⚠️ Connection error.' } : m))
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }, [messages, input, streaming, task])

  const typeLabel = task.taskType === 'incoming' ? '📥 Incoming' : task.taskType === 'session' ? '📤 Push Queue' : '✨ New'

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white dark:bg-gray-900 w-full sm:max-w-xl sm:rounded-2xl shadow-2xl flex flex-col"
        style={{ height: '90vh', maxHeight: '720px' }}>

        {/* Header */}
        <div className="flex items-start gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800"
          style={{ background: BRAND, borderRadius: '16px 16px 0 0' }}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[10px] font-bold text-blue-200 uppercase tracking-widest">{typeLabel}</span>
              {task.sprintName && <span className="text-[10px] text-blue-300">· {task.sprintName}</span>}
              {task.opTaskId && (
                <span className="text-[10px] text-blue-300">· #{task.opTaskId}</span>
              )}
            </div>
            <p className="text-sm font-bold text-white leading-tight line-clamp-2">{task.title}</p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
            {task.taskType === 'session' && onPush && (
              <button onClick={() => onPush(task.id)}
                className="text-[11px] font-bold px-3 py-1 rounded-lg text-white border border-white/30 hover:bg-white/20 transition">
                Push OP
              </button>
            )}
            <button onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-white/70 hover:text-white hover:bg-white/20 transition">
              ✕
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
            </div>
          ) : messages.map(m => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {m.role === 'assistant' && (
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 mt-0.5 mr-2"
                  style={{ background: BRAND }}>
                  AI
                </div>
              )}
              <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed ${
                m.role === 'user'
                  ? 'text-white rounded-tr-sm'
                  : 'text-gray-800 dark:text-gray-100 rounded-tl-sm border border-gray-100 dark:border-gray-700'
              }`}
                style={m.role === 'user' ? { background: BRAND } : { background: BRAND_LIGHT }}>
                {m.content || (streaming && m.role === 'assistant' ? (
                  <span className="inline-flex gap-1">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </span>
                ) : '')}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Quick prompts (only if no real messages yet) */}
        {messages.length <= 1 && !loading && (
          <div className="px-4 pb-2 flex flex-wrap gap-1.5">
            {[
              'Apa yang sudah selesai?',
              'Tulis update singkat',
              'Ada blocker?',
              'Draft summary untuk OP',
            ].map(p => (
              <button key={p} onClick={() => send(p)}
                className="text-[11px] px-3 py-1 rounded-full border border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600 transition bg-white">
                {p}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="px-3 py-3 border-t border-gray-100 dark:border-gray-800 flex gap-2">
          <input value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder="Tanya atau lanjutkan diskusi task ini…"
            className="flex-1 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 dark:bg-gray-800 dark:text-white" />
          {streaming ? (
            <button onClick={() => abortRef.current?.abort()}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white flex-shrink-0"
              style={{ background: RED }}>
              ■
            </button>
          ) : (
            <button onClick={() => send()} disabled={!input.trim()}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white flex-shrink-0 disabled:opacity-40 transition"
              style={{ background: BRAND }}>
              ↑
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
