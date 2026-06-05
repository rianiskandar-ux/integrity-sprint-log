'use client'

import { useState, useEffect } from 'react'
import {
  TEAM_MEMBERS, loadSettings, saveSettings,
  loadAppConfig, saveAppConfig,
  type UserSettings, type SprintVersion, type AppConfig,
} from '@/lib/op-config'
import { useI18n, LANG_OPTIONS } from '@/lib/i18n'

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
  const [cacheStatus, setCacheStatus] = useState<{ lastSync: string | null; tasks: number; stories: number } | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [allProjects, setAllProjects] = useState<{ id: number; name: string; identifier: string }[]>([])
  const [allUsers, setAllUsers] = useState<{ id: number; name: string }[]>([])
  const { t, lang, setLang } = useI18n()

  useEffect(() => {
    if (open) {
      setSettings(loadSettings())
      setAppConfig(loadAppConfig())
      setSaved(false)
      // Check gcal + cache status
      fetch('/api/calendar/events?days=1').then(r => r.json()).then(d => setGcalConnected(d.connected)).catch(() => setGcalConnected(false))
      fetch('/api/auth/profile').then(r => r.json()).then(d => setGoogleProfile(d.profile ?? null)).catch(() => {})
      fetch('/api/op/cache').then(r => r.json()).then(d => setCacheStatus({ lastSync: d.lastSync, tasks: d.myOpenTasks?.length ?? 0, stories: d.userStories?.length ?? 0 })).catch(() => {})
      fetch('/api/op/projects').then(r => r.json()).then(d => setAllProjects(d.projects ?? [])).catch(() => {})
      fetch('/api/op/users?q=').then(r => r.json()).then(d => setAllUsers((d.users ?? []).map((u: { id: number; name: string }) => ({ id: u.id, name: u.name })))).catch(() => {})
    }
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
                <h3 className={sec}>Identity</h3>
                <div className="space-y-3">
                  <label className="block">
                    <span className={lbl}>Saya adalah</span>
                    <select value={settings.userId} onChange={(e) => handleUserChange(Number(e.target.value))} className={sel}>
                      {TEAM_MEMBERS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className={lbl}>Accountable default</span>
                    <select value={settings.defaultAccountableId ?? ''} onChange={(e) => updateUser('defaultAccountableId', e.target.value ? Number(e.target.value) : null)} className={sel}>
                      <option value="">— Self (kosong = saya sendiri)</option>
                      {(allUsers.length > 0 ? allUsers : TEAM_MEMBERS).filter((m) => m.id !== settings.userId).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                    <p className="text-xs text-gray-400 mt-1">Biasanya Nicolas atau Aufa untuk QA</p>
                  </label>
                </div>
              </section>

              <section>
                <h3 className={sec}>OpenProject</h3>
                <div className="space-y-3">
                  <div>
                    <span className={lbl}>Projects yang dipantau {allProjects.length > 0 && <span className="text-gray-400 font-normal">({allProjects.length} dari OP)</span>}</span>
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
                      Sprint aktif
                      {currentSprint && <span className="ml-2 text-emerald-600 dark:text-emerald-400">● {currentSprint.name}</span>}
                    </span>
                    <select value={settings.defaultVersionId ?? ''} onChange={(e) => updateUser('defaultVersionId', e.target.value ? Number(e.target.value) : null)} disabled={loadingVersions} className={sel}>
                      <option value="">— Auto-detect dari tanggal</option>
                      {versions.slice(0, 15).map((v) => (
                        <option key={v.id} value={v.id}>{v.name} ({v.startDate} → {v.endDate}){v.isCurrent ? ' ★' : ''}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className={lbl}>API Token (opsional)</span>
                    <input type="password" value={settings.opApiToken} onChange={(e) => updateUser('opApiToken', e.target.value)}
                      placeholder="opapi-xxxxxxxx (kosong = pakai token server)" className={inp} />
                  </label>
                </div>
              </section>
            </>
          )}

          {/* INTEGRATIONS TAB */}
          {tab === 'integrations' && (
            <>
              <section>
                <h3 className={sec}>Google Calendar</h3>
                <div className={`flex items-center justify-between ${card}`}>
                  <div>
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {gcalConnected === null ? 'Checking…' : gcalConnected ? '✅ Connected' : '⚪ Not connected'}
                    </p>
                    {googleProfile && <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5 font-medium">{googleProfile.name} · {googleProfile.email}</p>}
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {gcalConnected ? 'Sprint Review events akan tampil di Sprint view' : 'Hubungkan untuk lihat jadwal Sprint Review'}
                    </p>
                  </div>
                  {gcalConnected
                    ? <button onClick={async () => { await fetch('/api/calendar/events', { method: 'DELETE' }); await fetch('/api/auth/profile', { method: 'DELETE' }); setGcalConnected(false); setGoogleProfile(null) }}
                        className="text-xs text-red-500 hover:text-red-600 border border-red-200 dark:border-red-800 px-3 py-1.5 rounded-lg transition">Disconnect</button>
                    : <a href="/api/auth/google" target="_blank" rel="noopener noreferrer"
                        onClick={() => {
                          const iv = setInterval(() => {
                            fetch('/api/calendar/events?days=1').then(r => r.json()).then(d => {
                              if (d.connected) { setGcalConnected(true); clearInterval(iv); fetch('/api/auth/profile').then(r=>r.json()).then(d=>setGoogleProfile(d.profile??null)) }
                            }).catch(()=>{})
                          }, 2000)
                          setTimeout(() => clearInterval(iv), 120000)
                        }}
                        className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition">Connect</a>
                  }
                </div>
              </section>

              <section>
                <h3 className={sec}>OpenProject Cache</h3>
                <div className={`${card} space-y-3`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                        {cacheStatus?.lastSync
                          ? `✅ Last sync: ${new Date(cacheStatus.lastSync).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                          : '⚪ Belum pernah sync'}
                      </p>
                      {cacheStatus?.lastSync && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{cacheStatus.stories} user stories · {cacheStatus.tasks} open tasks</p>
                      )}
                    </div>
                    <button disabled={syncing}
                      onClick={async () => {
                        if (!settings) return
                        setSyncing(true)
                        const res = await fetch('/api/op/cache', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: settings.userId, projects: settings.watchedProjects?.length ? settings.watchedProjects : ['integritys-websites', 'know-your-vendor-kyv'] }) })
                        const d = await res.json()
                        setCacheStatus({ lastSync: d.lastSync, tasks: d.myOpenTasks?.length ?? 0, stories: d.userStories?.length ?? 0 })
                        setSyncing(false)
                      }}
                      className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition disabled:opacity-50">
                      {syncing ? 'Syncing…' : '🔄 Sync Now'}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Auto-refresh setiap hari jam 09:30. Cache digunakan untuk picker User Story & Task saat tambah session.</p>
                </div>
              </section>
            </>
          )}

          {/* APP CONFIG TAB */}
          {tab === 'app' && (
            <>
              <section>
                <h3 className={sec}>{t('settings.language')}</h3>
                <div className="flex gap-2">
                  {LANG_OPTIONS.map(opt => (
                    <button key={opt.value} onClick={() => setLang(opt.value)}
                      className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition ${lang === opt.value ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300'}`}>
                      {opt.flag} {opt.label}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <h3 className={sec}>{t('settings.branding')}</h3>
                <div className="space-y-3">
                  <div className="flex gap-3">
                    <label className="block w-20">
                      <span className={lbl}>Logo</span>
                      <input value={appConfig.appLogo} onChange={(e) => updateApp('appLogo', e.target.value)} placeholder="🚀"
                        className={inp + " text-center"} />
                    </label>
                    <label className="block flex-1">
                      <span className={lbl}>App Name</span>
                      <input value={appConfig.appName} onChange={(e) => updateApp('appName', e.target.value)} className={inp} />
                    </label>
                  </div>
                  <label className="block">
                    <span className={lbl}>Organization Name</span>
                    <input value={appConfig.orgName} onChange={(e) => updateApp('orgName', e.target.value)} className={inp} />
                  </label>
                </div>
              </section>

              <section>
                <h3 className={sec}>Links</h3>
                <div className="space-y-3">
                  <label className="block">
                    <span className={lbl}>Org URL</span>
                    <input value={appConfig.orgUrl} onChange={(e) => updateApp('orgUrl', e.target.value)} placeholder="https://integrity-asia.com" className={inp} />
                  </label>
                  <label className="block">
                    <span className={lbl}>OpenProject URL</span>
                    <input value={appConfig.opUrl} onChange={(e) => updateApp('opUrl', e.target.value)} placeholder="https://tokek.integrity-asia.com" className={inp} />
                  </label>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className={lbl}>Social / Quick Links</span>
                      <button onClick={() => updateApp('socialLinks', [...appConfig.socialLinks, { label: '', url: '' }])}
                        className="text-xs text-indigo-600 dark:text-indigo-400 hover:opacity-80">+ Add</button>
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
          <p className="text-xs text-gray-400">Tersimpan di localStorage browser ini</p>
          <button onClick={handleSave} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition">
            {saved ? '✓ Tersimpan' : 'Simpan'}
          </button>
        </div>
      </div>
    </div>
  )
}
