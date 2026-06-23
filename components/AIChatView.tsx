'use client'
import { useEffect, useRef, useState } from 'react'

type Message = { role: 'user' | 'assistant'; content: string }

type ProviderKey = 'tokenrouter' | 'openmodel'

const PROVIDER_LABELS: Record<ProviderKey, string> = {
  tokenrouter: 'TokenRouter',
  openmodel:   'OpenModel',
}

export default function AIChatView() {
  const [provider, setProvider]   = useState<ProviderKey>('tokenrouter')
  const [models, setModels]       = useState<Record<ProviderKey, string[]>>({
    tokenrouter: ['gpt-4o-mini'],
    openmodel:   ['deepseek-v4-flash'],
  })
  const [model, setModel]         = useState('gpt-4o-mini')
  const [messages, setMessages]   = useState<Message[]>([])
  const [input, setInput]         = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    fetch('/api/ai-chat')
      .then(r => r.json())
      .then((d: { models: Record<ProviderKey, string[]> }) => {
        setModels(d.models)
        setModel(d.models.tokenrouter?.[0] ?? 'gpt-4o-mini')
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const list = models[provider] ?? []
    if (!list.includes(model)) setModel(list[0] ?? '')
  }, [provider]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send() {
    const text = input.trim()
    if (!text || streaming) return
    setInput('')
    setError(null)

    const userMsg: Message = { role: 'user', content: text }
    const next = [...messages, userMsg]
    setMessages(next)
    setStreaming(true)

    const placeholder: Message = { role: 'assistant', content: '' }
    setMessages([...next, placeholder])

    try {
      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model, messages: next }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        setMessages(next)
        setError((err as { error?: string }).error ?? `HTTP ${res.status}`)
        return
      }

      const reader  = res.body!.getReader()
      const dec     = new TextDecoder()
      let assembled = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        assembled += dec.decode(value, { stream: true })
        setMessages([...next, { role: 'assistant', content: assembled }])
      }
    } catch (e) {
      setMessages(next)
      setError(String(e))
    } finally {
      setStreaming(false)
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const providerList = Object.keys(PROVIDER_LABELS) as ProviderKey[]
  const modelList    = models[provider] ?? []

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">

      {/* Top bar — provider + model selectors */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex-shrink-0">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mr-1">Provider</span>
        <select
          value={provider}
          onChange={e => setProvider(e.target.value as ProviderKey)}
          className="text-sm px-2 py-1 rounded border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-violet-400"
        >
          {providerList.map(p => (
            <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
          ))}
        </select>

        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide ml-2 mr-1">Model</span>
        <select
          value={model}
          onChange={e => setModel(e.target.value)}
          className="text-sm px-2 py-1 rounded border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-violet-400 flex-1 max-w-xs"
        >
          {modelList.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        {messages.length > 0 && (
          <button
            onClick={() => { setMessages([]); setError(null) }}
            className="ml-auto text-xs text-gray-400 hover:text-red-500 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-950 transition"
          >
            Clear
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center h-full text-center text-gray-400 dark:text-gray-600 select-none">
            <div className="text-4xl mb-3">🤖</div>
            <p className="text-sm font-medium">AI Chat</p>
            <p className="text-xs mt-1">{PROVIDER_LABELS[provider]} · {model || '—'}</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words
              ${msg.role === 'user'
                ? 'bg-violet-600 text-white rounded-br-sm'
                : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-bl-sm'
              }`}>
              {msg.content || (msg.role === 'assistant' && streaming ? (
                <span className="inline-flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                </span>
              ) : '')}
            </div>
          </div>
        ))}

        {error && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-bl-sm">
              ⚠️ {error}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex-shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            rows={1}
            placeholder="Ketik pesan… (Enter kirim, Shift+Enter newline)"
            disabled={streaming}
            className="flex-1 resize-none rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-800 dark:text-gray-100 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-violet-400 disabled:opacity-50 min-h-[40px] max-h-36 overflow-y-auto"
            style={{ fieldSizing: 'content' } as React.CSSProperties}
          />
          <button
            onClick={send}
            disabled={!input.trim() || streaming}
            className="flex-shrink-0 w-9 h-9 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center transition"
          >
            {streaming ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
