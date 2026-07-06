'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { MessageCircle, Plus, Sparkles, Lightbulb, Bot, AlertTriangle } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
  id: string
}

interface ChatSummary {
  id: string
  title: string
  taskType: string
  opTaskId?: number | null
  msgCount: number
  createdAt: string
  updatedAt: string
}

function md(text: string): string {
  return text
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, _lang, code) =>
      `<pre class="bg-gray-900 text-green-300 rounded p-2 my-1 overflow-x-auto text-xs font-mono">${esc(code.trim())}</pre>`)
    .replace(/`([^`]+)`/g, '<code class="bg-gray-100 text-rose-500 px-1 rounded text-xs font-mono">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/\n\n/g, '</p><p class="mt-2">')
    .replace(/\n/g, '<br/>')
}
function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function relTime(iso: string): string {
  const d = new Date(iso)
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  const days = Math.floor(diff / 86400)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function tagFor(c: ChatSummary): { label: string; cls: string } | null {
  if (c.opTaskId) return { label: `→ OP #${c.opTaskId}`, cls: 'bg-indigo-100 text-indigo-700' }
  if (c.taskType === 'plan') return { label: 'Plan', cls: 'bg-amber-100 text-amber-700' }
  if (c.taskType === 'idea' || c.taskType === 'general') return { label: 'Idea', cls: 'bg-emerald-100 text-emerald-700' }
  return null
}

const SUGGESTIONS = [
  'Gw punya ide untuk improve ISL…',
  'Bantu plan task baru: ',
  'Diskusi arsitektur fitur ',
]

