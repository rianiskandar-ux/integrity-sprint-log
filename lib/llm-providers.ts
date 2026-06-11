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
  groq:       'Groq (Llama)',
  openrouter: 'OpenRouter (multi-model)',
  mistral:    'Mistral',
  together:   'Together AI',
  ollama:     'Ollama (lokal, no key)',
  '9router':  '9Router (lokal proxy, no key)',
}

export const PROVIDER_KEY_HINTS: Record<LLMProvider, { label: string; placeholder: string; hint: string; noKey?: boolean; free?: boolean }> = {
  anthropic:  { label: 'Anthropic API Key',  placeholder: 'sk-ant-api03-…',  hint: 'console.anthropic.com' },
  openai:     { label: 'OpenAI API Key',      placeholder: 'sk-…',            hint: 'platform.openai.com/api-keys' },
  google:     { label: 'Gemini API Key',      placeholder: 'AIzaSy…',         hint: 'aistudio.google.com/apikey', free: true },
  groq:       { label: 'Groq API Key',        placeholder: 'gsk_…',           hint: 'console.groq.com', free: true },
  openrouter: { label: 'OpenRouter API Key',  placeholder: 'sk-or-…',         hint: 'openrouter.ai/keys', free: true },
  mistral:    { label: 'Mistral API Key',     placeholder: 'xxxx…',           hint: 'console.mistral.ai' },
  together:   { label: 'Together AI API Key', placeholder: 'xxxx…',           hint: 'api.together.xyz' },
  ollama:     { label: '',                    placeholder: '',                 hint: 'ollama.com — install lokal', noKey: true, free: true },
  '9router':  { label: '',                    placeholder: '',                 hint: '9router jalan di localhost:20128', noKey: true, free: true },
}

export const FREE_PROVIDERS: LLMProvider[] = ['groq', 'openrouter', 'ollama', 'google', '9router']
