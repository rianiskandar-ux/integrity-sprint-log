import { NextRequest, NextResponse } from 'next/server'
import { db, userSettings } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { encrypt, decrypt } from '@/lib/crypto'
import { getRequestContext } from '@/lib/request-auth'
import { isOwnerUid } from '@/lib/auth'
import { DEFAULT_MODELS, type LLMProvider } from '@/lib/llm'

export const runtime = 'nodejs'

// Providers a non-owner teammate is allowed to configure for themselves.
// claude-cli stays owner-machine-only permanently — the container always
// spawns it against the OWNER's mounted .claude credentials no matter who
// asks, so "letting" a teammate pick it would silently burn the owner's own
// account/quota instead of theirs. ollama is different: LLMConfig already
// supports a per-call baseUrl override, so a teammate's OWN LAN-reachable
// Ollama (their own machine, their own model, zero cost to the owner) is
// allowed as long as they provide that baseUrl — nothing here reaches into
// the owner's local Ollama by default.
const OWNER_ONLY_PROVIDERS = new Set(['claude-cli'])
const PERSONAL_PROVIDERS = (Object.keys(DEFAULT_MODELS) as LLMProvider[])
  .filter(p => !OWNER_ONLY_PROVIDERS.has(p))

const OWNER_ONLY_MSG = 'Provider ini hanya tersedia untuk owner instance — pakai provider cloud sendiri (openai/google/groq/dst) dengan API key Anda, atau Ollama Anda sendiri (isi Base URL).'

// GET — current user's personal LLM config (never returns the decrypted key).
export async function GET() {
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const row = (await db.select().from(userSettings).where(eq(userSettings.userId, ctx.uid)).limit(1))[0]
  const decryptedKey = row?.personalLlmApiKey ? decrypt(row.personalLlmApiKey) : ''

  return NextResponse.json({
    provider:   row?.personalLlmProvider ?? null,
    model:      row?.personalLlmModel ?? null,
    baseUrl:    row?.personalLlmBaseUrl ?? null,
    apiKeySet:  !!decryptedKey,
    isOwner:    isOwnerUid(ctx.uid),
  })
}

// POST { provider, apiKey, model?, baseUrl? } — save/overwrite the current user's
// personal LLM config. apiKey is encrypted at rest (same pattern as opApiToken).
// ollama: apiKey not required, baseUrl IS required (their own endpoint).
export async function POST(req: NextRequest) {
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { provider?: string; apiKey?: string; model?: string; baseUrl?: string }
  const provider = (body.provider ?? '').trim()
  const apiKey   = (body.apiKey ?? '').trim()
  const model    = (body.model ?? '').trim()
  const baseUrl  = (body.baseUrl ?? '').trim()

  if (!provider) return NextResponse.json({ error: 'provider wajib diisi' }, { status: 400 })

  if (OWNER_ONLY_PROVIDERS.has(provider)) {
    return NextResponse.json({ error: OWNER_ONLY_MSG }, { status: 400 })
  }
  if (!PERSONAL_PROVIDERS.includes(provider as LLMProvider)) {
    return NextResponse.json({ error: `Provider "${provider}" tidak dikenal.` }, { status: 400 })
  }
  if (provider === 'ollama') {
    if (!baseUrl) return NextResponse.json({ error: 'Base URL Ollama wajib diisi (contoh: http://192.168.1.50:11434)' }, { status: 400 })
  } else if (!apiKey) {
    return NextResponse.json({ error: 'apiKey wajib diisi' }, { status: 400 })
  }

  // resolveBase() (lib/llm.ts) uses a caller-supplied baseUrl AS-IS, with no
  // "/v1" appended — unlike its own ollama fallback, which does append it. That
  // mismatch was never caught before because nothing actually exercised a
  // custom ollama baseUrl end-to-end until this feature. Normalize here so
  // whatever the teammate types (with or without /v1, with or without a
  // trailing slash) resolves the same way the built-in ollama path already does.
  const normalizedBaseUrl = provider === 'ollama'
    ? baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1'
    : baseUrl

  const encKey = apiKey ? encrypt(apiKey) : null
  const existing = (await db.select().from(userSettings).where(eq(userSettings.userId, ctx.uid)).limit(1))[0]

  if (existing) {
    await db.update(userSettings).set({
      personalLlmProvider: provider,
      personalLlmApiKey:   encKey,
      personalLlmModel:    model || null,
      personalLlmBaseUrl:  provider === 'ollama' ? normalizedBaseUrl : null,
      updatedAt:           new Date(),
    }).where(eq(userSettings.userId, ctx.uid))
  } else {
    await db.insert(userSettings).values({
      userId:              ctx.uid,
      personalLlmProvider: provider,
      personalLlmApiKey:   encKey,
      personalLlmModel:    model || null,
      personalLlmBaseUrl:  provider === 'ollama' ? normalizedBaseUrl : null,
    })
  }

  return NextResponse.json({ ok: true, provider, model: model || null, baseUrl: provider === 'ollama' ? normalizedBaseUrl : null })
}

// DELETE — clear the current user's personal LLM config (revert to none).
export async function DELETE() {
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await db.update(userSettings).set({
    personalLlmProvider: null,
    personalLlmApiKey:   null,
    personalLlmModel:    null,
    personalLlmBaseUrl:  null,
    updatedAt:           new Date(),
  }).where(eq(userSettings.userId, ctx.uid))

  return NextResponse.json({ ok: true })
}
