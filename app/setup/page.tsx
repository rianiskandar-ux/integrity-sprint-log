'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PROVIDER_KEY_HINTS, FREE_PROVIDERS, PROVIDER_LABELS, type LLMProvider } from '@/lib/llm-providers'

const BRAND = '#1d3a5c'
type Provider = LLMProvider

export default function SetupPage() {
  const router = useRouter()

  const [opBaseUrl, setOpBaseUrl] = useState('')
  const [opToken,   setOpToken]   = useState('')
  const [provider,  setProvider]  = useState<Provider>('anthropic')
  const [llmApiKey, setLlmApiKey] = useState('')
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')
  const [step,      setStep]      = useState<'form' | 'validating' | 'done'>('form')

  const pInfo = PROVIDER_KEY_HINTS[provider]

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!opToken.trim()) { setError('OP API token is required'); return }
    setError('')
    setLoading(true)
    setStep('validating')

    try {
      const res = await fetch('/api/user-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          opBaseUrl:   opBaseUrl.trim().replace(/\/$/, ''),
          opToken:     opToken.trim(),
          llmProvider: provider,
          llmApiKey:   llmApiKey.trim(),
          anthropicKey: provider === 'anthropic' ? llmApiKey.trim() : '',
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Failed to save configuration')
        setStep('form')
        setLoading(false)
        return
      }

      document.cookie = 'isl-setup-done=1; path=/; max-age=31536000'
      setStep('done')
      // Trigger cache rebuild in background, then redirect
      fetch('/api/op/cache', { method: 'POST' }).catch(() => {})
      setTimeout(() => router.push('/'), 2500)
    } catch {
      setError('Network error — make sure the app is running')
      setStep('form')
      setLoading(false)
    }
  }

  async function handleSkip() {
    const res = await fetch('/api/status')
    const data = await res.json()
    if (data.op?.status === 'ok') {
      await fetch('/api/user-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opToken: '', llmProvider: 'anthropic', llmApiKey: '', skipValidation: true }),
      })
      document.cookie = 'isl-setup-done=1; path=/; max-age=31536000'
      router.push('/')
    } else {
      setError('OP is not configured on the server. Cannot skip — please enter your OP API token.')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center py-8" style={{ background: '#f0f4f8' }}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg overflow-hidden">
        <div className="px-8 py-6 text-white" style={{ background: BRAND }}>
          <div className="flex items-center gap-3 mb-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://www.integrity-indonesia.com/wp-content/uploads/sites/3/2025/03/int-logo-integrity.webp"
              alt="Integrity" className="h-7 opacity-90"
            />
            <span className="text-lg font-semibold tracking-wide">ISL</span>
          </div>
          <p className="text-sm text-blue-200 mt-1">Integrity Sprint Log — First Time Setup</p>
        </div>

        <div className="px-8 py-7">
          {step === 'done' ? (
            <div className="text-center py-4">
              <div className="text-4xl mb-3">✅</div>
              <p className="font-semibold text-gray-800">Setup complete!</p>
              <p className="text-sm text-gray-500 mt-1">Fetching data from OpenProject…</p>
              <p className="text-xs text-gray-400 mt-2">Opening ISL Dashboard</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* OP Base URL */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  OpenProject URL <span className="text-red-500">*</span>
                </label>
                <input
                  type="url"
                  value={opBaseUrl}
                  onChange={e => setOpBaseUrl(e.target.value)}
                  placeholder="https://your-openproject.com"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                  disabled={loading}
                />
                <p className="text-xs text-gray-400 mt-1">Your team's OpenProject URL</p>
              </div>

              {/* OP Token */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  OpenProject API Token <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={opToken}
                  onChange={e => setOpToken(e.target.value)}
                  placeholder="opapi-xxxxxxxxxxxxxxxx"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                  disabled={loading}
                />
                <p className="text-xs text-gray-400 mt-1">
                  OpenProject → My Account → Access Tokens → Generate
                </p>
              </div>

              {/* LLM Provider dropdown */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  AI Provider <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <select
                  value={provider}
                  onChange={e => { setProvider(e.target.value as Provider); setLlmApiKey('') }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 bg-white"
                  disabled={loading}
                >
                  <option value="" disabled>— Select AI provider —</option>
                  {(Object.keys(PROVIDER_KEY_HINTS) as Provider[]).map(key => (
                    <option key={key} value={key}>
                      {PROVIDER_LABELS[key]}{FREE_PROVIDERS.includes(key) ? ' ✦ free' : ''}
                    </option>
                  ))}
                </select>

                {/* Info singkat setelah pilih */}
                {provider && pInfo && (
                  <div className={`mt-2 rounded-lg px-3 py-2 text-xs ${pInfo.free ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-blue-50 text-blue-800 border border-blue-200'}`}>
                    {pInfo.noKey
                      ? '📦 Local & offline — no internet or account needed. Make sure Ollama is running.'
                      : pInfo.free
                      ? `🆓 Free — sign up at ${pInfo.hint}`
                      : `🔑 Paid — get your key at ${pInfo.hint}`
                    }
                  </div>
                )}
              </div>

              {/* API Key input (hidden for Ollama) */}
              {provider && pInfo && !pInfo.noKey && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{pInfo.label}</label>
                  <input
                    type="password"
                    value={llmApiKey}
                    onChange={e => setLlmApiKey(e.target.value)}
                    placeholder={pInfo.placeholder}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                    disabled={loading}
                  />
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-lg text-white font-medium text-sm transition-opacity"
                style={{ background: BRAND, opacity: loading ? 0.7 : 1 }}
              >
                {step === 'validating' ? 'Validating token…' : 'Save & Start'}
              </button>

              <button
                type="button"
                onClick={handleSkip}
                disabled={loading}
                className="w-full text-center text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                Skip — token already configured on the server (.env.local)
              </button>
            </form>
          )}
        </div>

        <div className="px-8 pb-5 text-xs text-gray-400">
          Config saved locally in <code className="font-mono bg-gray-100 px-1 rounded">user-config.json</code> — never sent anywhere.
        </div>
      </div>
    </div>
  )
}
