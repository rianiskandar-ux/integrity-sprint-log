/**
 * Unified LLM caller — supports Anthropic, OpenAI, Google Gemini, Groq,
 * OpenRouter, Mistral, Together AI, and Ollama (local).
 *
 * Most providers use the OpenAI-compatible /chat/completions format.
 * Anthropic and Gemini use custom formats — handled below.
 */

export type LLMProvider =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'groq'
  | 'openrouter'
  | 'mistral'
  | 'together'
  | 'ollama'
  | '9router'

export interface LLMConfig {
  provider:  LLMProvider
  apiKey:    string          // ignored for ollama
  model?:    string          // falls back to DEFAULT_MODELS[provider]
  baseUrl?:  string          // override for ollama or custom endpoints
}

export const DEFAULT_MODELS: Record<LLMProvider, string> = {
  anthropic:   'claude-haiku-4-5-20251001',
  openai:      'gpt-4o-mini',
  google:      'gemini-2.0-flash-exp',
  groq:        'llama-3.3-70b-versatile',
  openrouter:  'meta-llama/llama-3.1-8b-instruct:free',
  mistral:     'mistral-small-latest',
  together:    'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
  ollama:      'llama3.2',
  '9router':   'claude-sonnet-4-6',
}

export const PROVIDER_LABELS: Record<LLMProvider, string> = {
  anthropic:  'Anthropic (Claude)',
  openai:     'OpenAI (GPT)',
  google:     'Google Gemini',
  groq:       'Groq (Llama / free)',
  openrouter: 'OpenRouter (multi-model)',
  mistral:    'Mistral',
  together:   'Together AI',
  ollama:     'Ollama (local, no key)',
  '9router':  '9Router (local proxy, no key)',
}

export const FREE_PROVIDERS: LLMProvider[] = ['groq', 'openrouter', 'ollama', '9router']

/** Call the LLM with a plain-text prompt. Returns the response text. */
export async function callLLM(prompt: string, config: LLMConfig): Promise<string> {
  const model = config.model || DEFAULT_MODELS[config.provider]
  const base  = config.baseUrl

  switch (config.provider) {
    case 'anthropic':
      return callAnthropic(prompt, model, config.apiKey)

    case 'google':
      return callGemini(prompt, model, config.apiKey)

    // OpenAI-compatible providers
    case 'openai':
    case 'groq':
    case 'openrouter':
    case 'mistral':
    case 'together':
    case 'ollama':
    case '9router':
      return callOpenAICompat(prompt, model, config.apiKey, resolveBase(config.provider, base))

    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`)
  }
}

function resolveBase(provider: LLMProvider, override?: string): string {
  if (override) return override
  const BASES: Record<string, string> = {
    openai:     'https://api.openai.com/v1',
    groq:       'https://api.groq.com/openai/v1',
    openrouter: 'https://openrouter.ai/api/v1',
    mistral:    'https://api.mistral.ai/v1',
    together:   'https://api.together.xyz/v1',
    ollama:     'http://localhost:11434/v1',
    '9router':  'http://localhost:20128/v1',
  }
  return BASES[provider] ?? 'https://api.openai.com/v1'
}

async function callOpenAICompat(prompt: string, model: string, apiKey: string, base: string): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) throw new Error(`${model} HTTP ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ''
}

async function callAnthropic(prompt: string, model: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) throw new Error(`Claude HTTP ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.content?.[0]?.text ?? ''
}

async function callGemini(prompt: string, model: string, apiKey: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 1000 },
    }),
  })
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
}

/** Build LLMConfig from user-config (server-side) */
export function getLLMConfig(): LLMConfig | null {
  // Lazy import to avoid loading fs in client contexts
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { loadUserConfig, getAnthropicKey } = require('./user-config') as typeof import('./user-config')
  const cfg = loadUserConfig()

  const provider = (cfg.llmProvider as LLMProvider | undefined) || 'anthropic'
  const apiKey   = cfg.llmApiKey || (provider === 'anthropic' ? getAnthropicKey() : '')

  // Local providers don't need a key
  if (provider === 'ollama' || provider === '9router') return { provider, apiKey: '', model: cfg.llmModel || undefined }
  if (!apiKey) return null

  return { provider, apiKey, model: cfg.llmModel || undefined }
}
