import { NextResponse } from 'next/server'
import { getLLMConfig } from '@/lib/llm'
import type { LLMProvider } from '@/lib/llm-providers'

// GET /api/llm/models?provider=groq&key=gsk_...
// Uses saved config if no query params provided
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const qProvider = searchParams.get('provider') as LLMProvider | null
  const qKey      = searchParams.get('key') ?? ''

  // Use query params if provided, otherwise fall back to saved config
  let provider: LLMProvider
  let apiKey: string

  if (qProvider && qKey) {
    provider = qProvider
    apiKey   = qKey
  } else {
    const cfg = getLLMConfig()
    if (!cfg) return NextResponse.json({ models: [], error: 'No LLM configured' })
    provider = cfg.provider
    apiKey   = cfg.apiKey
  }

  try {
    const models = await fetchModels(provider, apiKey)
    return NextResponse.json({ models, provider })
  } catch (e) {
    return NextResponse.json({ models: [], error: String(e) }, { status: 500 })
  }
}

async function fetchModels(provider: LLMProvider, apiKey: string): Promise<{ id: string; label: string }[]> {
  switch (provider) {

    case 'openai':
    case 'groq':
    case 'mistral':
    case 'together':
    case 'openrouter': {
      const BASE: Record<string, string> = {
        openai:     'https://api.openai.com/v1',
        groq:       'https://api.groq.com/openai/v1',
        mistral:    'https://api.mistral.ai/v1',
        together:   'https://api.together.xyz/v1',
        openrouter: 'https://openrouter.ai/api/v1',
      }
      const res  = await fetch(`${BASE[provider]}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()

      // Different shape per provider
      const items: { id: string; name?: string; display_name?: string }[] =
        data.data ?? data.models ?? data ?? []

      return items
        .filter(m => m.id)
        .map(m => ({ id: m.id, label: m.name ?? m.display_name ?? m.id }))
        .sort((a, b) => a.id.localeCompare(b.id))
    }

    case 'anthropic': {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const items: { id: string; display_name?: string }[] = data.data ?? []
      return items.map(m => ({ id: m.id, label: m.display_name ?? m.id }))
        .sort((a, b) => a.id.localeCompare(b.id))
    }

    case 'google': {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const items: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[] =
        data.models ?? []
      return items
        .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
        .map(m => ({ id: m.name.replace('models/', ''), label: m.displayName ?? m.name }))
        .sort((a, b) => a.id.localeCompare(b.id))
    }

    case 'ollama': {
      // Local Ollama — list installed models
      const res = await fetch('http://localhost:11434/api/tags')
      if (!res.ok) throw new Error('Ollama not running')
      const data = await res.json()
      const items: { name: string }[] = data.models ?? []
      return items.map(m => ({ id: m.name, label: m.name }))
    }

    default:
      return []
  }
}
