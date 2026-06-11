'use client'
import { useState, useEffect } from 'react'
import { PROVIDER_KEY_HINTS, FREE_PROVIDERS, PROVIDER_LABELS, DEFAULT_MODELS, type LLMProvider } from '@/lib/llm-providers'

const BRAND = '#1d3a5c'

export default function SettingsPage() {
  const [displayName,  setDisplayName]  = useState('')
  const [opToken,      setOpToken]      = useState('')
  const [llmProvider,  setLlmProvider]  = useState<LLMProvider>('anthropic')
  const [llmApiKey,    setLlmApiKey]    = useState('')
  const [llmModel,     setLlmModel]     = useState('')
  const [opMode,       setOpMode]       = useState<'live' | 'test'>('live')
  const [autoSync,     setAutoSync]     = useState(false)
  const [opTokenSet,   setOpTokenSet]   = useState(false)
  const [llmKeySet,    setLlmKeySet]    = useState(false)

  const [availModels,   setAvailModels]   = useState<{ id: string; label: string }[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError,   setModelsError]   = useState('')

  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [error,   setError]   = useState('')

  useEffect(() => {
    fetch('/api/user-config').then(r => r.json()).then(d => {
      setDisplayName(d.displayName ?? '')
      setLlmProvider((d.llmProvider as LLMProvider) || 'anthropic')
      setLlmModel(d.llmModel ?? '')
      setOpTokenSet(d.opTokenSet || d.opTokenSource === 'env')
      setLlmKeySet(d.llmApiKeySet || d.anthropicKeySource === 'env')
    })
    fetch('/api/op/mode').then(r => r.json()).then(d => {
      setOpMode(d.mode === 'test' ? 'test' : 'live')
      setAutoSync(!!d.autoSync)
    }).catch(() => {})
  }, [])

  // Auto-fetch models when provider has a saved key
  useEffect(() => {
    if (llmKeySet && !llmApiKey) fetchModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llmProvider, llmKeySet])

  async function fetchModels(keyOverride?: string) {
    setModelsLoading(true); setModelsError('')
    const key = keyOverride ?? llmApiKey
    const url = key
      ? `/api/llm/models?provider=${llmProvider}&key=${encodeURIComponent(key)}`
      : `/api/llm/models?provider=${llmProvider}`
    try {
      const res  = await fetch(url)
      const data = await res.json()
      if (data.models?.length) {
        setAvailModels(data.models)
        // If current model not in list, reset to first
        if (llmModel && !data.models.find((m: { id: string }) => m.id === llmModel)) {
          setLlmModel('')
        }
      } else {
        setModelsError(data.error ?? 'Tidak ada model ditemukan')
      }
    } catch { setModelsError('Gagal menghubungi provider') }
    setModelsLoading(false)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(''); setSaved(false)

    const body: Record<string, string> = { displayName, llmProvider, llmModel }
    if (opToken.trim())   body.opToken   = opToken.trim()
    if (llmApiKey.trim()) body.llmApiKey = llmApiKey.trim()

    const [cfgRes] = await Promise.all([
      fetch('/api/user-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      fetch('/api/op/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: opMode, autoSync }),
      }).catch(() => {}),
    ])

    const data = await cfgRes.json()
    if (!cfgRes.ok) { setError(data.error ?? 'Gagal menyimpan') }
    else {
      setSaved(true)
      if (opToken.trim())   setOpTokenSet(true)
      if (llmApiKey.trim()) { setLlmKeySet(true); fetchModels(llmApiKey.trim()) }
      setOpToken(''); setLlmApiKey('')
      setTimeout(() => setSaved(false), 3000)
    }
    setSaving(false)
  }

  async function handleSync() {
    setSyncing(true); setSyncMsg('')
    try {
      const res  = await fetch('/api/op/cache', { method: 'POST' })
      const data = await res.json()
      setSyncMsg(data.ok ? '✓ Cache diperbarui' : `Gagal: ${data.error}`)
    } catch { setSyncMsg('Network error') }
    setSyncing(false)
    setTimeout(() => setSyncMsg(''), 4000)
  }

  const pInfo    = PROVIDER_KEY_HINTS[llmProvider]
  const isFree   = FREE_PROVIDERS.includes(llmProvider)
  const isOllama = llmProvider === 'ollama'
  const is9Router = llmProvider === '9router'
  const isNoKey  = isOllama || is9Router
  const defaultModel = DEFAULT_MODELS[llmProvider]

  // Models to show: fetched list takes priority, else just show default
  const modelOptions = availModels.length > 0 ? availModels : [{ id: defaultModel, label: `${defaultModel} (default)` }]
  const activeModel  = llmModel || defaultModel

  return (
    <div className="min-h-screen p-6" style={{ background: '#f0f4f8' }}>
      <div className="max-w-md mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold" style={{ color: BRAND }}>Pengaturan Pribadi</h1>
          <p className="text-sm text-gray-500 mt-1">Konfigurasi akun kamu — disimpan lokal di PC ini</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-5 mb-4">
          <form onSubmit={handleSave} className="space-y-4">

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nama</label>
              <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)}
                placeholder="Nama kamu"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1" />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium text-gray-700">OpenProject API Token</label>
                <span className={`text-xs px-2 py-0.5 rounded-full ${opTokenSet ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                  {opTokenSet ? 'Aktif ✓' : 'Belum diset'}
                </span>
              </div>
              <input type="password" value={opToken} onChange={e => setOpToken(e.target.value)}
                placeholder={opTokenSet ? 'Isi untuk mengganti token' : 'opapi-…'}
                autoComplete="off"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1" />
              <p className="text-xs text-gray-400 mt-1">OpenProject → My Account → Access Tokens</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">AI Provider</label>
              <select value={llmProvider}
                onChange={e => { setLlmProvider(e.target.value as LLMProvider); setLlmApiKey(''); setLlmModel(''); setAvailModels([]) }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1">
                {(Object.keys(PROVIDER_KEY_HINTS) as LLMProvider[]).map(key => (
                  <option key={key} value={key}>
                    {PROVIDER_LABELS[key]}{FREE_PROVIDERS.includes(key) ? ' ✦ gratis' : ''}
                  </option>
                ))}
              </select>
              {pInfo && (
                <p className={`text-xs mt-1 ${isFree ? 'text-green-700' : 'text-gray-400'}`}>
                  {isOllama ? '📦 Lokal & offline — pastikan Ollama berjalan'
                   : is9Router ? '🔀 9Router jalan di localhost:20128 — tidak perlu API key'
                   : isFree ? `🆓 Gratis — ${pInfo.hint}`
                   : `🔑 ${pInfo.hint}`}
                </p>
              )}
            </div>

            {!isNoKey && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium text-gray-700">{pInfo?.label || 'API Key'}</label>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${llmKeySet ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {llmKeySet ? 'Aktif ✓' : 'Opsional'}
                  </span>
                </div>
                <input type="password" value={llmApiKey}
                  onChange={e => { setLlmApiKey(e.target.value); setAvailModels([]); setModelsError('') }}
                  placeholder={llmKeySet ? 'Isi untuk mengganti key' : (pInfo?.placeholder || 'sk-…')}
                  autoComplete="off"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1" />
              </div>
            )}

            {/* Model — dynamic dropdown */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium text-gray-700">Model</label>
                <button type="button" onClick={() => fetchModels()}
                  disabled={modelsLoading || (!llmKeySet && !llmApiKey && !isNoKey)}
                  className="text-xs text-blue-600 hover:underline disabled:text-gray-400 disabled:no-underline">
                  {modelsLoading ? 'Memuat…' : '↻ Detect model'}
                </button>
              </div>
              <select value={activeModel}
                onChange={e => setLlmModel(e.target.value === defaultModel ? '' : e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1">
                {modelOptions.map(m => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
              {modelsError && <p className="text-xs text-red-500 mt-1">{modelsError}</p>}
              {!modelsError && availModels.length === 0 && (llmKeySet || llmApiKey || isNoKey) && !modelsLoading && (
                <p className="text-xs text-gray-400 mt-1">
                  {is9Router ? 'Klik "Detect model" untuk lihat model dari 9Router' : 'Klik "Detect model" untuk lihat semua model yang tersedia'}
                </p>
              )}
              {availModels.length > 0 && (
                <p className="text-xs text-green-600 mt-1">{availModels.length} model terdeteksi dari {PROVIDER_LABELS[llmProvider]}</p>
              )}
            </div>

            {/* Mode & AutoSync */}
            <div className="border border-gray-200 rounded-lg p-3 space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Sinkronisasi OP</p>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-700">Mode</p>
                  <p className="text-xs text-gray-400">{opMode === 'live' ? 'Push ke OP nyata' : 'Test — tidak ada yang dikirim ke OP'}</p>
                </div>
                <button type="button" onClick={() => setOpMode(m => m === 'live' ? 'test' : 'live')}
                  className={`relative inline-flex h-6 w-11 rounded-full transition-colors ${opMode === 'live' ? 'bg-green-500' : 'bg-gray-300'}`}>
                  <span className={`inline-block h-5 w-5 mt-0.5 rounded-full bg-white shadow transition-transform ${opMode === 'live' ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-700">Auto Sync Cache</p>
                  <p className="text-xs text-gray-400">Perbarui data OP otomatis saat buka app</p>
                </div>
                <button type="button" onClick={() => setAutoSync(v => !v)}
                  className={`relative inline-flex h-6 w-11 rounded-full transition-colors ${autoSync ? 'bg-blue-500' : 'bg-gray-300'}`}>
                  <span className={`inline-block h-5 w-5 mt-0.5 rounded-full bg-white shadow transition-transform ${autoSync ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>
            </div>

            {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}
            {saved  && <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3">✓ Tersimpan</div>}

            <button type="submit" disabled={saving}
              className="w-full py-2.5 rounded-lg text-white font-medium text-sm"
              style={{ background: BRAND, opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Menyimpan…' : 'Simpan'}
            </button>
          </form>
        </div>

        {/* Telegram Notifications */}
        <TelegramSection />

        <div className="bg-white rounded-xl shadow-sm p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-700">Sync Cache dengan OP</p>
            <p className="text-xs text-gray-400">Ambil ulang tasks, sprints, epics dari OpenProject</p>
          </div>
          <button onClick={handleSync} disabled={syncing}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white flex-shrink-0"
            style={{ background: syncing ? '#9ca3af' : BRAND }}>
            {syncing ? 'Syncing…' : 'Sync Sekarang'}
          </button>
        </div>
        {syncMsg && <p className={`text-xs text-center mt-2 ${syncMsg.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>{syncMsg}</p>}

        <p className="text-xs text-gray-400 text-center mt-4">
          Data tidak dikirim ke server manapun — tersimpan lokal di PC ini saja.
        </p>
      </div>
    </div>
  )
}

// ── Telegram Section ──────────────────────────────────────────────────────────
function TelegramSection() {
  const [botToken,  setBotToken]  = useState('')
  const [chatId,    setChatId]    = useState('')
  const [enabled,   setEnabled]   = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [testing,   setTesting]   = useState(false)
  const [msg,       setMsg]       = useState('')
  const [configured, setConfigured] = useState(false)

  useEffect(() => {
    fetch('/api/telegram').then(r => r.json()).then(d => {
      setEnabled(d.enabled ?? false)
      setChatId(d.chatId ?? '')
      setConfigured(d.configured ?? false)
    }).catch(() => {})
  }, [])

  async function save() {
    setSaving(true); setMsg('')
    await fetch('/api/telegram', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botToken: botToken || undefined, chatId, enabled }),
    })
    setSaving(false); setConfigured(!!(botToken || configured) && !!chatId)
    setMsg('✓ Tersimpan'); setTimeout(() => setMsg(''), 3000)
  }

  async function test() {
    setTesting(true); setMsg('')
    const cfg = await fetch('/api/user-config').then(r => r.json())
    const res = await fetch('/api/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: true, data: { botToken: botToken || cfg.telegramBotToken, chatId: chatId || cfg.telegramChatId } }),
    }).then(r => r.json())
    setTesting(false)
    setMsg(res.ok ? '✓ Pesan test terkirim! Cek Telegram kamu.' : '✗ Gagal — cek token & chat ID')
  }

  return (
    <div className="bg-white rounded-xl shadow-sm p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-xl" style={{ background: '#e8f4fd' }}>
          ✈️
        </div>
        <div>
          <p className="text-sm font-bold text-gray-800">Telegram Notifications</p>
          <p className="text-xs text-gray-400">Notif push ke HP via Telegram bot</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {configured && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-50 text-green-600">Configured</span>}
          <button type="button" onClick={() => setEnabled(v => !v)}
            className={`relative inline-flex h-6 w-11 rounded-full transition-colors ${enabled ? 'bg-blue-500' : 'bg-gray-300'}`}>
            <span className={`inline-block h-5 w-5 mt-0.5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-gray-600">Bot Token</label>
          <input
            type="password"
            value={botToken}
            onChange={e => setBotToken(e.target.value)}
            placeholder={configured ? '••••••• (sudah tersimpan)' : 'Dari @BotFather — 7431234567:AAF...'}
            className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">Chat ID</label>
          <input
            type="text"
            value={chatId}
            onChange={e => setChatId(e.target.value)}
            placeholder="1234567890"
            className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <p className="text-[10px] text-gray-400 mt-1">Dari api.telegram.org/bot&lt;TOKEN&gt;/getUpdates → chat.id</p>
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={save} disabled={saving}
          className="flex-1 py-2 rounded-lg text-xs font-bold text-white transition disabled:opacity-50"
          style={{ background: '#1d3a5c' }}>
          {saving ? 'Menyimpan…' : 'Simpan'}
        </button>
        <button onClick={test} disabled={testing || (!configured && !botToken)}
          className="flex-1 py-2 rounded-lg text-xs font-bold border border-gray-200 text-gray-600 hover:bg-gray-50 transition disabled:opacity-40">
          {testing ? 'Mengirim…' : '🔔 Test Notif'}
        </button>
      </div>

      {msg && (
        <p className={`text-xs text-center font-medium ${msg.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>{msg}</p>
      )}

      <div className="text-[10px] text-gray-400 space-y-0.5">
        <p>Notif yang akan dikirim:</p>
        <p>• 📥 Incoming task baru dari OP</p>
        <p>• 📤 Session menunggu push</p>
        <p>• ✅ Session berhasil di-push ke OP</p>
        <p>• 🏃 Sprint deadline (3 hari & 1 hari sebelum)</p>
      </div>
    </div>
  )
}
