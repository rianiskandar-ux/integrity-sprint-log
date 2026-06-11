'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
  id: string
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

export default function ChatBubble() {
  const [open, setOpen]         = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput]       = useState('')
  const [streaming, setStreaming] = useState(false)
  const [aiReady, setAiReady]   = useState<boolean | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)
  const abortRef  = useRef<AbortController | null>(null)

  useEffect(() => {
    fetch('/api/user-config').then(r => r.json()).then(d => {
      setAiReady(d.llmApiKeySet || d.llmProvider === 'ollama')
    }).catch(() => setAiReady(false))
  }, [])

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
        body: JSON.stringify({ messages: history }),
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
    }
  }, [messages, streaming])

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
  }

  return (
    <>
      {/* Floating bubble button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-5 right-5 z-50 w-12 h-12 rounded-full shadow-xl flex items-center justify-center text-white text-xl transition hover:scale-110 active:scale-95"
        style={{ background: 'linear-gradient(135deg, #1d3a5c, #2a5298)' }}
        title="ISL Assistant">
        {open ? '✕' : '✦'}
      </button>

      {/* Slide-in panel */}
      <div className={`fixed bottom-20 right-5 z-50 w-80 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900 flex flex-col overflow-hidden transition-all duration-200
        ${open ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-4 pointer-events-none'}`}
        style={{ height: '460px' }}>

        {/* Panel header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, #1d3a5c, #2a5298)' }}>
          <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center text-white text-sm font-bold">✦</div>
          <div className="flex-1">
            <p className="text-xs font-bold text-white leading-none">ISL Assistant</p>
            <p className="text-[9px] text-blue-200/70">
              {aiReady === null ? 'Checking…' : aiReady ? 'Ready' : 'Not configured'}
            </p>
          </div>
          {messages.length > 0 && (
            <button onClick={() => { abortRef.current?.abort(); setMessages([]); setStreaming(false) }}
              className="text-[10px] text-blue-200/60 hover:text-white transition px-2 py-1 rounded hover:bg-white/10">
              Clear
            </button>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 pb-2">
              <div className="text-center">
                <div className="text-3xl mb-2">✦</div>
                <p className="text-xs font-bold text-gray-700 dark:text-gray-200">ISL Assistant</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Ask about tasks, sprint, or anything</p>
              </div>
              {aiReady === false && (
                <div className="w-full bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2 text-[10px] text-amber-700 dark:text-amber-300 text-center">
                  No AI configured.{' '}
                  <a href="/settings" className="underline font-semibold">Open Settings</a>
                </div>
              )}
              {aiReady && (
                <div className="w-full space-y-1.5">
                  {['What are my open tasks?', 'Summarize today', 'Sprint status?'].map(p => (
                    <button key={p} onClick={() => send(p)}
                      className="w-full text-left text-[10px] px-3 py-2 rounded-xl border border-gray-100 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-blue-200 dark:hover:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/20 hover:text-blue-700 dark:hover:text-blue-300 transition">
                      {p}
                    </button>
                  ))}
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
                  {msg.role === 'user' ? 'U' : '✦'}
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
              placeholder={aiReady === false ? 'Configure AI first…' : 'Ask anything… (Enter)'}
              disabled={!aiReady || aiReady === null}
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
              <button onClick={() => send(input)} disabled={!input.trim() || !aiReady}
                className="flex-shrink-0 w-8 h-8 rounded-xl text-white flex items-center justify-center text-sm disabled:opacity-30 transition"
                style={{ background: 'linear-gradient(135deg, #1d3a5c, #2a5298)' }}>
                ↑
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
