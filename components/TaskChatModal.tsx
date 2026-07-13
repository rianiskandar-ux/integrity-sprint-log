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
  onPushed?: (sessionId: string, taskId: number) => void  // called after a successful OP push
  onAddToQueue?: (bullets: string[]) => void
  embedded?: boolean      // render just the panel (no fixed overlay) to host inside a ChatDock tab
}

export default function TaskChatModal({ task, onClose, onPushed, onAddToQueue, embedded }: Props) {
  const [messages,  setMessages]  = useState<Message[]>([])
  const [input,     setInput]     = useState('')
  const [streaming, setStreaming] = useState(false)
  const [loading,   setLoading]   = useState(true)
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const streamingIdRef = useRef<string | null>(null)
  const messagesRef = useRef<Message[]>([])
  const [opContext, setOpContext] = useState<string>('')
  const [pushing, setPushing]     = useState(false)
  const [pushResult, setPushResult] = useState<string | null>(null)
  // Activity Log Sync — ringkas chat (English) → comment ke activity log ticket OP
  const [activityBusy, setActivityBusy]   = useState<'generating' | 'sending' | null>(null)
  const [activityDraft, setActivityDraft] = useState<string | null>(null)
  const [ticketLog, setTicketLog] = useState<{ totalMins: number; count: number } | null>(null)

  // Total time already logged on this ticket (sum across all sessions for opTaskId)
  useEffect(() => {
    if (!task.opTaskId) { setTicketLog(null); return }
    function load() {
      fetch(`/api/isl/sessions?taskId=${task.opTaskId}`)
        .then(r => r.json())
        .then(d => {
          const ss = (d.sessions ?? []) as { actualMins?: number | null; estimatedMins?: number | null; pushStatus?: string }[]
          const live = ss.filter(s => s.pushStatus !== 'discarded')
          const totalMins = live.reduce((a, s) => a + (s.actualMins ?? s.estimatedMins ?? 0), 0)
          setTicketLog(live.length ? { totalMins, count: live.length } : null)
        })
        .catch(() => {})
    }
    load()
    // Refresh when a timer stops (actual may have changed)
    const onStopped = () => load()
    window.addEventListener('isl:timer-stopped', onStopped)
    return () => window.removeEventListener('isl:timer-stopped', onStopped)
  }, [task.opTaskId])

  // Per-chat model picker — default Claude CLI (local subscription, free)
  const [aiProvider, setAiProvider] = useState('claude-cli')
  const [aiModel,    setAiModel]    = useState('claude')
  const [aiModels,   setAiModels]   = useState<Record<string, string[]>>({ 'claude-cli': ['claude'] })

  useEffect(() => {
    // Model list is caller-aware (owner vs non-owner) — the hardcoded 'claude-cli'
    // default above only works for the owner. If it's not actually in the returned
    // list (non-owner without claude-cli access), switch to whatever IS available.
    fetch('/api/ai-chat')
      .then(r => r.json())
      .then(d => {
        if (!d.models) return
        setAiModels(d.models)
        setAiProvider(prevProvider => {
          if (d.models[prevProvider]?.length) return prevProvider
          const firstProvider = Object.keys(d.models)[0]
          if (firstProvider) {
            setAiModel(d.models[firstProvider][0])
            return firstProvider
          }
          return prevProvider
        })
      })
      .catch(() => {})
  }, [])

  // Fetch konteks LIVE dari ticket OP (desc, hierarki, komentar, lampiran) saat buka
  useEffect(() => {
    if (!task.opTaskId) return
    fetch(`/api/op/wp-context?wpId=${task.opTaskId}`)
      .then(r => r.json())
      .then(d => { if (d.text) setOpContext(d.text) })
      .catch(() => {})
  }, [task.opTaskId])

  // Load existing chat history. opTaskId is passed so the server can fall back
  // to this ticket's existing chat row even when this surface uses another id.
  useEffect(() => {
    const greeting = buildGreeting(task)
    const opQ = task.opTaskId ? `?opTaskId=${task.opTaskId}` : ''
    fetch(`/api/chat/history/${encodeURIComponent(task.id)}${opQ}`)
      .then(r => r.json())
      .then(d => {
        if (d.chat?.messages?.length) {
          setMessages(d.chat.messages.map((m: { role: string; content: string }, i: number) => ({
            ...m, id: `hist-${i}`
          })))
        } else {
          setMessages([{ role: 'assistant', id: 'greeting', content: greeting }])
        }
      })
      .catch(() => {
        setMessages([{ role: 'assistant', id: 'greeting', content: greeting }])
      })
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id])

  useEffect(() => { messagesRef.current = messages }, [messages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function buildGreeting(t: TaskChatContext): string {
    const lines = [`Hi! I'm ready to help you continue this task:`]
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
    streamingIdRef.current = assistantId
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
          provider: aiProvider,
          model:    aiModel,
          taskContext: {
            id:        task.id,
            title:     task.title,
            opTaskId:  task.opTaskId,
            opStoryId: task.opStoryId,
            sprintName:task.sprintName,
            status:    task.status,
            bullets:   task.bullets,
            opContext, // konteks live dari ticket OP
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

      // Persist to server — use ref to avoid stale closure over messages snapshot
      const allMsgs = [...messagesRef.current, userMsg, { role: 'assistant' as const, content: full, id: assistantId }]
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
      streamingIdRef.current = null
      abortRef.current = null
    }
  }, [messages, input, streaming, task, opContext, aiProvider, aiModel])

  // Extract progress bullets from the latest assistant turn (fallback to session bullets)
  function bulletsFromChat(): string[] {
    const lastAsst = [...messagesRef.current].reverse().find(m => m.role === 'assistant' && m.id !== 'greeting')
    let bullets: string[] = []
    if (lastAsst) {
      bullets = lastAsst.content.split('\n')
        .filter(l => /^[-•*]\s+/.test(l) || /^\d+\.\s+/.test(l))
        .map(l => l.replace(/^[-•*\d.]+\s+/, '').trim())
        .filter(l => l.length > 3)
      if (bullets.length === 0) bullets = [lastAsst.content.slice(0, 200).split('\n')[0]]
    }
    if (bullets.length === 0) bullets = task.bullets?.length ? task.bullets : [`Update: ${task.title}`]
    return bullets
  }

  // Push this session to OP. For a session linked to an existing ticket (opTaskId,
  // e.g. an Incoming follow-up) this logs a worklog/comment to that ticket directly.
  async function pushToOp() {
    if (pushing) return
    if (!task.opTaskId) {
      setPushResult('Session ini belum terhubung ke ticket OP. Buka Push Queue → pilih "Link existing" / "Create new" untuk tentukan ticket-nya.')
      return
    }
    setPushing(true); setPushResult(null)
    try {
      const r = await fetch('/api/op/push-session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: task.id, action: 'link_existing', opTaskId: task.opTaskId, bullets: bulletsFromChat() }),
      }).then(res => res.json())
      if (r.error) throw new Error(r.error)
      const tid = r.taskId ?? task.opTaskId
      setPushResult(`Pushed ke OP #${tid}`)
      onPushed?.(task.id, tid)
    } catch (e) {
      setPushResult(`⚠️ Gagal push: ${String(e).slice(0, 140)}`)
    } finally {
      setPushing(false)
    }
  }

  // Activity Log Sync: generate an ENGLISH summary of this chat (preview, editable)
  async function generateActivitySummary() {
    if (!task.opTaskId || activityBusy) return
    const msgs = messagesRef.current
      .filter(m => m.id !== 'greeting' && m.content.trim())
      .map(m => ({ role: m.role, content: m.content }))
    if (!msgs.length) { setPushResult('Belum ada percakapan untuk diringkas.'); return }
    setActivityBusy('generating'); setPushResult(null)
    try {
      const r = await fetch('/api/op/activity-summary', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opTaskId: task.opTaskId, messages: msgs, mode: 'preview' }),
      }).then(res => res.json())
      if (r.error) throw new Error(r.error)
      setActivityDraft((r.summary as string) ?? '')
    } catch (e) {
      setPushResult(`⚠️ Gagal buat ringkasan: ${String(e).slice(0, 140)}`)
    } finally {
      setActivityBusy(null)
    }
  }

  // Kirim ringkasan (yang mungkin sudah diedit) sebagai comment di activity log OP
  async function sendActivitySummary() {
    if (!task.opTaskId || activityBusy || !activityDraft?.trim()) return
    setActivityBusy('sending')
    try {
      const r = await fetch('/api/op/activity-summary', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opTaskId: task.opTaskId, mode: 'post', summary: activityDraft.trim() }),
      }).then(res => res.json())
      if (r.error) throw new Error(r.error)
      setActivityDraft(null)
      setPushResult(`✓ Terkirim ke OP #${task.opTaskId}`)
    } catch (e) {
      setPushResult(`⚠️ Gagal kirim ke OP: ${String(e).slice(0, 140)}`)
    } finally {
      setActivityBusy(null)
    }
  }

  const typeLabel = task.taskType === 'incoming' ? 'Incoming' : task.taskType === 'session' ? 'Push Queue' : 'New'

  return (
    <div
      className={embedded
        ? 'w-full h-full flex flex-col'
        : 'fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4'}
      onClick={embedded ? undefined : (e => { if (e.target === e.currentTarget) onClose() })}>
      <div
        className={embedded
          ? 'bg-white dark:bg-gray-900 w-full h-full flex flex-col overflow-hidden'
          : 'bg-white dark:bg-gray-900 w-full sm:max-w-xl sm:rounded-2xl shadow-2xl flex flex-col'}
        style={embedded ? undefined : { height: '90vh', maxHeight: '720px' }}>

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
            {ticketLog && (
              <p className="text-[10px] text-emerald-200/90 mt-0.5">
                ⏱ {ticketLog.totalMins >= 60 ? `${Math.floor(ticketLog.totalMins / 60)}j ${ticketLog.totalMins % 60}m` : `${ticketLog.totalMins}m`} tercatat · {ticketLog.count} session
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('isl:start-timer', { detail: { taskTitle: task.title, sessionId: task.taskType === 'session' ? task.id : null, opTaskId: task.opTaskId ?? null } }))}
              title="Mulai timer untuk task ini (ukur waktu actual)"
              className="text-[11px] font-bold px-2.5 py-1 rounded-lg text-white border border-white/30 hover:bg-white/20 transition">
              ▶ Timer
            </button>
            {task.taskType === 'session' && (
              <button onClick={pushToOp} disabled={pushing}
                title={task.opTaskId ? `Push worklog ke OP #${task.opTaskId}` : 'Pilih ticket di Push Queue dulu'}
                className="text-[11px] font-bold px-3 py-1 rounded-lg text-white border border-white/30 hover:bg-white/20 transition disabled:opacity-50">
                {pushing ? 'Pushing…' : (task.opTaskId ? `Push #${task.opTaskId}` : 'Push to OP')}
              </button>
            )}
            {task.opTaskId && (
              <button onClick={generateActivitySummary} disabled={activityBusy !== null}
                title={`Ringkas chat ini (English) → comment di activity log OP #${task.opTaskId}`}
                className="text-[11px] font-bold px-2.5 py-1 rounded-lg text-white border border-white/30 hover:bg-white/20 transition disabled:opacity-50">
                {activityBusy === 'generating' ? 'Menyusun…' : '📝 Update Activity'}
              </button>
            )}
            {task.taskType === 'incoming' && onAddToQueue && (
              <button onClick={() => {
                const reversed = [...messagesRef.current].reverse()
                const lastAsst = reversed.find(m => m.role === 'assistant' && m.id !== 'greeting')
                let bullets: string[] = []
                if (lastAsst) {
                  const lines = lastAsst.content.split('\n')
                  bullets = lines
                    .filter(l => /^[-•*]\s+/.test(l) || /^\d+\.\s+/.test(l))
                    .map(l => l.replace(/^[-•*\d.]+\s+/, '').trim())
                    .filter(l => l.length > 3)
                  if (bullets.length === 0) bullets = [lastAsst.content.slice(0, 200).split('\n')[0]]
                }
                if (bullets.length === 0) bullets = [`Discussion: ${task.title}`]
                onAddToQueue(bullets)
              }}
                className="text-[11px] font-bold px-3 py-1 rounded-lg text-white border border-white/30 hover:bg-white/20 transition">
                ➕ Add to Queue
              </button>
            )}
            <button onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-white/70 hover:text-white hover:bg-white/20 transition">
              ✕
            </button>
          </div>
        </div>

        {/* Push result banner */}
        {pushResult && (
          <div className={`px-3 py-1.5 text-[11px] border-b flex items-center justify-between gap-2 ${
            pushResult.startsWith('Pushed') || pushResult.startsWith('✓')
              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-900'
              : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-100 dark:border-amber-900'
          }`}>
            <span className="flex-1">{pushResult}</span>
            <button onClick={() => setPushResult(null)} className="opacity-60 hover:opacity-100">✕</button>
          </div>
        )}

        {/* Activity Log Sync — preview ringkasan (editable) sebelum dikirim ke OP */}
        {activityDraft !== null && task.opTaskId && (
          <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 bg-blue-50/60 dark:bg-blue-950/20 space-y-1.5">
            <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Ringkasan Activity (English) — edit sebelum kirim
            </p>
            <textarea
              value={activityDraft}
              onChange={e => setActivityDraft(e.target.value)}
              rows={6}
              className="w-full text-[11px] leading-relaxed rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300 resize-y" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setActivityDraft(null)} disabled={activityBusy === 'sending'}
                className="text-[11px] px-3 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition disabled:opacity-50">
                Batal
              </button>
              <button onClick={sendActivitySummary} disabled={activityBusy === 'sending' || !activityDraft.trim()}
                className="text-[11px] font-bold px-3 py-1 rounded-lg text-white transition disabled:opacity-50"
                style={{ background: BRAND }}>
                {activityBusy === 'sending' ? 'Mengirim…' : `Kirim ke OP #${task.opTaskId}`}
              </button>
            </div>
          </div>
        )}

        {/* Model picker */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/60">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Model</span>
          <select
            value={`${aiProvider}::${aiModel}`}
            onChange={e => { const [p, m] = e.target.value.split('::'); setAiProvider(p); setAiModel(m) }}
            className="flex-1 text-[11px] px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-300">
            {Object.entries(aiModels).map(([prov, list]) => (
              <optgroup key={prov} label={prov === 'claude-cli' ? 'Claude CLI (gratis)' : prov}>
                {list.map(m => <option key={`${prov}::${m}`} value={`${prov}::${m}`}>{m}</option>)}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
            </div>
          ) : messages.map(m => {
            const isStreamingThis = streaming && m.id === streamingIdRef.current
            return (
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
                    : 'text-gray-800 dark:text-gray-200 rounded-tl-sm border border-gray-100 dark:border-gray-700 dark:bg-gray-800'
                }`}
                  style={m.role === 'user' ? { background: BRAND } : undefined}>
                  {m.content
                    ? m.content
                    : isStreamingThis
                      ? <span className="inline-flex gap-1 py-1">
                          <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                        </span>
                      : null}
                </div>
              </div>
            )
          })}
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
