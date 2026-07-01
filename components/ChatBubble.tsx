'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Bot, X, MessageCircle, Play, ClipboardList, Inbox, Send, ChevronRight } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
  id: string
}

interface TaskShortcut {
  id: string
  label: string
  type: 'queue' | 'incoming'
  taskId?: number | null
}

function md(text: string): string {
  return text
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, _lang, code) =>
      `<pre class="bg-gray-900 text-green-300 rounded p-2 my-1 overflow-x-auto text-[10px] font-mono">${esc(code.trim())}</pre>`)
    .replace(/`([^`]+)`/g, '<code class="bg-gray-100 dark:bg-gray-700 text-rose-500 px-1 rounded text-[10px] font-mono">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.+)$/gm, '<li class="ml-3 list-disc">$1</li>')
    .replace(/\n\n/g, '</p><p class="mt-1.5">')
    .replace(/\n/g, '<br/>')
}

function esc(s: string) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

const CHAT_ID = 'general-chat'

export default function ChatBubble() {
  const [open, setOpen]         = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput]       = useState('')
  const [streaming, setStreaming] = useState(false)
  const [aiReady, setAiReady]       = useState<boolean | null>(null)
  const [aiProvider, setAiProvider] = useState('claude-cli')
  const [aiModel,    setAiModel]    = useState('claude')
  const [aiModels,   setAiModels]   = useState<Record<string, string[]>>({ 'claude-cli': ['claude'] })
  const [taskShortcuts, setShortcuts] = useState<TaskShortcut[]>([])
  const [showWorkspace, setShowWorkspace] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)
  const abortRef  = useRef<AbortController | null>(null)

  useEffect(() => {
    fetch('/api/user-config').then(r => r.json()).then(d => {
      setAiReady(d.llmApiKeySet || ['ollama', '9router', 'claude-cli'].includes(d.llmProvider))
    }).catch(() => setAiReady(false))
    fetch('/api/ai-chat').then(r => r.json()).then(d => { if (d.models) setAiModels(d.models) }).catch(() => {})
  }, [])

  // Claude CLI is local and always usable, regardless of the saved Settings provider
  const ready = aiProvider === 'claude-cli' ? true : aiReady

  // Load chat history from server on mount
  useEffect(() => {
    fetch(`/api/chat/history/${CHAT_ID}`)
      .then(r => r.json())
      .then(d => {
        if (d.chat?.messages?.length > 0) {
          setMessages(d.chat.messages.map((m: { role: string; content: string }, i: number) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
            id: String(i),
          })))
        }
        setHistoryLoaded(true)
      })
      .catch(() => setHistoryLoaded(true))
  }, [])

  // Load task shortcuts when panel opens
  useEffect(() => {
    if (!open) return
    Promise.all([
      fetch('/api/isl/sessions?status=pending').then(r => r.json()).catch(() => ({})),
      fetch('/api/op/cache').then(r => r.json()).catch(() => ({})),
    ]).then(([sessRes, cacheRes]) => {
      const queue: TaskShortcut[] = ((sessRes.sessions ?? []) as { id: string; title: string; opTaskId?: number | null }[])
        .slice(0, 3).map(s => ({ id: s.id, label: s.title, type: 'queue' as const, taskId: s.opTaskId }))
      const incoming: TaskShortcut[] = ((cacheRes.incomingTasks ?? []) as { id: number; subject: string; islStatus?: string }[])
        .filter((t) => t.islStatus !== 'done')
        .slice(0, 3).map(t => ({ id: `incoming-${t.id}`, label: t.subject, type: 'incoming' as const, taskId: t.id }))
      setShortcuts([...queue, ...incoming].slice(0, 5))
    })
  }, [open])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150)
  }, [open])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = useCallback(async (text: string) => {
    const content = text.trim()
    if (!content || streaming) return

    const userMsg: Message    = { role: 'user', content, id: Date.now().toString() }
    const assistantId         = (Date.now() + 1).toString()
    const assistantMsg: Message = { role: 'assistant', content: '', id: assistantId }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setInput('')
    setStreaming(true)
    abortRef.current = new AbortController()

    try {
      const history = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }))
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, provider: aiProvider, model: aiModel }),
        signal: abortRef.current.signal,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        const raw = err.error ?? ''
        let friendly = raw
        if (typeof raw === 'string' && raw.includes('credit balance is too low'))
          friendly = 'API credit habis. Top up di console.anthropic.com → Plans & Billing.'
        else if (typeof raw === 'string' && raw.includes('invalid_api_key'))
          friendly = 'API key tidak valid. Cek Settings → LLM API Key.'
        else if (typeof raw === 'string' && raw.length > 120)
          friendly = raw.slice(0, 120) + '…'
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: `⚠️ ${friendly || `Error ${res.status}`}` } : m))
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
    } catch (e: unknown) {
      if ((e as Error).name === 'AbortError') return
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: '⚠️ Connection error.' } : m))
    } finally {
      setStreaming(false)
      abortRef.current = null
      // Save full conversation to server after each exchange
      setMessages(prev => {
        const toSave = prev.map(m => ({ role: m.role, content: m.content }))
        fetch(`/api/chat/history/${CHAT_ID}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'ISL General Chat', taskType: 'general', messages: toSave }),
        }).catch(() => {})
        return prev
      })
    }
  }, [messages, streaming, aiProvider, aiModel])

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
  }

  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return null

  return createPortal(
    <>
      {/* Floating bubble — wrapper is fixed, button is relative inside */}
      <div className="fixed bottom-5 right-5 z-[9999]" style={{ position: 'fixed', bottom: '20px', right: '20px' }}>
        <button
          onClick={() => setOpen(o => !o)}
          className="relative w-12 h-12 rounded-full shadow-xl flex items-center justify-center text-white text-xl transition hover:scale-110 active:scale-95"
          style={{ background: 'linear-gradient(135deg, #1d3a5c, #2a5298)' }}
          title={`ISL Assistant — AI ${ready === null ? 'checking…' : ready ? 'Ready' : 'Pilih Claude CLI'}`}>
          {open ? <X size={16} /> : <MessageCircle size={18} />}
          {/* AI status dot */}
          <span className={`absolute top-0.5 right-0.5 w-3 h-3 rounded-full border-2 border-white ${
            ready === null  ? 'bg-yellow-400 animate-pulse' :
            ready           ? 'bg-emerald-400' :
                              'bg-red-500 animate-pulse'
          }`} />
        </button>
      </div>

      {/* Slide-in panel */}
      <div
        style={{ position: 'fixed', bottom: '84px', right: '20px', zIndex: 9998, width: '320px', height: '460px', opacity: open ? 1 : 0, transform: open ? 'translateY(0)' : 'translateY(16px)', pointerEvents: open ? 'auto' : 'none', transition: 'opacity 0.2s, transform 0.2s' }}
        className="rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900 flex flex-col overflow-hidden">

        {/* Panel header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, #1d3a5c, #2a5298)' }}>
          <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center text-white"><Bot size={14} /></div>
          <div className="flex-1">
            <p className="text-xs font-bold text-white leading-none">ISL Assistant</p>
            <p className="text-[9px] text-blue-200/70">
              {ready === null ? 'Checking…' : ready ? 'Ready' : 'Pilih Claude CLI'}
            </p>
          </div>
          {messages.length > 0 && (
            <button onClick={() => {
              abortRef.current?.abort()
              setMessages([])
              setStreaming(false)
              fetch(`/api/chat/history/${CHAT_ID}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: 'ISL General Chat', taskType: 'general', messages: [] }),
              }).catch(() => {})
            }}
              className="text-[10px] text-blue-200/60 hover:text-white transition px-2 py-1 rounded hover:bg-white/10">
              Clear
            </button>
          )}
        </div>

        {/* Model picker */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/60 flex-shrink-0">
          <span className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider">Model</span>
          <select
            value={`${aiProvider}::${aiModel}`}
            onChange={e => { const [p, m] = e.target.value.split('::'); setAiProvider(p); setAiModel(m) }}
            className="flex-1 text-[10px] px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-300">
            {Object.entries(aiModels).map(([prov, list]) => (
              <optgroup key={prov} label={prov === 'claude-cli' ? 'Claude CLI (gratis)' : prov}>
                {list.map(m => <option key={`${prov}::${m}`} value={`${prov}::${m}`}>{m}</option>)}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 pb-2">
              <div className="text-center">
                <div className="mb-2 flex justify-center"><Bot size={28} className="text-gray-400" /></div>
                <p className="text-xs font-bold text-gray-700 dark:text-gray-200">ISL Assistant</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Ask about tasks, sprint, or anything</p>
              </div>
              {ready === false && (
                <div className="w-full bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2 space-y-1.5">
                  <p className="text-[10px] font-bold text-red-700 dark:text-red-300">Provider ini butuh API key</p>
                  <p className="text-[9px] text-red-600 dark:text-red-400">Pilih <strong>Claude CLI (gratis)</strong> di dropdown Model di atas — tidak perlu API key.</p>
                </div>
              )}
              {ready && (
                <div className="w-full space-y-1.5">
                  {['What are my open tasks?', 'Summarize today', 'Sprint status?'].map(p => (
                    <button key={p} onClick={() => send(p)}
                      className="w-full text-left text-[10px] px-3 py-2 rounded-xl border border-gray-100 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-blue-200 dark:hover:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/20 hover:text-blue-700 dark:hover:text-blue-300 transition">
                      {p}
                    </button>
                  ))}
                  {taskShortcuts.length > 0 && (
                    <div className="pt-1">
                      <button
                        onClick={() => setShowWorkspace(v => !v)}
                        className="w-full flex items-center justify-between px-1 pb-1.5 text-[9px] font-bold text-gray-400 uppercase tracking-wider hover:text-gray-600 dark:hover:text-gray-300 transition">
                        <span className="flex items-center gap-1"><ClipboardList size={9} /> Task Workspace ({taskShortcuts.length})</span>
                        <ChevronRight size={9} className={`transition-transform ${showWorkspace ? 'rotate-90' : ''}`} />
                      </button>
                      {showWorkspace && taskShortcuts.map(s => (
                        <div key={s.id} className="mt-1 rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30 px-3 py-2">
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <span className="text-gray-400">{s.type === 'queue' ? <Send size={9} /> : <Inbox size={9} />}</span>
                            <span className="text-[10px] font-medium text-gray-700 dark:text-gray-300 truncate flex-1">{s.label}</span>
                          </div>
                          {s.type === 'queue' ? (
                            <button
                              onClick={() => window.dispatchEvent(new CustomEvent('isl:open-task-chat', { detail: { id: s.id, title: s.label, taskType: 'session', opTaskId: s.taskId } }))}
                              className="w-full text-[10px] font-semibold text-indigo-600 border border-indigo-200 dark:border-indigo-700 rounded-lg px-2 py-1 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition text-center">
                              <span className="flex items-center gap-1 justify-center"><MessageCircle size={10} /> Lanjut Chat</span>
                            </button>
                          ) : (
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => window.dispatchEvent(new CustomEvent('isl:start-session', { detail: { title: s.label, opTaskId: s.taskId } }))}
                                className="flex-1 text-[10px] font-semibold text-emerald-700 border border-emerald-200 dark:border-emerald-700 rounded-lg px-2 py-1 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition text-center">
                                <span className="flex items-center gap-1 justify-center"><Play size={10} /> Mulai</span>
                              </button>
                              <button
                                onClick={() => window.dispatchEvent(new CustomEvent('isl:open-task-chat', { detail: { id: s.id, title: s.label, taskType: 'incoming', opTaskId: s.taskId } }))}
                                className="flex-1 text-[10px] font-semibold text-indigo-600 border border-indigo-200 dark:border-indigo-700 rounded-lg px-2 py-1 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition text-center">
                                <span className="flex items-center gap-1 justify-center"><MessageCircle size={10} /> Diskusi</span>
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            messages.map(msg => (
              <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold ${
                  msg.role === 'user'
                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300'
                    : 'text-white'
                }`} style={msg.role === 'assistant' ? { background: 'linear-gradient(135deg, #1d3a5c, #2a5298)' } : {}}>
                  {msg.role === 'user' ? 'U' : <Bot size={9} />}
                </div>
                <div className={`max-w-[82%] px-3 py-2 rounded-xl text-[11px] leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white rounded-tr-sm'
                    : 'bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 border border-gray-100 dark:border-gray-700 rounded-tl-sm'
                }`}>
                  {msg.role === 'user' ? (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  ) : msg.content ? (
                    <div dangerouslySetInnerHTML={{ __html: md(msg.content) }} />
                  ) : (
                    <span className="inline-flex gap-1 items-center text-gray-400">
                      <span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="flex-shrink-0 p-3 border-t border-gray-100 dark:border-gray-800">
          <div className="flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={ready === false ? 'Pilih Claude CLI di Model…' : 'Ask anything… (Enter)'}
              disabled={!ready || ready === null}
              rows={1}
              className="flex-1 resize-none rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-xs text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition disabled:opacity-40 max-h-20 overflow-y-auto"
              style={{ minHeight: '34px' }}
              onInput={e => {
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = Math.min(el.scrollHeight, 80) + 'px'
              }}
            />
            {streaming ? (
              <button onClick={() => { abortRef.current?.abort(); setStreaming(false) }}
                className="flex-shrink-0 w-8 h-8 rounded-xl bg-red-100 dark:bg-red-900/30 text-red-500 flex items-center justify-center text-xs">
                ■
              </button>
            ) : (
              <button onClick={() => send(input)} disabled={!input.trim() || !ready}
                className="flex-shrink-0 w-8 h-8 rounded-xl text-white flex items-center justify-center text-sm disabled:opacity-30 transition"
                style={{ background: 'linear-gradient(135deg, #1d3a5c, #2a5298)' }}>
                ↑
              </button>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body
  )
}
