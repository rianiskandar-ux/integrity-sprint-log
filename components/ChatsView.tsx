'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { MessageCircle, Plus, Sparkles, Lightbulb, Bot, AlertTriangle, Search, ChevronDown, ChevronRight } from 'lucide-react'

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

// OP work package status fetched in batch via /api/op/task-status-batch
interface OpTaskStatus {
  status: string
  isClosed: boolean
  sprintName: string | null
}

const ARCHIVE_AGE_MS = 30 * 86400_000 // last activity older than 30 days → Arsip

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

// Defensive cleanup for stored histories: drop empty/"..." assistant placeholder
// bubbles and consecutive duplicate user messages. This self-heals histories that
// were corrupted by the old save path (stuck stream placeholders, double-sends) —
// they render clean on load and get persisted clean on the next save.
function sanitizeHistory(raw: { role: string; content: string }[] | undefined | null): { role: 'user' | 'assistant'; content: string }[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = []
  for (const m of raw ?? []) {
    const role: 'user' | 'assistant' = m.role === 'user' ? 'user' : 'assistant'
    const content = String(m.content ?? '')
    const trimmed = content.trim()
    if (role === 'assistant' && (!trimmed || trimmed === '...' || trimmed === '…')) continue
    const prev = out[out.length - 1]
    if (prev && prev.role === 'user' && role === 'user' && prev.content.trim() === trimmed) continue
    out.push({ role, content })
  }
  return out
}

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
  // OP status per linked task id (batch-fetched) + current sprint name for the badge
  const [opStatuses, setOpStatuses] = useState<Record<number, OpTaskStatus>>({})
  const [currentSprintName, setCurrentSprintName] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [arsipOpen, setArsipOpen] = useState(false)
  // Last id-set already sent to the batch route — avoids refetch loops on list reloads
  const fetchedIdsRef = useRef('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)
  const abortRef  = useRef<AbortController | null>(null)
  // Always-current selected chat id (state can be stale inside async stream callbacks)
  const activeIdRef = useRef<string | null>(null)
  // Which chat the `messages` state currently belongs to — guards against sending
  // with another chat's messages still on screen right after switching chats.
  const loadedForRef = useRef<string | null>(null)
  // Live conversation of an in-flight stream, keyed by ITS chat id, so switching
  // away and back mid-stream shows the stream instead of the stale server copy.
  const liveStreamRef = useRef<{ id: string; msgs: Message[]; title: string } | null>(null)

  useEffect(() => { activeIdRef.current = activeId }, [activeId])

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

  // Batch-fetch OP status for all linked task ids whenever the chat list changes
  useEffect(() => {
    const ids = Array.from(new Set(
      chats.map(c => c.opTaskId).filter((x): x is number => typeof x === 'number' && x > 0)
    )).sort((a, b) => a - b)
    if (!ids.length) return
    const key = ids.join(',')
    if (fetchedIdsRef.current === key) return
    fetchedIdsRef.current = key
    fetch(`/api/op/task-status-batch?ids=${key}`)
      .then(r => r.json())
      .then(d => { if (d?.ok && d.statuses) setOpStatuses(prev => ({ ...prev, ...d.statuses })) })
      .catch(() => {})
  }, [chats])

  // Current sprint name — used to badge chats whose task sits in another sprint
  useEffect(() => {
    fetch('/api/op/versions')
      .then(r => r.json())
      .then(d => {
        const cur = (d.versions ?? []).find((v: { isCurrent?: boolean; name?: string }) => v.isCurrent)
        if (cur?.name) setCurrentSprintName(cur.name)
      })
      .catch(() => {})
  }, [])

  // Load active conversation
  useEffect(() => {
    if (!activeId) { setMessages([]); setActiveTitle(''); setActiveOpId(null); loadedForRef.current = null; return }
    // A stream in-flight for THIS chat owns its messages — show the live
    // conversation instead of the (stale) server copy.
    const live = liveStreamRef.current
    if (live?.id === activeId) {
      setMessages(live.msgs)
      setActiveTitle(live.title)
      loadedForRef.current = activeId
    }
    let stale = false
    fetch(`/api/chat/history/${activeId}`)
      .then(r => r.json())
      .then(d => {
        if (stale) return // user switched again — never apply an outdated response
        const chat = d.chat
        const streamingThis = liveStreamRef.current?.id === activeId
        if (chat) {
          setActiveOpId(chat.opTaskId ?? null)
          if (!streamingThis) {
            setActiveTitle(chat.title ?? 'Untitled')
            setMessages(sanitizeHistory(chat.messages).map((m, i) => ({ ...m, id: `h${i}` })))
          }
        } else if (!streamingThis) {
          setMessages([])
        }
        loadedForRef.current = activeId
      })
      .catch(() => {})
    return () => { stale = true }
  }, [activeId])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  function newChat() {
    const id = `chat-${Date.now().toString(36)}`
    activeIdRef.current = id
    loadedForRef.current = id // messages state ([]) now represents this chat
    setActiveId(id)
    setActiveTitle('New conversation')
    setActiveOpId(null)
    setMessages([])
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  function persist(id: string, title: string, msgs: Message[], opTaskId: number | null) {
    fetch(`/api/chat/history/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, taskType: 'idea', opTaskId, messages: msgs.map(m => ({ role: m.role, content: m.content })) }),
    }).then(() => loadList()).catch(() => {})
  }

  const send = useCallback(async (text: string) => {
    const content = text.trim()
    if (!content || streaming) return

    // Bind the ENTIRE send/stream/save lifecycle to the chat id captured NOW.
    // Switching chats mid-stream must never redirect tokens or the final save.
    let chatId = activeId
    if (!chatId) {
      chatId = `chat-${Date.now().toString(36)}`
      activeIdRef.current = chatId
      loadedForRef.current = chatId
      setActiveId(chatId)
    }
    setInput('')
    setStreaming(true)

    // Base history must belong to chatId. Right after a chat switch the displayed
    // messages can still be the PREVIOUS chat's (its load fetch not resolved yet)
    // — in that case fetch this chat's own history instead of trusting state.
    let base: Message[]
    let baseTitle = activeTitle
    let opId = activeOpId
    if (loadedForRef.current === chatId) {
      base = messages
    } else {
      const d = await fetch(`/api/chat/history/${chatId}`).then(r => r.json()).catch(() => null)
      const c = d?.chat
      base = sanitizeHistory(c?.messages).map((m, i) => ({ ...m, id: `h${i}` }))
      baseTitle = c?.title ?? ''
      opId = c?.opTaskId ?? null
    }

    // derive title from first user message if still default/new
    const title = (!baseTitle || baseTitle === 'New conversation')
      ? content.slice(0, 50) + (content.length > 50 ? '…' : '')
      : baseTitle
    if (activeIdRef.current === chatId && title !== activeTitle) setActiveTitle(title)

    const userMsg: Message = { role: 'user', content, id: Date.now().toString() }
    const assistantId = (Date.now() + 1).toString()
    // Local single source of truth for this send — never read back from shared state.
    let convo: Message[] = [...base, userMsg, { role: 'assistant', content: '', id: assistantId }]

    const syncUI = () => {
      liveStreamRef.current = { id: chatId!, msgs: convo, title }
      if (activeIdRef.current === chatId) setMessages(convo)
    }
    const setAssistant = (txt: string) => {
      convo = convo.map(m => m.id === assistantId ? { ...m, content: txt } : m)
      syncUI()
    }
    syncUI()
    abortRef.current = new AbortController()

    try {
      const history = [...base, userMsg].map(m => ({ role: m.role, content: m.content }))
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
        setAssistant(`[Error] ${friendly}`)
        return
      }
      const reader = res.body!.getReader()
      const dec = new TextDecoder()
      let full = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        full += dec.decode(value, { stream: true })
        setAssistant(full)
      }
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') setAssistant('[Error] Connection error.')
    } finally {
      setStreaming(false)
      abortRef.current = null
      // Never persist an empty "..." placeholder (e.g. stream aborted before any token)
      convo = convo.filter(m => !(m.role === 'assistant' && !m.content.trim()))
      liveStreamRef.current = null
      if (activeIdRef.current === chatId) setMessages(convo)
      // Save ONLY under the send-time chat id — if the user switched away this
      // updates that chat's stored history without touching the displayed chat.
      persist(chatId!, title, convo, opId)
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

  // ── Archive & OP status derivations ──────────────────────────────────────────
  const statusFor = (c: ChatSummary): OpTaskStatus | undefined =>
    c.opTaskId ? opStatuses[c.opTaskId] : undefined

  const isArchived = (c: ChatSummary): boolean => {
    if (statusFor(c)?.isClosed) return true
    const last = new Date(c.updatedAt || c.createdAt).getTime()
    return Number.isFinite(last) && Date.now() - last > ARCHIVE_AGE_MS
  }

  const q = search.trim().toLowerCase()
  const matchesSearch = (c: ChatSummary): boolean =>
    !q || c.title.toLowerCase().includes(q) || (c.opTaskId != null && String(c.opTaskId).includes(q))

  // AKTIF keeps the list's existing order (recent first); Arsip likewise
  const aktifChats = chats.filter(c => !isArchived(c) && matchesSearch(c))
  const arsipChats = chats.filter(c => isArchived(c) && matchesSearch(c))
  // Searching auto-expands arsip so matches from both groups are visible
  const showArsipItems = arsipOpen || (!!q && arsipChats.length > 0)

  // Active chat linked to a closed OP task → read-only archive mode
  const activeClosed = activeOpId != null && (opStatuses[activeOpId]?.isClosed ?? false)

  const renderChatItem = (c: ChatSummary) => {
    const tag = tagFor(c)
    const st = statusFor(c)
    const showSprintChip = st && !st.isClosed && st.sprintName && currentSprintName && st.sprintName !== currentSprintName
    const active = c.id === activeId
    return (
      <div key={c.id}
        onClick={() => setActiveId(c.id)}
        className={`group px-3.5 py-2.5 cursor-pointer border-l-2 transition ${
          active ? 'bg-white/12 border-blue-400' : 'border-transparent hover:bg-white/6'
        }`}>
        <div className="flex items-start gap-1.5">
          <p className={`flex-1 text-[11px] font-semibold truncate ${st?.isClosed ? 'text-white/55' : 'text-white/90'}`}>{c.title}</p>
          <button onClick={e => { e.stopPropagation(); delChat(c.id) }}
            className="opacity-0 group-hover:opacity-100 text-white/40 hover:text-red-400 text-[11px] transition flex-shrink-0">✕</button>
        </div>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <span className="text-[9px] text-white/40">{relTime(c.updatedAt)} · {c.msgCount} msg</span>
          {tag && <span className={`px-1.5 py-px rounded text-[8px] font-bold ${tag.cls}`}>{tag.label}</span>}
          {st?.isClosed && (
            <span className="px-1.5 py-px rounded text-[8px] font-bold bg-emerald-100 text-emerald-700">✓ Closed</span>
          )}
          {showSprintChip && (
            <span className="px-1.5 py-px rounded text-[8px] font-semibold bg-white/10 text-white/45 truncate max-w-[90px]">{st!.sprintName}</span>
          )}
        </div>
      </div>
    )
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
          <div className="relative mt-2">
            <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Cari judul / OP id…"
              className="w-full pl-7 pr-2.5 py-1.5 rounded-lg bg-white/10 border border-white/15 text-[11px] text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-transparent transition"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-1.5">
          {chats.length === 0 ? (
            <p className="text-[10px] text-white/30 text-center px-4 py-6 leading-relaxed">
              Belum ada percakapan.<br />Klik <strong className="text-white/50">Create new</strong> untuk mulai ide baru.
            </p>
          ) : (
            <>
              {/* AKTIF */}
              <p className="px-3.5 pt-1.5 pb-1 text-[9px] font-bold tracking-widest text-white/35">AKTIF</p>
              {aktifChats.length === 0 && !q && (
                <p className="px-3.5 pb-2 text-[10px] text-white/25">Tidak ada chat aktif</p>
              )}
              {aktifChats.map(renderChatItem)}

              {/* ARSIP — collapsed by default, items lazily rendered */}
              {arsipChats.length > 0 && (
                <button onClick={() => setArsipOpen(o => !o)}
                  className="w-full flex items-center gap-1 px-3.5 pt-3 pb-1 text-[9px] font-bold tracking-widest text-white/35 hover:text-white/60 transition">
                  {showArsipItems ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                  ARSIP · {arsipChats.length}
                </button>
              )}
              {showArsipItems && arsipChats.map(renderChatItem)}
              {q && aktifChats.length === 0 && arsipChats.length === 0 && (
                <p className="px-3.5 py-2 text-[10px] text-white/25">Tidak ada chat yang cocok.</p>
              )}
            </>
          )}
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
              {!activeClosed && (
                <div className="flex gap-1.5 flex-shrink-0">
                  <button onClick={extractPoints} disabled={extracting || !messages.length}
                    title="AI ekstrak poin penting → centang mana yang beneran task → kirim ke Daily Hub. Brainstorm yang nggak relevan nggak ikut."
                    className="px-3 py-1.5 rounded-md text-[10px] font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition">
                    <span className="flex items-center gap-1">{extracting ? 'Mengekstrak…' : <><Sparkles size={10} /> Ekstrak poin → task</>}</span>
                  </button>
                </div>
              )}
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

            {/* input — hidden when the linked OP task is closed (read-only archive) */}
            {activeClosed ? (
              <div className="flex-shrink-0 px-4 py-2.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60">
                <p className="text-[11px] text-gray-500 dark:text-gray-400 text-center">
                  🔒 Task sudah closed di OP — chat diarsipkan (read-only)
                </p>
              </div>
            ) : (
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
            )}
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