export default function ChatsView() {
  const [chats, setChats]       = useState<ChatSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeTitle, setActiveTitle] = useState('')
  const [activeOpId, setActiveOpId] = useState<number | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput]       = useState('')
  const [streaming, setStreaming] = useState(false)
  const [aiReady, setAiReady]   = useState<boolean | null>(null)
  const [toast, setToast]       = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [candidates, setCandidates] = useState<{ text: string; kind: 'task' | 'note'; sel: boolean }[] | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)
  const abortRef  = useRef<AbortController | null>(null)

  function flash(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2800)
  }

  useEffect(() => {
    fetch('/api/user-config').then(r => r.json()).then(d => {
      setAiReady(d.llmApiKeySet || ['ollama', '9router', 'claude-cli'].includes(d.llmProvider))
    }).catch(() => setAiReady(false))
  }, [])

  const loadList = useCallback(() => {
    fetch('/api/chat/history')
      .then(r => r.json())
      .then(d => {
        const list: ChatSummary[] = (d.chats ?? []).filter((c: ChatSummary) => c.id !== 'general-chat')
        setChats(list)
        // auto-select most recent if nothing active
        setActiveId(prev => prev ?? (list[0]?.id ?? null))
      })
      .catch(() => {})
  }, [])

  useEffect(() => { loadList() }, [loadList])

  // Load active conversation
  useEffect(() => {
    if (!activeId) { setMessages([]); setActiveTitle(''); setActiveOpId(null); return }
    fetch(`/api/chat/history/${activeId}`)
      .then(r => r.json())
      .then(d => {
        const chat = d.chat
        if (chat) {
          setActiveTitle(chat.title ?? 'Untitled')
          setActiveOpId(chat.opTaskId ?? null)
          setMessages((chat.messages ?? []).map((m: { role: string; content: string }, i: number) => ({
            role: m.role as 'user' | 'assistant', content: m.content, id: String(i),
          })))
        } else {
          setMessages([])
        }
      })
      .catch(() => {})
  }, [activeId])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  function newChat() {
    const id = `chat-${Date.now().toString(36)}`
    setActiveId(id)
    setActiveTitle('New conversation')
    setActiveOpId(null)
    setMessages([])
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  function persist(id: string, title: string, msgs: Message[]) {
    fetch(`/api/chat/history/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, taskType: 'idea', opTaskId: activeOpId, messages: msgs.map(m => ({ role: m.role, content: m.content })) }),
    }).then(() => loadList()).catch(() => {})
  }

  const send = useCallback(async (text: string) => {
    const content = text.trim()
    if (!content || streaming) return
    let id = activeId
    if (!id) { id = `chat-${Date.now().toString(36)}`; setActiveId(id) }

    // derive title from first user message if still default/new
    const title = (!activeTitle || activeTitle === 'New conversation')
      ? content.slice(0, 50) + (content.length > 50 ? '…' : '')
      : activeTitle
    if (title !== activeTitle) setActiveTitle(title)

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
        const raw = err.error ?? ''
        let friendly = typeof raw === 'string' ? raw : `Error ${res.status}`
        if (friendly.includes('credit balance is too low')) friendly = 'API credit habis. Top up di console.anthropic.com.'
        else if (friendly.includes('invalid_api_key')) friendly = 'API key tidak valid. Cek Settings.'
        else if (friendly.length > 160) friendly = friendly.slice(0, 160) + '…'
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: `[Error] ${friendly}` } : m))
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
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: '[Error] Connection error.' } : m))
    } finally {
      setStreaming(false)
      abortRef.current = null
      setMessages(prev => { persist(id!, title, prev); return prev })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, streaming, activeId, activeTitle, activeOpId])

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
  }

  async function delChat(id: string) {
    if (!confirm('Hapus percakapan ini?')) return
    await fetch(`/api/chat/history/${id}`, { method: 'DELETE' }).catch(() => {})
    if (activeId === id) { setActiveId(null) }
    loadList()
  }

  // Ask AI to extract key points from the conversation, tagged TASK vs NOTE
  async function extractPoints() {
    if (!messages.length || extracting) return flash('Chat masih kosong')
    setExtracting(true)
    try {
      const transcript = messages.map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`).join('\n').slice(0, 4000)
      // Local-first: /api/chat/extract coba Ollama dulu, fallback Claude.
      // Response tetap plain text baris "TASK | ..." / "NOTE | ..." — parser di bawah tidak berubah.
      const res = await fetch('/api/chat/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript }),
      })
      if (!res.ok) { flash('Gagal ekstrak'); return }
      const reader = res.body!.getReader()
      const dec = new TextDecoder()
      let full = ''
      while (true) { const { done, value } = await reader.read(); if (done) break; full += dec.decode(value, { stream: true }) }
      const parsed = full.split('\n')
        .map(l => l.trim())
        .map(l => {
          const m = l.match(/^(TASK|NOTE)\s*\|\s*(.+)$/i)
          if (!m) return null
          return { text: m[2].trim(), kind: m[1].toUpperCase() === 'TASK' ? 'task' as const : 'note' as const, sel: m[1].toUpperCase() === 'TASK' }
        })
        .filter(Boolean) as { text: string; kind: 'task' | 'note'; sel: boolean }[]
      if (!parsed.length) { flash('Tidak ada poin terdeteksi'); return }
      setCandidates(parsed)
    } catch { flash('Gagal ekstrak') }
    finally { setExtracting(false) }
  }

  // Send only selected points to Daily Hub
  async function sendSelected() {
    const sel = (candidates ?? []).filter(c => c.sel)
    if (!sel.length) return flash('Pilih minimal 1 poin')
    const title = activeTitle && activeTitle !== 'New conversation' ? activeTitle : 'Idea from chat'
    const res = await fetch('/api/isl/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: `chat-${activeId}`,
        title,
        bullets: sel.map(c => c.text),
        estimatedMins: 30,
        pushStatus: 'hub',       // Daily Hub → triage → Push Queue → OP
        autoPushed: false,
        taskStatus: 'in_progress',
        source: 'chat',
      }),
    }).then(r => r.json()).catch(() => null)
    if (res?.ok) {
      flash(`${sel.length} poin masuk Daily Hub — pilah lagi di sana`)
      window.dispatchEvent(new CustomEvent('isl:session-updated'))
      setCandidates(null)
      loadList()
    } else flash('Gagal kirim ke Daily Hub')
  }

  return (
    <div className="relative flex h-full min-h-0 rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">

      {/* ── Left: conversation list ── */}
      <div className="w-64 flex-shrink-0 flex flex-col" style={{ background: '#1d3a5c' }}>
        <div className="p-3 border-b border-white/10">
          <h2 className="text-xs font-bold text-white mb-2.5 flex items-center gap-1.5"><MessageCircle size={12} /> Chats</h2>
          <button onClick={newChat}
            className="w-full px-3 py-2 rounded-lg bg-white/12 hover:bg-white/20 border border-white/15 text-white text-[11px] font-semibold flex items-center gap-1.5 transition">
            <Plus size={12} /> Create new
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1.5">
          {chats.length === 0 ? (
            <p className="text-[10px] text-white/30 text-center px-4 py-6 leading-relaxed">
              Belum ada percakapan.<br />Klik <strong className="text-white/50">Create new</strong> untuk mulai ide baru.
            </p>
          ) : chats.map(c => {
            const tag = tagFor(c)
            const active = c.id === activeId
            return (
              <div key={c.id}
                onClick={() => setActiveId(c.id)}
                className={`group px-3.5 py-2.5 cursor-pointer border-l-2 transition ${
                  active ? 'bg-white/12 border-blue-400' : 'border-transparent hover:bg-white/6'
                }`}>
                <div className="flex items-start gap-1.5">
                  <p className="flex-1 text-[11px] font-semibold text-white/90 truncate">{c.title}</p>
                  <button onClick={e => { e.stopPropagation(); delChat(c.id) }}
                    className="opacity-0 group-hover:opacity-100 text-white/40 hover:text-red-400 text-[11px] transition flex-shrink-0">✕</button>
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[9px] text-white/40">{relTime(c.updatedAt)} · {c.msgCount} msg</span>
                  {tag && <span className={`px-1.5 py-px rounded text-[8px] font-bold ${tag.cls}`}>{tag.label}</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Right: active chat ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {!activeId ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="flex justify-center"><Lightbulb size={40} className="text-gray-300 dark:text-gray-600" /></div>
            <p className="text-sm font-bold text-gray-700 dark:text-gray-200">Mulai ide atau planning baru</p>
            <p className="text-xs text-gray-400 max-w-xs leading-relaxed">
              Diskusi bebas dengan AI. History tersimpan per percakapan, dan bisa langsung jadi task OP kapanpun.
            </p>
            <button onClick={newChat}
              className="mt-1 flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-xs font-semibold"
              style={{ background: 'linear-gradient(135deg, #1d3a5c, #2a5298)' }}>
              <Plus size={12} /> Create new
            </button>
          </div>
        ) : (
          <>
            {/* header */}
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, #1d3a5c, #2a5298)' }}><Lightbulb size={14} /></div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold text-gray-800 dark:text-gray-100 truncate">{activeTitle || 'New conversation'}</p>
                <p className="text-[10px] text-gray-400">
                  {messages.length} messages · {activeOpId ? `linked OP #${activeOpId}` : 'not linked to OP'}
                </p>
              </div>
              <div className="flex gap-1.5 flex-shrink-0">
                <button onClick={extractPoints} disabled={extracting || !messages.length}
                  title="AI ekstrak poin penting → centang mana yang beneran task → kirim ke Daily Hub. Brainstorm yang nggak relevan nggak ikut."
                  className="px-3 py-1.5 rounded-md text-[10px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition">
                  <span className="flex items-center gap-1">{extracting ? 'Mengekstrak…' : <><Sparkles size={10} /> Ekstrak poin → task</>}</span>
                </button>
              </div>
            </div>

            {/* messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center gap-2.5">
                  <p className="text-xs text-gray-400">Apa yang mau kamu rencanakan?</p>
                  {aiReady === false && (
                    <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-center max-w-xs">
                      <p className="text-[10px] font-bold text-red-700">❌ AI belum dikonfigurasi</p>
                      <a href="/settings" className="text-[10px] text-red-600 underline">Buka Settings</a>
                    </div>
                  )}
                  {aiReady && (
                    <div className="w-full max-w-sm space-y-1.5 mt-1">
                      {SUGGESTIONS.map(s => (
                        <button key={s} onClick={() => setInput(s)}
                          className="w-full text-left text-[11px] px-3 py-2 rounded-xl border border-gray-100 dark:border-gray-700 text-gray-500 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 transition">
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : messages.map(msg => (
                <div key={msg.id} className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : ''} ${msg.role === 'user' ? 'ml-auto' : ''}`} style={{ maxWidth: '85%', marginLeft: msg.role === 'user' ? 'auto' : undefined }}>
                  <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5 ${
                    msg.role === 'user' ? 'bg-indigo-100 text-indigo-600' : 'text-white'
                  }`} style={msg.role === 'assistant' ? { background: 'linear-gradient(135deg, #1d3a5c, #2a5298)' } : {}}>
                    {msg.role === 'user' ? 'R' : <Bot size={12} />}
                  </div>
                  <div className={`px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed ${
                    msg.role === 'user'
                      ? 'text-white rounded-tr-sm'
                      : 'bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 border border-gray-100 dark:border-gray-700 rounded-tl-sm'
                  }`} style={msg.role === 'user' ? { background: 'linear-gradient(135deg, #1d3a5c, #2a5298)' } : {}}>
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
              ))}
              <div ref={bottomRef} />
            </div>

            {/* input */}
            <div className="flex-shrink-0 p-3 border-t border-gray-100 dark:border-gray-800">
              <div className="flex gap-2 items-end">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder={aiReady === false ? 'Konfigurasi AI dulu…' : 'Tulis ide atau pertanyaan… (Enter kirim, Shift+Enter baris baru)'}
                  disabled={!aiReady || aiReady === null}
                  rows={1}
                  className="flex-1 resize-none rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3.5 py-2.5 text-xs text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition disabled:opacity-40 max-h-28 overflow-y-auto"
                  style={{ minHeight: '40px' }}
                  onInput={e => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 112) + 'px' }}
                />
                {streaming ? (
                  <button onClick={() => { abortRef.current?.abort(); setStreaming(false) }}
                    className="flex-shrink-0 w-9 h-9 rounded-xl bg-red-100 text-red-500 flex items-center justify-center">■</button>
                ) : (
                  <button onClick={() => send(input)} disabled={!input.trim() || !aiReady}
                    className="flex-shrink-0 w-9 h-9 rounded-xl text-white flex items-center justify-center text-base disabled:opacity-30 transition"
                    style={{ background: 'linear-gradient(135deg, #1d3a5c, #2a5298)' }}>↑</button>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Extract review panel */}
      {candidates && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setCandidates(null)}>
          <div className="w-full max-w-md max-h-[80%] flex flex-col bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
              <p className="text-sm font-bold text-gray-800 dark:text-gray-100">Pilih poin untuk jadi task</p>
              <p className="text-[10px] text-gray-400 mt-0.5">Centang yang beneran task. <span className="text-indigo-500 font-semibold">TASK</span> sudah dicentang otomatis, <span className="text-gray-400 font-semibold">NOTE</span> dianggap brainstorm.</p>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
              {candidates.map((c, i) => (
                <label key={i} className={`flex items-start gap-2.5 px-3 py-2 rounded-xl border cursor-pointer transition ${
                  c.sel ? 'border-indigo-200 bg-indigo-50/50 dark:border-indigo-800 dark:bg-indigo-950/20' : 'border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                }`}>
                  <input type="checkbox" checked={c.sel}
                    onChange={() => setCandidates(prev => prev!.map((x, j) => j === i ? { ...x, sel: !x.sel } : x))}
                    className="mt-0.5 accent-indigo-600" />
                  <div className="flex-1 min-w-0">
                    <span className={`text-[8px] font-bold uppercase tracking-wide px-1.5 py-px rounded ${
                      c.kind === 'task' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500'
                    }`}>{c.kind === 'task' ? 'Task' : 'Note'}</span>
                    <p className="text-xs text-gray-700 dark:text-gray-200 mt-1 leading-snug">{c.text}</p>
                  </div>
                </label>
              ))}
            </div>
            <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between gap-2">
              <span className="text-[10px] text-gray-400">{candidates.filter(c => c.sel).length} terpilih</span>
              <div className="flex gap-2">
                <button onClick={() => setCandidates(null)}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition">Batal</button>
                <button onClick={sendSelected}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition">→ Kirim ke Daily Hub</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] bg-gray-900 text-white text-xs font-semibold px-4 py-2.5 rounded-lg shadow-xl">
          {toast}
        </div>
      )}
    </div>
  )
}
