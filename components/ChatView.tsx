'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useI18n } from '@/lib/i18n'

interface Message {
  role: 'user' | 'assistant'
  content: string
  id: string
}

const SUGGESTED_PROMPTS = [
  'What are my open tasks in the current sprint?',
  'Help me write a daily summary for today',
  'What should I focus on today?',
  'Review my sprint progress and suggest next steps',
  'Help me write a task description for OpenProject',
]

function md(text: string): string {
  return text
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
      `<pre class="bg-gray-900 text-green-300 rounded-lg p-3 my-2 overflow-x-auto text-[11px] font-mono leading-relaxed"><code>${escHtml(code.trim())}</code></pre>`)
    .replace(/`([^`]+)`/g, '<code class="bg-gray-100 dark:bg-gray-800 text-rose-600 dark:text-rose-400 px-1 py-0.5 rounded text-[11px] font-mono">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3 class="font-bold text-sm mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="font-bold text-base mt-4 mb-1">$1</h2>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 list-decimal">$2</li>')
    .replace(/(<li[\s\S]*?<\/li>)/g, '<ul class="my-1 space-y-0.5">$1</ul>')
    .replace(/\n\n/g, '</p><p class="mt-2">')
    .replace(/\n/g, '<br/>')
}

function escHtml(s: string) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

export default function ChatView() {
  const { t } = useI18n()
  const [messages, setMessages]   = useState<Message[]>([])
  const [input, setInput]         = useState('')
  const [streaming, setStreaming] = useState(false)
  const [aiReady, setAiReady]     = useState<boolean | null>(null)
  const [aiName, setAiName]       = useState('ISL Assistant')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)
  const abortRef  = useRef<AbortController | null>(null)

  useEffect(() => {
    fetch('/api/user-config')
      .then(r => r.json())
      .then(d => {
        const ready = d.llmApiKeySet || d.llmProvider === 'ollama'
        setAiReady(ready)
        if (d.llmProvider) {
          const labels: Record<string, string> = {
            anthropic: 'Claude', openai: 'GPT', google: 'Gemini',
            groq: 'Groq', openrouter: 'OpenRouter', mistral: 'Mistral',
            together: 'Together AI', ollama: 'Ollama',
          }
          setAiName(`ISL · ${labels[d.llmProvider] ?? d.llmProvider}`)
        }
      })
      .catch(() => setAiReady(false))
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = useCallback(async (text: string) => {
    const content = text.trim()
    if (!content || streaming) return

    const userMsg: Message = { role: 'user', content, id: Date.now().toString() }
    const assistantId = (Date.now() + 1).toString()
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
        setMessages(prev => prev.map(m => m.id === assistantId
          ? { ...m, content: `⚠️ ${err.error ?? 'Failed to get response'}` }
          : m))
        return
      }

      const reader = res.body!.getReader()
      const dec = new TextDecoder()
      let full = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        full += dec.decode(value, { stream: true })
        const snapshot = full
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: snapshot } : m))
      }
    } catch (e: unknown) {
      if ((e as Error).name === 'AbortError') return
      setMessages(prev => prev.map(m => m.id === assistantId
        ? { ...m, content: `⚠️ Connection error. Check your AI settings.` }
        : m))
    } finally {
      setStreaming(false)
      abortRef.current = null
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [messages, streaming])

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
  }

  function stopStreaming() {
    abortRef.current?.abort()
    setStreaming(false)
  }

  function clearChat() {
    abortRef.current?.abort()
    setMessages([])
    setStreaming(false)
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  const isEmpty = messages.length === 0

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-950">

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-950 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-sm font-bold shadow-sm">
            ✦
          </div>
          <div>
            <h1 className="text-sm font-bold text-gray-900 dark:text-gray-100">{aiName}</h1>
            <p className="text-[10px] text-gray-400">
              {aiReady === null ? 'Checking…' : aiReady ? 'Ready' : 'AI not configured — go to Settings'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button onClick={clearChat}
              className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition">
              Clear chat
            </button>
          )}
          <a href="/" className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition">
            ← Back to ISL
          </a>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full gap-6 pb-8">
            <div className="text-center">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-2xl font-bold shadow-lg mx-auto mb-4">
                ✦
              </div>
              <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">{aiName}</h2>
              <p className="text-sm text-gray-400 mt-1">Your AI assistant inside ISL. Ask anything.</p>
            </div>

            {aiReady === false && (
              <div className="w-full max-w-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3 text-sm text-amber-700 dark:text-amber-300 text-center">
                No AI provider configured.{' '}
                <a href="/settings" className="underline font-semibold">Open Settings</a> and add your API key.
              </div>
            )}

            {aiReady && (
              <div className="w-full max-w-xl grid grid-cols-1 gap-2">
                {SUGGESTED_PROMPTS.map(p => (
                  <button key={p} onClick={() => send(p)}
                    className="text-left px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:border-indigo-300 dark:hover:border-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 hover:text-indigo-700 dark:hover:text-indigo-300 transition">
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          messages.map(msg => (
            <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              {/* Avatar */}
              <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold ${
                msg.role === 'user'
                  ? 'bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-300'
                  : 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white'
              }`}>
                {msg.role === 'user' ? 'U' : '✦'}
              </div>

              {/* Bubble */}
              <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-tr-sm'
                  : 'bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-tl-sm border border-gray-100 dark:border-gray-700'
              }`}>
                {msg.role === 'user' ? (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                ) : msg.content ? (
                  <div
                    className="prose-sm dark:prose-invert max-w-none"
                    dangerouslySetInnerHTML={{ __html: md(msg.content) }}
                  />
                ) : (
                  <span className="inline-flex gap-1 items-center text-gray-400">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </span>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 px-4 pb-4 pt-2 border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-950">
        <div className="max-w-3xl mx-auto flex gap-3 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={aiReady === false ? 'Configure AI in Settings first…' : 'Message ISL Assistant… (Enter to send, Shift+Enter for newline)'}
            disabled={!aiReady || aiReady === null}
            rows={1}
            className="flex-1 resize-none rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-2.5 text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition disabled:opacity-50 max-h-40 overflow-y-auto"
            style={{ minHeight: '42px' }}
            onInput={e => {
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = Math.min(el.scrollHeight, 160) + 'px'
            }}
          />
          {streaming ? (
            <button onClick={stopStreaming}
              className="flex-shrink-0 w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 transition flex items-center justify-center">
              ■
            </button>
          ) : (
            <button onClick={() => send(input)} disabled={!input.trim() || !aiReady}
              className="flex-shrink-0 w-10 h-10 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center">
              ↑
            </button>
          )}
        </div>
        <p className="text-center text-[10px] text-gray-300 dark:text-gray-600 mt-1.5">
          Context-aware: knows your sprint, tasks, and identity
        </p>
      </div>
    </div>
  )
}
