import { NextRequest, NextResponse } from 'next/server'
import { db, userSettings } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { encrypt, decrypt } from '@/lib/crypto'
import { getRequestContext } from '@/lib/request-auth'
import { isOwnerUid } from '@/lib/auth'
import { DEFAULT_MODELS, type LLMProvider } from '@/lib/llm'

export const runtime = 'nodejs'

// Providers a non-owner teammate is allowed to configure for themselves.
// claude-cli (owner's subscription) and ollama (owner's local machine) are
// intentionally excluded — those stay owner-machine-only by design.
const OWNER_ONLY_PROVIDERS = new Set(['claude-cli', 'ollama'])
const PERSONAL_PROVIDERS = (Object.keys(DEFAULT_MODELS) as LLMProvider[])
  .filter(p => !OWNER_ONLY_PROVIDERS.has(p))

const OWNER_ONLY_MSG = 'Provider ini hanya tersedia untuk owner instance — pakai provider cloud sendiri (openai/google/groq/dst) dengan API key Anda.'

// GET — current user's personal LLM config (never returns the decrypted key).
export async function GET() {
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const row = (await db.select().from(userSettings).where(eq(userSettings.userId, ctx.uid)).limit(1))[0]
  const decryptedKey = row?.personalLlmApiKey ? decrypt(row.personalLlmApiKey) : ''

  return NextResponse.json({
    provider:   row?.personalLlmProvider ?? null,
    model:      row?.personalLlmModel ?? null,
    apiKeySet:  !!decryptedKey,
    isOwner:    isOwnerUid(ctx.uid),
  })
}

// POST { provider, apiKey, model? } — save/overwrite the current user's personal
// LLM config. apiKey is encrypted at rest (same pattern as opApiToken).
export async function POST(req: NextRequest) {
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { provider?: string; apiKey?: string; model?: string }
  const provider = (body.provider ?? '').trim()
  const apiKey   = (body.apiKey ?? '').trim()
  const model    = (body.model ?? '').trim()

  if (!provider) return NextResponse.json({ error: 'provider wajib diisi' }, { status: 400 })

  if (OWNER_ONLY_PROVIDERS.has(provider)) {
    return NextResponse.json({ error: OWNER_ONLY_MSG }, { status: 400 })
  }
  if (!PERSONAL_PROVIDERS.includes(provider as LLMProvider)) {
    return NextResponse.json({ error: `Provider "${provider}" tidak dikenal.` }, { status: 400 })
  }
  if (!apiKey) return NextResponse.json({ error: 'apiKey wajib diisi' }, { status: 400 })

  const encKey = encrypt(apiKey)
  const existing = (await db.select().from(userSettings).where(eq(userSettings.userId, ctx.uid)).limit(1))[0]

  if (existing) {
    await db.update(userSettings).set({
      personalLlmProvider: provider,
      personalLlmApiKey:   encKey,
      personalLlmModel:    model || null,
      updatedAt:           new Date(),
    }).where(eq(userSettings.userId, ctx.uid))
  } else {
    await db.insert(userSettings).values({
      userId:              ctx.uid,
      personalLlmProvider: provider,
      personalLlmApiKey:   encKey,
      personalLlmModel:    model || null,
    })
  }

  return NextResponse.json({ ok: true, provider, model: model || null })
}

// DELETE — clear the current user's personal LLM config (revert to none).
export async function DELETE() {
  const ctx = await getRequestContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await db.update(userSettings).set({
    personalLlmProvider: null,
    personalLlmApiKey:   null,
    personalLlmModel:    null,
    updatedAt:           new Date(),
  }).where(eq(userSettings.userId, ctx.uid))

  return NextResponse.json({ ok: true })
}
