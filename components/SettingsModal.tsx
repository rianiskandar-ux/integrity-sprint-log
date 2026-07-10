'use client'

import { useState, useEffect } from 'react'
import {
  TEAM_MEMBERS, loadSettings, saveSettings,
  loadAppConfig, saveAppConfig,
  type UserSettings, type SprintVersion, type AppConfig,
} from '@/lib/op-config'
import { useI18n } from '@/lib/i18n'

interface Props {
  open: boolean
  onClose: () => void
  onSaved: () => void
}

type Tab = 'user' | 'app' | 'integrations'

export default function SettingsModal({ open, onClose, onSaved }: Props) {
  const [tab, setTab] = useState<Tab>('user')
  const [settings, setSettings] = useState<UserSettings | null>(null)
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null)
  const [versions, setVersions] = useState<SprintVersion[]>([])
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [saved, setSaved] = useState(false)
  const [gcalConnected, setGcalConnected] = useState<boolean | null>(null)
  const [googleProfile, setGoogleProfile] = useState<{ name: string; email: string } | null>(null)
  // Manual paste flow — for teammates on other PCs, where Google bounces the
  // callback to localhost on THEIR machine (dead end page holding the code).
  const [gcalPaste, setGcalPaste] = useState('')
  const [gcalPasteBusy, setGcalPasteBusy] = useState(false)
  const [gcalPasteMsg, setGcalPasteMsg] = useState('')
  const isRemoteClient = typeof window !== 'undefined' && !['localhost', '127.0.0.1'].includes(window.location.hostname)

  async function submitGcalPaste() {
    if (!gcalPaste.trim() || gcalPasteBusy) return
    setGcalPasteBusy(true); setGcalPasteMsg('')
    try {
      const res = await fetch('/api/auth/google/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pasted: gcalPaste }),
      })
      const d = await res.json()
      if (d.ok) {
        setGcalConnected(true)
        setGcalPaste(''); setGcalPasteMsg('')
        if (d.profile?.email) setGoogleProfile({ name: d.profile.name ?? '', email: d.profile.email })
      } else {
        setGcalPasteMsg(d.error || 'Gagal — coba ulangi dari tombol Connect.')
      }
    } catch {
      setGcalPasteMsg('Gagal — cek koneksi.')
    } finally {
      setGcalPasteBusy(false)
    }
  }
  const [cacheStatus, setCacheStatus] = useState<{ lastSync: string | null; tasks: number; stories: number; incoming: number } | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [allProjects, setAllProjects] = useState<{ id: number; name: string; identifier: string }[]>([])
  const [allUsers, setAllUsers] = useState<{ id: number; name: string }[]>([])
  const { t } = useI18n()

  // Personal AI provider (Phase 1a multi-user): teammate's own cloud provider + key,
  // separate from the owner-only Claude CLI above. 'ollama' is allowed here — it's
  // their OWN LAN-reachable Ollama (baseUrl, no API key), never the owner's local one.
  const PERSONAL_PROVIDERS = ['openai', 'google', 'groq', 'openrouter', 'mistral', 'together', 'ollama'] as const
  const [personalIsOwner, setPersonalIsOwner] = useState<boolean | null>(null)
  const [personalProvider, setPersonalProvider] = useState<string>('openai')
  const [personalModel, setPersonalModel] = useState('')
  const [personalApiKey, setPersonalApiKey] = useState('')
  const [personalApiKeySet, setPersonalApiKeySet] = useState(false)
  const [personalBaseUrl, setPersonalBaseUrl] = useState('')
  const [personalConfigured, setPersonalConfigured] = useState(false)
  const [personalSaving, setPersonalSaving] = useState(false)
  const [personalSaved, setPersonalSaved] = useState(false)
  const [personalError, setPersonalError] = useState('')

  function loadPersonalLLM() {
    fetch('/api/settings/personal-llm').then(r => r.json()).then(d => {
      setPersonalIsOwner(!!d.isOwner)
      if (d.provider) { setPersonalProvider(d.provider); setPersonalConfigured(true) } else { setPersonalConfigured(false) }
      setPersonalModel(d.model ?? '')
      setPersonalApiKeySet(!!d.apiKeySet)
      setPersonalBaseUrl(d.baseUrl ?? '')
    }).catch(() => {})
  }

  async function handleSavePersonalLLM() {
    setPersonalError('')
    if (personalProvider === 'ollama') {
      if (!personalBaseUrl.trim()) { setPersonalError('Base URL Ollama wajib diisi (contoh: http://192.168.1.50:11434).'); return }
    } else if (!personalApiKey.trim()) {
      setPersonalError('API key wajib diisi.'); return
    }
    setPersonalSaving(true)
    try {
      const res = await fetch('/api/settings/personal-llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: personalProvider, apiKey: personalApiKey, model: personalModel, baseUrl: personalBaseUrl }),
      })
      const d = await res.json()
      if (!res.ok) { setPersonalError(d.error || 'Gagal menyimpan.'); return }
      setPersonalApiKey('')
      setPersonalSaved(true)
      loadPersonalLLM()
      setTimeout(() => setPersonalSaved(false), 1500)
    } catch {
      setPersonalError('Gagal menyimpan — cek koneksi.')
    } finally {
      setPersonalSaving(false)
    }
  }

  async function handleDeletePersonalLLM() {
    setPersonalSaving(true)
    try {
      await fetch('/api/settings/personal-llm', { method: 'DELETE' })
      setPersonalApiKey('')
      setPersonalModel('')
      setPersonalBaseUrl('')
      loadPersonalLLM()
    } finally {
      setPersonalSaving(false)
    }
  }

  // Auto-capture key (Claude Code hook attribution — per user)
  const [captureKey, setCaptureKey] = useState<string | null>(null)
  const [captureKeyBusy, setCaptureKeyBusy] = useState(false)

  function loadCaptureKey() {
    fetch('/api/settings/capture-key').then(r => r.json()).then(d => setCaptureKey(d.captureKey ?? null)).catch(() => {})
  }
  async function generateCaptureKey() {
    setCaptureKeyBusy(true)
    try {
      const d = await fetch('/api/settings/capture-key', { method: 'POST' }).then(r => r.json())
      if (d.ok) setCaptureKey(d.captureKey)
    } finally { setCaptureKeyBusy(false) }
  }

  useEffect(() => {
    if (open) {
      setSettings(loadSettings())
      setAppConfig(loadAppConfig())
      setSaved(false)
      // Multi-user: identity is the logged-in session, not localStorage. Override so the
      // "I am" selector + cache sync use the real member, never a stale Rian default.
      fetch('/api/auth/me').then(r => r.json()).then(d => {
        if (d.multiUser && d.user) {
          setSettings(prev => prev ? { ...prev, userId: d.user.opUserId, userName: d.user.name, userHref: `/api/v3/users/${d.user.opUserId}` } : prev)
        }
      }).catch(() => {})
      fetch('/api/calendar/events?days=1').then(r => r.json()).then(d => setGcalConnected(d.connected)).catch(() => setGcalConnected(false))
      fetch('/api/auth/profile').then(r => r.json()).then(d => setGoogleProfile(d.profile ?? null)).catch(() => {})
      fetch('/api/op/cache').then(r => r.json()).then(d => setCacheStatus({ lastSync: d.lastSync, tasks: d.myOpenTasks?.length ?? 0, stories: d.userStories?.length ?? 0, incoming: d.incomingTasks?.length ?? 0 })).catch(() => {})
      fetch('/api/op/projects').then(r => r.json()).then(d => setAllProjects(d.projects ?? [])).catch(() => {})
      fetch('/api/op/users?q=').then(r => r.json()).then(d => setAllUsers((d.users ?? []).map((u: { id: number; name: string }) => ({ id: u.id, name: u.name })))).catch(() => {})
      loadPersonalLLM()
      loadCaptureKey()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open || !settings) return
    setLoadingVersions(true)
    fetch(`/api/op/versions?project=${settings.defaultProjectIdentifier}`)
      .then((r) => r.json())
      .then((d) => { setVersions(d.versions ?? []); setLoadingVersions(false) })
      .catch(() => setLoadingVersions(false))
  }, [open, settings?.defaultProjectIdentifier])

  function updateUser<K extends keyof UserSettings>(key: K, val: UserSettings[K]) {
    setSettings((prev) => prev ? { ...prev, [key]: val } : prev)
  }

  function updateApp<K extends keyof AppConfig>(key: K, val: AppConfig[K]) {
    setAppConfig((prev) => prev ? { ...prev, [key]: val } : prev)
  }

  function handleUserChange(userId: number) {
    const member = TEAM_MEMBERS.find((m) => m.id === userId)
    if (!member) return
    setSettings((prev) => prev ? { ...prev, userId: member.id, userName: member.name, userHref: member.href } : prev)
  }

  function handleSave() {
    if (settings) saveSettings(settings)
    if (appConfig) saveAppConfig(appConfig)
    setSaved(true)
    setTimeout(() => { onSaved(); onClose() }, 800)
  }

  if (!open || !settings || !appConfig) return null

  const currentSprint = versions.find((v) => v.isCurrent)

  const inp = "w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
  const sel = "w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50"
  const lbl = "text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block"
  const sec = "text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3"
  const card = "p-3 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h2 className="font-bold text-gray-900 dark:text-gray-100 text-base">{t('settings.title')}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{t('settings.subtitle')}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">×</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 dark:border-gray-800">
          {(['user', 'integrations', 'app'] as Tab[]).map((tabKey) => (
            <button key={tabKey} onClick={() => setTab(tabKey)}
              className={`flex-1 py-2.5 text-xs font-semibold transition ${tab === tabKey ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-500' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
            >
              {tabKey === 'user' ? t('settings.tab_profile') : tabKey === 'integrations' ? t('settings.tab_integrations') : t('settings.tab_app')}
            </button>
          ))}
        </div>

        <div className="px-6 py-5 space-y-5 max-h-[60vh] overflow-y-auto">

          {/* USER TAB */}
          {tab === 'user' && (
            <>
              <section>
                <h3 className={sec}>{t('settings.identity')}</h3>
                <div className="space-y-3">
                  <label className="block">
                    <span className={lbl}>{t('settings.i_am')}</span>
                    <select value={settings.userId} onChange={(e) => handleUserChange(Number(e.target.value))} className={sel}>
                      {(() => {
                        // Full OP user list (like Default Accountable), and always
                        // include the logged-in user even if not in that list.
                        const src = allUsers.length > 0 ? allUsers : TEAM_MEMBERS
                        const opts = src.some(m => m.id === settings.userId)
                          ? src
                          : [{ id: settings.userId, name: settings.userName || `User ${settings.userId}` }, ...src]
                        return opts.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)
                      })()}
                    </select>
                  </label>
                  <label className="block">
                    <span className={lbl}>{t('settings.accountable')}</span>
                    <select value={settings.defaultAccountableId ?? ''} onChange={(e) => updateUser('defaultAccountableId', e.target.value ? Number(e.target.value) : null)} className={sel}>
                      <option value="">{t('settings.accountable_self')}</option>
                      {(allUsers.length > 0 ? allUsers : TEAM_MEMBERS).filter((m) => m.id !== settings.userId).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                    <p className="text-xs text-gray-400 mt-1">{t('settings.accountable_hint')}</p>
                  </label>
                </div>
              </section>

              <section>
                <h3 className={sec}>{t('settings.openproject')}</h3>
                <div className="space-y-3">
                  <div>
                    <span className={lbl}>
                      {t('settings.projects_watched')} {allProjects.length > 0 && <span className="text-gray-400 font-normal">({allProjects.length} {t('settings.from_op')})</span>}
                    </span>
                    <div className="space-y-1.5 mt-1 max-h-48 overflow-y-auto pr-1">
                      {(allProjects.length > 0 ? allProjects : (settings.watchedProjects ?? []).map(id => ({ id: 0, name: id, identifier: id }))).map((p) => {
                        const watched = settings.watchedProjects ?? []
                        const active = watched.includes(p.identifier)
                        return (
                          <button key={p.identifier} type="button"
                            onClick={() => {
                              const cur = settings.watchedProjects ?? []
                              updateUser('watchedProjects', active ? cur.filter(x => x !== p.identifier) : [...cur, p.identifier])
                            }}
                            className={`w-full text-left px-3 py-2 rounded-lg border transition text-xs flex items-center justify-between ${active ? 'bg-indigo-50 dark:bg-indigo-950 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300'}`}>
                            <span className="font-medium">{p.name}</span>
                            {active && <span className="text-indigo-500 text-xs font-bold">✓</span>}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <label className="block">
                    <span className={lbl}>
                      {t('settings.sprint_active')}
                      {currentSprint && <span className="ml-2 text-emerald-600 dark:text-emerald-400">● {currentSprint.name}</span>}
                    </span>
                    <select value={settings.defaultVersionId ?? ''} onChange={(e) => updateUser('defaultVersionId', e.target.value ? Number(e.target.value) : null)} disabled={loadingVersions} className={sel}>
                      <option value="">{t('settings.sprint_auto')}</option>
                      {versions.slice(0, 15).map((v) => (
                        <option key={v.id} value={v.id}>{v.name} ({v.startDate} → {v.endDate}){v.isCurrent ? ' ★' : ''}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className={lbl}>{t('settings.api_token')}</span>
                    <input type="password" value={settings.opApiToken} onChange={(e) => updateUser('opApiToken', e.target.value)}
                      placeholder={`opapi-xxxxxxxx (${t('settings.api_token_hint')})`} className={inp} />
                  </label>
                </div>
              </section>
            </>
          )}

          {/* INTEGRATIONS TAB */}
          {tab === 'integrations' && (
            <>
              <section>
                <h3 className={sec}>{t('settings.gcal_title')}</h3>
                <div className={`flex items-center justify-between ${card}`}>
                  <div>
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {gcalConnected === null ? t('settings.gcal_checking') : gcalConnected ? t('settings.gcal_connected') : t('settings.gcal_not')}
                    </p>
                    {googleProfile && <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5 font-medium">{googleProfile.name} · {googleProfile.email}</p>}
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {gcalConnected ? t('settings.gcal_hint_on') : t('settings.gcal_hint_off')}
                    </p>
                  </div>
                  {gcalConnected
                    ? <button onClick={async () => { await fetch('/api/calendar/events', { method: 'DELETE' }); await fetch('/api/auth/profile', { method: 'DELETE' }); setGcalConnected(false); setGoogleProfile(null) }}
                        className="text-xs text-red-500 hover:text-red-600 border border-red-200 dark:border-red-800 px-3 py-1.5 rounded-lg transition">{t('common.disconnect')}</button>
                    : <a href="/api/auth/google" target="_blank" rel="noopener noreferrer"
                        onClick={() => {
                          const iv = setInterval(() => {
                            fetch('/api/calendar/events?days=1').then(r => r.json()).then(d => {
                              if (d.connected) { setGcalConnected(true); clearInterval(iv); fetch('/api/auth/profile').then(r=>r.json()).then(d=>setGoogleProfile(d.profile??null)) }
                            }).catch(()=>{})
                          }, 2000)
                          setTimeout(() => clearInterval(iv), 120000)
                        }}
                        className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition">{t('common.connect')}</a>
                  }
                </div>
                {!gcalConnected && isRemoteClient && (
                  <div className={`${card} mt-2 space-y-2`}>
                    <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                      Akses dari PC lain? Connect Google butuh 1 langkah ekstra:
                    </p>
                    <ol className="text-xs text-gray-500 dark:text-gray-400 list-decimal ml-4 space-y-0.5">
                      <li>Klik Connect di atas → login &amp; izinkan di Google seperti biasa</li>
                      <li>Browser akan nyasar ke halaman <code>localhost:4891</code> yang <strong>error</strong> — itu normal</li>
                      <li>Copy <strong>seluruh URL</strong> dari address bar halaman error itu, paste di bawah (cepat — code kedaluwarsa dalam beberapa menit)</li>
                    </ol>
                    <div className="flex gap-2">
                      <input
                        value={gcalPaste}
                        onChange={(e) => setGcalPaste(e.target.value)}
                        placeholder="http://localhost:4891/api/auth/callback/google?code=…"
                        className={`${inp} flex-1`}
                      />
                      <button onClick={submitGcalPaste} disabled={gcalPasteBusy || !gcalPaste.trim()}
                        className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition disabled:opacity-50 flex-shrink-0">
                        {gcalPasteBusy ? 'Memproses…' : 'Selesaikan'}
                      </button>
                    </div>
                    {gcalPasteMsg && <p className="text-xs text-red-500">{gcalPasteMsg}</p>}
                  </div>
                )}
              </section>

              <section>
                <h3 className={sec}>🔑 Model AI Pribadi</h3>
                {personalIsOwner ? (
                  <div className={card}>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Anda owner — pakai Claude CLI/Ollama bawaan, tidak perlu ini.
                    </p>
                  </div>
                ) : (
                  <div className={`${card} space-y-3`}>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Pakai provider AI &amp; API key Anda sendiri (mis. Gemini/OpenAI) untuk chat AI di ISL — terpisah dari kredensial owner instance.
                    </p>
                    {personalConfigured && (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400">
                        ✓ Aktif: {personalProvider}{personalModel ? ` · ${personalModel}` : ''}
                      </p>
                    )}
                    <label className="block">
                      <span className={lbl}>Provider</span>
                      <select value={personalProvider} onChange={(e) => setPersonalProvider(e.target.value)} className={sel}>
                        {PERSONAL_PROVIDERS.map((p) => <option key={p} value={p}>{p === 'ollama' ? 'ollama (lokal Anda sendiri)' : p}</option>)}
                      </select>
                    </label>
                    {personalProvider === 'ollama' ? (
                      <label className="block">
                        <span className={lbl}>Base URL Ollama Anda</span>
                        <input value={personalBaseUrl} onChange={(e) => setPersonalBaseUrl(e.target.value)}
                          placeholder="http://192.168.1.50:11434" className={inp} />
                        <span className="text-[11px] text-gray-400 mt-1 block">
                          Ollama harus jalan di mesin Anda dan reachable dari server ISL (LAN, bukan localhost mesin Anda sendiri). Tidak perlu API key.
                        </span>
                      </label>
                    ) : (
                      <label className="block">
                        <span className={lbl}>API Key {personalApiKeySet && <span className="text-emerald-500 font-normal">(tersimpan ✓ — isi ulang untuk mengganti)</span>}</span>
                        <input type="password" value={personalApiKey} onChange={(e) => setPersonalApiKey(e.target.value)}
                          placeholder={personalApiKeySet ? '••••••••••• (biarkan kosong kalau tidak ganti)' : 'API key Anda'} className={inp} />
                      </label>
                    )}
                    <label className="block">
                      <span className={lbl}>Model (opsional)</span>
                      <input value={personalModel} onChange={(e) => setPersonalModel(e.target.value)}
                        placeholder="default otomatis" className={inp} />
                    </label>
                    {personalError && <p className="text-xs text-red-500">{personalError}</p>}
                    <div className="flex items-center gap-2">
                      <button onClick={handleSavePersonalLLM} disabled={personalSaving}
                        className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition disabled:opacity-50">
                        {personalSaving ? 'Menyimpan...' : personalSaved ? 'Tersimpan ✓' : 'Simpan'}
                      </button>
                      {personalConfigured && (
                        <button onClick={handleDeletePersonalLLM} disabled={personalSaving}
                          className="text-xs text-red-500 hover:text-red-600 border border-red-200 dark:border-red-800 px-3 py-1.5 rounded-lg transition disabled:opacity-50">
                          Hapus
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </section>

              <section>
                <h3 className={sec}>🪝 Auto-Capture (Hook Claude Code)</h3>
                <div className={`${card} space-y-3`}>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Kalau Anda pakai Claude Code di laptop sendiri, hook ini otomatis mencatat sesi kerja ke ISL
                    sebagai <strong>akun Anda</strong>. Generate key, lalu pasang di laptop Anda.
                  </p>
                  {captureKey ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <code className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1.5 rounded font-mono flex-1 break-all">{captureKey}</code>
                        <button onClick={() => navigator.clipboard?.writeText(captureKey)}
                          className="text-xs text-indigo-600 border border-indigo-200 dark:border-indigo-800 px-2.5 py-1.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950 transition flex-shrink-0">
                          Copy
                        </button>
                      </div>
                      <details className="text-xs text-gray-500 dark:text-gray-400">
                        <summary className="cursor-pointer font-semibold">Cara pasang di laptop Anda</summary>
                        <ol className="list-decimal ml-4 mt-1.5 space-y-1">
                          <li>Copy file <code>hooks/isl-context.mjs</code> dari repo ISL ke laptop Anda</li>
                          <li>Di <code>~/.claude/settings.json</code>, tambahkan di <code>env</code>: <code>{'"ISL_URL": "http://10.30.112.87:4891", "KAFI_API_KEY": "<key di atas>"'}</code></li>
                          <li>Tambahkan hook <code>Stop</code>: <code>{'"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "node <path>/isl-context.mjs"}]}]}'}</code></li>
                          <li>Selesai — tiap sesi Claude Code selesai, kerjaan Anda otomatis tercatat di ISL sebagai Anda</li>
                        </ol>
                      </details>
                      <button onClick={generateCaptureKey} disabled={captureKeyBusy}
                        className="text-xs text-amber-600 border border-amber-200 dark:border-amber-800 px-3 py-1.5 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-950 transition disabled:opacity-50">
                        {captureKeyBusy ? 'Membuat…' : '↻ Regenerate (key lama mati)'}
                      </button>
                    </div>
                  ) : (
                    <button onClick={generateCaptureKey} disabled={captureKeyBusy}
                      className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition disabled:opacity-50">
                      {captureKeyBusy ? 'Membuat…' : 'Generate Capture Key'}
                    </button>
                  )}
                </div>
              </section>

              <section>
                <h3 className={sec}>{t('settings.cache_title')}</h3>
                <div className={`${card} space-y-3`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                        {cacheStatus?.lastSync
                          ? `✅ Last sync: ${new Date(cacheStatus.lastSync).toLocaleString('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                          : t('settings.cache_never')}
                      </p>
                      {cacheStatus?.lastSync && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{cacheStatus.stories} {t('settings.user_stories')} · {cacheStatus.tasks} {t('settings.open_tasks')} · {cacheStatus.incoming} incoming</p>
                      )}
                    </div>
                    <button disabled={syncing}
                      onClick={async () => {
                        if (!settings) return
                        setSyncing(true)
                        const res = await fetch('/api/op/cache', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projects: settings.watchedProjects?.length ? settings.watchedProjects : ['integritys-websites', 'know-your-vendor-kyv'] }) })
                        const d = await res.json()
                        setCacheStatus({ lastSync: d.lastSync, tasks: d.myOpenTasks?.length ?? 0, stories: d.userStories?.length ?? 0, incoming: d.incomingTasks?.length ?? 0 })
                        setSyncing(false)
                      }}
                      className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition disabled:opacity-50">
                      {syncing ? t('common.syncing') : t('common.sync_now')}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t('settings.cache_hint')}</p>
                </div>
              </section>
            </>
          )}

          {/* APP CONFIG TAB */}
          {tab === 'app' && (
            <>
              <section>
                <h3 className={sec}>{t('settings.branding')}</h3>
                <div className="space-y-3">
                  <div className="flex gap-3">
                    <label className="block w-20">
                      <span className={lbl}>{t('settings.logo')}</span>
                      <input value={appConfig.appLogo} onChange={(e) => updateApp('appLogo', e.target.value)} placeholder="🚀"
                        className={inp + " text-center"} />
                    </label>
                    <label className="block flex-1">
                      <span className={lbl}>{t('settings.app_name')}</span>
                      <input value={appConfig.appName} onChange={(e) => updateApp('appName', e.target.value)} className={inp} />
                    </label>
                  </div>
                  <label className="block">
                    <span className={lbl}>{t('settings.org_name')}</span>
                    <input value={appConfig.orgName} onChange={(e) => updateApp('orgName', e.target.value)} className={inp} />
                  </label>
                </div>
              </section>

              <section>
                <h3 className={sec}>{t('settings.links')}</h3>
                <div className="space-y-3">
                  <label className="block">
                    <span className={lbl}>{t('settings.org_url')}</span>
                    <input value={appConfig.orgUrl} onChange={(e) => updateApp('orgUrl', e.target.value)} placeholder="https://integrity-asia.com" className={inp} />
                  </label>
                  <label className="block">
                    <span className={lbl}>{t('settings.op_url')}</span>
                    <input value={appConfig.opUrl} onChange={(e) => updateApp('opUrl', e.target.value)} placeholder="https://tokek.integrity-asia.com" className={inp} />
                  </label>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className={lbl}>{t('settings.social_links')}</span>
                      <button onClick={() => updateApp('socialLinks', [...appConfig.socialLinks, { label: '', url: '' }])}
                        className="text-xs text-indigo-600 dark:text-indigo-400 hover:opacity-80">{t('settings.add_link')}</button>
                    </div>
                    {appConfig.socialLinks.map((link, i) => (
                      <div key={i} className="flex gap-2 mb-2">
                        <input value={link.label} onChange={(e) => { const u = [...appConfig.socialLinks]; u[i] = { ...u[i], label: e.target.value }; updateApp('socialLinks', u) }}
                          placeholder="Label" className="w-24 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                        <input value={link.url} onChange={(e) => { const u = [...appConfig.socialLinks]; u[i] = { ...u[i], url: e.target.value }; updateApp('socialLinks', u) }}
                          placeholder="https://..." className="flex-1 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                        <button onClick={() => updateApp('socialLinks', appConfig.socialLinks.filter((_, j) => j !== i))}
                          className="text-gray-400 hover:text-red-500 text-xs px-1">×</button>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          <button
            onClick={() => {
              if (confirm(t('settings.reset_confirm'))) {
                const s = loadSettings()
                saveSettings({ ...s, setupDone: false })
                onClose()
                window.location.reload()
              }
            }}
            className="text-xs text-gray-400 hover:text-red-500 transition"
          >
            ↺ {t('settings.reset_wizard')}
          </button>
          <button onClick={handleSave} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition">
            {saved ? t('common.saved') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
