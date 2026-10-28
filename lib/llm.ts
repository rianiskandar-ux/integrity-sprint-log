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
  | 'claude-cli'
  | 'custom'      // any OpenAI-compatible endpoint: user supplies baseUrl + apiKey (DeepSeek, LM Studio, vLLM, …)

export interface LLMConfig {
  provider:  LLMProvider
  apiKey:    string          // ignored for ollama
  model?:    string          // falls back to DEFAULT_MODELS[provider]
  baseUrl?:  string          // override for ollama or custom endpoints
  effort?:   string          // claude-cli only: reasoning effort low|medium|high|max
}

export const DEFAULT_MODELS: Record<LLMProvider, string> = {
  anthropic:   'claude-haiku-4-5-20251001',
  openai:      'gpt-4o-mini',
  google:      'gemini-2.0-flash-exp',
  groq:        'llama-3.3-70b-versatile',
  openrouter:  'meta-llama/llama-3.1-8b-instruct:free',
  mistral:     'mistral-small-latest',
  together:    'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
  ollama:      process.env.OLLAMA_CHAT_MODEL || 'qwen2.5:3b',
  '9router':   'gemini/gemini-3.5-flash-lite',   // 8 Okt 2026: 2.0-flash-lite dimatikan Google. JANGAN model Claude via 9Router (air-gap)
  'claude-cli': 'claude',
  custom:      '',   // no sensible default — model name is required in settings
}

export const PROVIDER_LABELS: Record<LLMProvider, string> = {
  anthropic:   'Anthropic (Claude)',
  openai:      'OpenAI (GPT)',
  google:      'Google Gemini',
  groq:        'Groq (Llama / free)',
  openrouter:  'OpenRouter (multi-model)',
  mistral:     'Mistral',
  together:    'Together AI',
  ollama:      'Ollama (local, no key)',
  '9router':   '9Router (local proxy, no key)',
  'claude-cli': 'Claude Code CLI (pakai subscription, lokal only)',
  custom:      'Custom (OpenAI-compatible: DeepSeek/LM Studio/vLLM/dll)',
}

export const FREE_PROVIDERS: LLMProvider[] = ['groq', 'openrouter', 'ollama', '9router', 'claude-cli']

/** Call the LLM with a plain-text prompt. Returns the response text. */
export async function callLLM(prompt: string, config: LLMConfig): Promise<string> {
  const model = config.model || DEFAULT_MODELS[config.provider]
  const base  = config.baseUrl

  switch (config.provider) {
    case 'anthropic':
      return callAnthropic(prompt, model, config.apiKey)

    case 'google':
      return callGemini(prompt, model, config.apiKey)

    case 'claude-cli':
      // 'claude' sentinel = pakai default model dari CLI (jangan pass --model)
      return callClaudeCLI(prompt, model !== 'claude' ? model : undefined, config.effort)

    // OpenAI-compatible providers
    case 'custom':
      if (!base) throw new Error('Custom provider butuh Base URL (diset di Settings)')
      if (!model) throw new Error('Custom provider butuh nama model (diset di Settings)')
      return callOpenAICompat(prompt, model, config.apiKey, base)
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
    ollama:     `${process.env.OLLAMA_URL || 'http://localhost:11434'}/v1`,
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

/** Call Claude Code CLI as subprocess — uses existing SSO session, no API key needed */
async function callClaudeCLI(prompt: string, model?: string, effort?: string): Promise<string> {
  const { spawn } = await import('child_process')
  const isWin = process.platform === 'win32'

  // Derive the correct home dir for Claude credential lookup.
  // In Docker the container user is `nextjs` (uid 1001), home = /home/nextjs.
  // If HOME is unset or still /root, Claude CLI won't find the mounted .claude/ creds → hangs → SIGTERM 143.
  const home = process.env.HOME && process.env.HOME !== '/root'
    ? process.env.HOME
    : isWin ? (process.env.USERPROFILE ?? process.env.HOME ?? '') : '/home/nextjs'

  // --model/--effort per-invocation: config global (~/.claude/settings.json ter-mount
  // dari host) TIDAK disentuh, jadi terminal lokal user tidak terpengaruh.
  // Haiku tidak support effort levels — skip flag agar CLI tidak error.
  const args = ['--print', '--output-format', 'text']
  if (model) args.push('--model', model)
  if (effort && model !== 'haiku') args.push('--effort', effort)

  return new Promise<string>((resolve, reject) => {
    const child = spawn(isWin ? 'claude.cmd' : 'claude', args, {
      timeout: 300000,  // 5 min — panjang untuk dokumen besar
      env: { ...process.env, HOME: home },
      shell: isWin,
    })

    child.stdin.write(prompt, 'utf8')
    child.stdin.end()

    let output = '', errOut = ''
    child.stdout.on('data', (d: Buffer) => { output += d.toString('utf8') })
    child.stderr.on('data', (d: Buffer) => { errOut += d.toString('utf8') })

    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (code !== 0) {
        const hint = code === 143 || signal === 'SIGTERM'
          ? ' (timeout/SIGTERM — pastikan Claude CLI login: jalankan `claude auth login` di container)'
          : ''
        reject(new Error((errOut || `Claude CLI exited ${code}`) + hint))
        return
      }
      resolve(output.trim())
    })
    child.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') reject(new Error('Claude Code CLI tidak ditemukan. Install: npm install -g @anthropic-ai/claude-code'))
      else reject(e)
    })
  })
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
  if (provider === 'ollama' || provider === '9router' || provider === 'claude-cli') return { provider, apiKey: '', model: cfg.llmModel || undefined, effort: cfg.llmEffort || undefined }
  if (!apiKey) return null

  return { provider, apiKey, model: cfg.llmModel || undefined }
}
