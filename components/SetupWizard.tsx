'use client'

import { useState, useEffect, useRef } from 'react'
import { saveSettings, saveAppConfig, loadAppConfig, DEFAULT_SETTINGS } from '@/lib/op-config'
import { useI18n } from '@/lib/i18n'

interface Props { onDone: () => void }
interface OPUser { id: number; name: string; login: string }
interface GoogleProfile { name: string; email: string; picture?: string }

// Step 0: token → Step 1: identity → Step 2: projects → Step 3: gcal → Step 4: cache → Step 5: done
const STEPS = ['token', 'identity', 'projects', 'gcal', 'cache', 'done'] as const
type Step = typeof STEPS[number]

export default function SetupWizard({ onDone }: Props) {
  const [step, setStep] = useState<Step>('token')

  // Step: token
  const [apiToken, setApiToken]         = useState('')
  const [tokenStatus, setTokenStatus]   = useState<'idle' | 'checking' | 'ok' | 'error'>('idle')
  const [tokenUser, setTokenUser]       = useState<{ id: number; name: string } | null>(null)
  const [useServerToken, setUseServerToken] = useState(false)

  // Step: identity
  const [users, setUsers]               = useState<OPUser[]>([])
  const [userSearch, setUserSearch]     = useState('')
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [selectedUser, setSelectedUser] = useState<OPUser | null>(null)

  // Step: projects
  const [allProjects, setAllProjects] = useState<{ id: number; name: string; identifier: string }[]>([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [selectedProjects, setSelectedProjects] = useState<string[]>(['integritys-websites', 'know-your-vendor-kyv'])

  // Step: gcal
  const [gcalConnected, setGcalConnected] = useState(false)
  const [googleProfile, setGoogleProfile] = useState<GoogleProfile | null>(null)
  const gcalPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Step: cache
  const [syncing, setSyncing]     = useState(false)
  const [syncDone, setSyncDone]   = useState(false)

  const stepIdx = STEPS.indexOf(step)

  // Listen for GCal postMessage from popup tab
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.data === 'gcal-connected') {
        setGcalConnected(true)
        if (gcalPollRef.current) clearInterval(gcalPollRef.current)
        fetch('/api/auth/profile').then(r => r.json()).then(d => { if (d.profile) setGoogleProfile(d.profile) }).catch(() => {})
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Check gcal on mount
  useEffect(() => {
    fetch('/api/calendar/events?days=1').then(r => r.json()).then(d => setGcalConnected(d.connected)).catch(() => {})
    fetch('/api/auth/profile').then(r => r.json()).then(d => { if (d.profile) setGoogleProfile(d.profile) }).catch(() => {})
  }, [])

  // Load projects when on projects step
  useEffect(() => {
    if (step !== 'projects') return
    setLoadingProjects(true)
    const userIdParam = tokenUser?.id ? `&userId=${tokenUser.id}` : ''
    fetch(`/api/op/projects?token=${encodeURIComponent(useServerToken ? '' : apiToken)}${userIdParam}`)
      .then(r => r.json())
      .then(d => { setAllProjects(d.projects ?? []); setLoadingProjects(false) })
      .catch(() => setLoadingProjects(false))
  }, [step, apiToken, useServerToken])

  // Load users when on identity step
  useEffect(() => {
    if (step !== 'identity') return
    setLoadingUsers(true)
    const tokenToUse = useServerToken ? '' : apiToken
    fetch(`/api/op/users?q=${encodeURIComponent(userSearch)}&token=${encodeURIComponent(tokenToUse)}`)
      .then(r => r.json())
      .then(d => { setUsers(d.users ?? []); setLoadingUsers(false) })
      .catch(() => setLoadingUsers(false))
  }, [userSearch, step, apiToken, useServerToken])

  // Auto-select user if token verification returned a match
  useEffect(() => {
    if (tokenUser && users.length > 0) {
      const match = users.find(u => u.id === tokenUser.id) ?? users.find(u => u.name === tokenUser.name)
      if (match) setSelectedUser(match)
    }
  }, [users, tokenUser])

  async function verifyToken() {
    if (!apiToken.trim()) return
    setTokenStatus('checking')
    try {
      // Try to fetch current user info using this token
      const res = await fetch('/api/op/users/me', {
        headers: { 'x-op-token': apiToken.trim() },
      })
      const d = await res.json()
      if (d.id) {
        setTokenStatus('ok')
        setTokenUser({ id: d.id, name: d.name })
      } else {
        setTokenStatus('error')
      }
    } catch {
      setTokenStatus('error')
    }
  }

  function toggleProject(id: string) {
    setSelectedProjects(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id])
  }

  async function handleSync() {
    if (!selectedUser) return
    setSyncing(true)
    const token = useServerToken ? undefined : apiToken
    await fetch('/api/op/cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: selectedUser.id, projects: selectedProjects, token }),
    })
    setSyncing(false)
    setSyncDone(true)
  }

  function finish() {
    if (!selectedUser) return
    saveSettings({
      ...DEFAULT_SETTINGS,
      userId: selectedUser.id,
      userName: selectedUser.name,
      userHref: `/api/v3/users/${selectedUser.id}`,
      watchedProjects: selectedProjects,
      opApiToken: useServerToken ? '' : apiToken.trim(),
      setupDone: true,
    })
    saveAppConfig(loadAppConfig())
    onDone()
  }

  const { t } = useI18n()
  const inp = "w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"

  const stepLabels: Record<Step, string> = {
    token:    t('setup.title_token'),
    identity: t('setup.title_identity'),
    projects: t('setup.title_projects'),
    gcal:     t('setup.title_gcal'),
    cache:    t('setup.title_cache'),
    done:     t('setup.title_done'),
  }

  const canNextToken = useServerToken || tokenStatus === 'ok'

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">

        {/* Progress bar */}
        <div className="h-1 bg-gray-100 dark:bg-gray-800">
          <div className="h-full bg-indigo-500 transition-all duration-500" style={{ width: `${((stepIdx + 1) / STEPS.length) * 100}%` }} />
        </div>

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-lg flex-shrink-0">
              {step === 'token' ? '🔑' : step === 'identity' ? '👤' : step === 'projects' ? '📁' : step === 'gcal' ? '📅' : step === 'cache' ? '🔄' : '🎉'}
            </div>
            <div>
              <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest">{t('setup.step')} {stepIdx + 1}/{STEPS.length}</p>
              <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">{stepLabels[step]}</h2>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 min-h-[300px]">

          {/* ── STEP 1: Token ── */}
          {step === 'token' && (
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-300 space-y-1">
                <p className="font-semibold">{t('setup.token_warning')}</p>
                <p>{t('setup.token_reason')}</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  OpenProject API Token <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={apiToken}
                    onChange={e => { setApiToken(e.target.value); setTokenStatus('idle') }}
                    placeholder="opapi-xxxxxxxxxxxxxxxx"
                    className={inp}
                    onKeyDown={e => e.key === 'Enter' && verifyToken()}
                  />
                  <button
                    onClick={verifyToken}
                    disabled={!apiToken.trim() || tokenStatus === 'checking'}
                    className="px-3 py-2 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition whitespace-nowrap"
                  >
                    {tokenStatus === 'checking' ? '⏳' : t('common.verify')}
                  </button>
                </div>

                {tokenStatus === 'ok' && tokenUser && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1.5 font-semibold">
                    {t('setup.token_ok')} <span className="font-bold">{tokenUser.name}</span>
                  </p>
                )}
                {tokenStatus === 'error' && (
                  <p className="text-xs text-red-500 mt-1.5">{t('setup.token_error')}</p>
                )}
              </div>

              <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-400 space-y-1">
                <p className="font-semibold text-gray-700 dark:text-gray-300">{t('setup.token_how')}</p>
                <ol className="list-decimal pl-4 space-y-0.5">
                  <li>{t('setup.token_step1')} <span className="font-mono text-indigo-500">tokek.integrity-asia.com</span></li>
                  <li>{t('setup.token_step2')}</li>
                  <li>{t('setup.token_step3')}</li>
                  <li>{t('setup.token_step4')}</li>
                </ol>
              </div>

            </div>
          )}

          {/* ── STEP 2: Identity ── */}
          {step === 'identity' && (
            <div className="space-y-3">
              {tokenUser && !useServerToken && (
                <div className="flex items-center gap-2 p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800">
                  <span className="text-emerald-500 text-sm">✅</span>
                  <p className="text-xs text-emerald-700 dark:text-emerald-300">Token terdeteksi sebagai <strong>{tokenUser.name}</strong> — sudah dipilihkan otomatis di bawah.</p>
                </div>
              )}
              <p className="text-xs text-gray-500 dark:text-gray-400">Konfirmasi identitasmu di OpenProject.</p>
              <input value={userSearch} onChange={e => setUserSearch(e.target.value)}
                placeholder="Cari nama..." className={inp} autoFocus />
              <div className="max-h-52 overflow-y-auto space-y-1">
                {loadingUsers && <p className="text-xs text-gray-400 text-center py-4">Loading dari OP...</p>}
                {!loadingUsers && users.map(u => (
                  <button key={u.id} onClick={() => setSelectedUser(u)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-sm border transition ${selectedUser?.id === u.id
                      ? 'bg-indigo-50 dark:bg-indigo-950 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 font-semibold'
                      : 'border-gray-100 dark:border-gray-800 text-gray-700 dark:text-gray-300 hover:border-gray-200'}`}>
                    <span className="font-medium">{u.name}</span>
                    <span className="text-[11px] text-gray-400 ml-2">@{u.login}</span>
                    {u.id === tokenUser?.id && <span className="ml-2 text-[10px] bg-emerald-100 dark:bg-emerald-900 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded-full font-bold">Kamu</span>}
                  </button>
                ))}
                {!loadingUsers && users.length === 0 && <p className="text-xs text-gray-400 text-center py-4">Tidak ada user ditemukan</p>}
              </div>
            </div>
          )}

          {/* ── STEP 3: Projects ── */}
          {step === 'projects' && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">Pilih project OP yang kamu kerjakan. Cache task akan diambil dari project ini.</p>
              {loadingProjects
                ? <p className="text-xs text-gray-400 text-center py-8">Loading dari OP...</p>
                : <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                    {allProjects.map(p => (
                      <button key={p.identifier} onClick={() => toggleProject(p.identifier)}
                        className={`w-full text-left px-3 py-2.5 rounded-xl border transition ${selectedProjects.includes(p.identifier)
                          ? 'bg-indigo-50 dark:bg-indigo-950 border-indigo-300 dark:border-indigo-700'
                          : 'border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700'}`}>
                        <div className="flex items-center justify-between">
                          <span className={`text-sm font-medium ${selectedProjects.includes(p.identifier) ? 'text-indigo-700 dark:text-indigo-300' : 'text-gray-700 dark:text-gray-300'}`}>{p.name}</span>
                          {selectedProjects.includes(p.identifier) && <span className="text-indigo-500 text-xs font-bold">✓</span>}
                        </div>
                        <span className="text-[10px] text-gray-400">{p.identifier}</span>
                      </button>
                    ))}
                    {allProjects.length === 0 && <p className="text-xs text-gray-400 text-center py-4">Tidak ada project ditemukan</p>}
                  </div>
              }
              {selectedProjects.length > 0 && (
                <p className="text-[11px] text-indigo-500 font-semibold">{selectedProjects.length} project dipilih</p>
              )}
            </div>
          )}

          {/* ── STEP 4: GCal ── */}
          {step === 'gcal' && (
            <div className="space-y-4">
              <p className="text-xs text-gray-500 dark:text-gray-400">Hubungkan Google Calendar untuk lihat jadwal Sprint Review dan agenda meeting.</p>
              <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{gcalConnected ? '✅ Sudah terhubung' : '⚪ Belum terhubung'}</p>
                  {googleProfile && <p className="text-xs text-gray-500 mt-0.5">{googleProfile.name} · {googleProfile.email}</p>}
                  {!gcalConnected && <p className="text-xs text-gray-400 mt-0.5">Pakai akun Google kantor @integrity</p>}
                </div>
                {!gcalConnected
                  ? <a href="/api/auth/google" target="_blank" rel="noopener noreferrer"
                      onClick={() => {
                        if (gcalPollRef.current) clearInterval(gcalPollRef.current)
                        gcalPollRef.current = setInterval(() => {
                          fetch('/api/calendar/events?days=1').then(r => r.json()).then(d => {
                            if (d.connected) {
                              setGcalConnected(true)
                              clearInterval(gcalPollRef.current!)
                              fetch('/api/auth/profile').then(r => r.json()).then(d => { if (d.profile) setGoogleProfile(d.profile) }).catch(() => {})
                            }
                          }).catch(() => {})
                        }, 2000)
                        setTimeout(() => { if (gcalPollRef.current) clearInterval(gcalPollRef.current) }, 120000)
                      }}
                      className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition whitespace-nowrap">
                      Connect →
                    </a>
                  : <span className="text-xs text-emerald-600 font-bold">Connected ✓</span>
                }
              </div>
              <p className="text-xs text-gray-400">Tab baru akan terbuka untuk login Google. Tab menutup sendiri setelah berhasil. Bisa skip dan connect nanti di Settings.</p>
            </div>
          )}

          {/* ── STEP 5: Cache ── */}
          {step === 'cache' && (
            <div className="space-y-4">
              <p className="text-xs text-gray-500 dark:text-gray-400">Sync task & user story dari OP ke lokal. Dipakai untuk picker saat Add Session.</p>
              <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Project yang di-sync:</p>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {selectedProjects.map(p => (
                    <span key={p} className="px-2 py-0.5 text-[10px] bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 rounded-full font-medium">{p}</span>
                  ))}
                </div>
                {syncDone
                  ? <p className="text-sm text-emerald-600 font-semibold">✅ Sync selesai! Cache siap digunakan.</p>
                  : <button onClick={handleSync} disabled={syncing}
                      className="w-full py-2.5 text-sm font-semibold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition">
                      {syncing ? '⏳ Syncing dari OP...' : '🔄 Mulai Sync'}
                    </button>
                }
              </div>
              {!syncDone && <p className="text-xs text-gray-400">Bisa skip — cache auto-refresh setiap hari jam 09:30.</p>}
            </div>
          )}

          {/* ── STEP 6: Done ── */}
          {step === 'done' && (
            <div className="flex flex-col items-center justify-center h-full py-4 space-y-4 text-center">
              <div className="text-5xl">🎉</div>
              <div>
                <p className="text-base font-bold text-gray-900 dark:text-gray-100">Selamat datang, {selectedUser?.name?.split(' ')[0]}!</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Setup selesai. Siap tracking sprint.</p>
              </div>
              <div className="text-left w-full space-y-1.5 bg-gray-50 dark:bg-gray-800 p-4 rounded-xl text-xs text-gray-600 dark:text-gray-400">
                <p>✅ Token OP: <span className="font-semibold text-gray-800 dark:text-gray-200">Token pribadi — KPI teratribusi ke kamu</span></p>
                <p>✅ Identity: <span className="font-semibold text-gray-800 dark:text-gray-200">{selectedUser?.name}</span></p>
                <p>✅ Projects: <span className="font-semibold text-gray-800 dark:text-gray-200">{selectedProjects.length} project dipilih</span></p>
                <p>{gcalConnected ? '✅' : '⚪'} Google Calendar: {gcalConnected ? 'Connected' : 'Skip'}</p>
                <p>{syncDone ? '✅' : '⚪'} OP Cache: {syncDone ? 'Synced' : 'Auto sync jam 09:30'}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
          <button
            onClick={() => stepIdx > 0 && setStep(STEPS[stepIdx - 1])}
            className={`px-4 py-2 text-xs font-semibold rounded-xl border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition ${stepIdx === 0 ? 'invisible' : ''}`}
          >{t('common.back')}</button>

          {step === 'done'
            ? <button onClick={finish} className="px-6 py-2 text-xs font-bold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition">
                {t('setup.start_btn')}
              </button>
            : <div className="flex gap-2">
                {(step === 'gcal' || step === 'cache') && (
                  <button onClick={() => setStep(STEPS[stepIdx + 1])} className="px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-700 transition">
                    {t('common.skip')}
                  </button>
                )}
                <button
                  onClick={() => setStep(STEPS[stepIdx + 1])}
                  disabled={
                    (step === 'token' && !canNextToken) ||
                    (step === 'identity' && !selectedUser)
                  }
                  className="px-6 py-2 text-xs font-bold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-40 transition"
                >
                  {stepIdx === STEPS.length - 2 ? t('common.done') : t('common.next')}
                </button>
              </div>
          }
        </div>
      </div>
    </div>
  )
}
