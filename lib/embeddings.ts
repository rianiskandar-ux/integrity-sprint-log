/**
 * AI Layer (Phase 2) — embedding + semantic search over pgvector.
 *
 * Key-agnostic by design: every function no-ops gracefully when
 * GEMINI_API_KEY is absent (embedText → null, upsert → skip,
 * semanticSearch → []). Nothing here ever throws to the caller.
 *
 * Model: Gemini text-embedding-004 → 768-dim vectors, cosine distance (<=>).
 */
import { db, embeddings } from './db'
import { sql, eq, isNull, or } from 'drizzle-orm'

const GEMINI_EMBED_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent'

// Gemini embedContent input limit safety — plenty for titles + bullets/summaries
const MAX_EMBED_CHARS = 8000

export type EmbeddingSourceType = 'kb' | 'session' | 'daily_log' | 'doc'

export interface SemanticResult {
  sourceType: string
  sourceId: string
  title: string
  chunk: string
  distance: number
}

/** Env-only for now (user-config field can come later). */
export function getGeminiKey(): string {
  return process.env.GEMINI_API_KEY ?? ''
}

/** Ollama di host (nomic-embed-text, 768 dim). Dari container: host.docker.internal. */
export function getOllamaUrl(): string {
  return process.env.OLLAMA_URL ?? ''
}

const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text'

/** Provider utama: Ollama lokal (gratis, offline). Fallback: Gemini kalau ada key. */
async function embedViaOllama(input: string): Promise<number[] | null> {
  const base = getOllamaUrl()
  if (!base) return null
  try {
    const res = await fetch(`${base}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, prompt: input.slice(0, MAX_EMBED_CHARS) }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) {
      console.warn(`[embeddings] Ollama embed failed: ${res.status}`)
      return null
    }
    const data = await res.json() as { embedding?: number[] }
    const values = data?.embedding
    if (!Array.isArray(values) || values.length !== 768) {
      console.warn(`[embeddings] Ollama unexpected shape (len=${Array.isArray(values) ? values.length : 'n/a'})`)
      return null
    }
    return values
  } catch (e) {
    console.warn('[embeddings] Ollama error:', e instanceof Error ? e.message : e)
    return null
  }
}

/**
 * Embed text — Ollama lokal dulu, fallback Gemini bila ada key.
 * Returns 768-dim vector, or null when no provider / empty text / any error. Never throws.
 */
export async function embedText(text: string): Promise<number[] | null> {
  const input = (text ?? '').trim()
  if (!input) return null

  const local = await embedViaOllama(input)
  if (local) return local

  const key = getGeminiKey()
  if (!key) return null

  try {
    const res = await fetch(`${GEMINI_EMBED_URL}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/text-embedding-004',
        content: { parts: [{ text: input.slice(0, MAX_EMBED_CHARS) }] },
      }),
    })
    if (!res.ok) {
      console.warn(`[embeddings] Gemini embedContent failed: ${res.status} ${res.statusText}`)
      return null
    }
    const data = await res.json() as { embedding?: { values?: number[] } }
    const values = data?.embedding?.values
    if (!Array.isArray(values) || values.length !== 768) {
      console.warn(`[embeddings] Unexpected embedding shape (len=${Array.isArray(values) ? values.length : 'n/a'})`)
      return null
    }
    return values
  } catch (e) {
    console.warn('[embeddings] embedText error:', e instanceof Error ? e.message : e)
    return null
  }
}

/**
 * Embed + upsert one row keyed by (sourceType, sourceId).
 * Skips silently when embedding is unavailable (no key / API error),
 * and swallows DB errors (e.g. migration not applied yet) — never throws.
 */
export async function upsertEmbedding(input: {
  userId?: number | null
  sourceType: EmbeddingSourceType
  sourceId: string
  title: string
  chunk: string
}): Promise<void> {
  try {
    const vec = await embedText(`${input.title}\n${input.chunk}`)
    if (!vec) return

    await db.insert(embeddings).values({
      id:         `emb-${input.sourceType}-${input.sourceId}`,
      userId:     input.userId ?? null,
      sourceType: input.sourceType,
      sourceId:   input.sourceId,
      title:      input.title,
      chunk:      input.chunk,
      embedding:  vec,
    }).onConflictDoUpdate({
      target: [embeddings.sourceType, embeddings.sourceId],
      set: {
        userId:    input.userId ?? null,
        title:     input.title,
        chunk:     input.chunk,
        embedding: vec,
      },
    })
  } catch (e) {
    console.warn('[embeddings] upsertEmbedding error:', e instanceof Error ? e.message : e)
  }
}

/**
 * Cosine-distance semantic search (pgvector `<=>`), lowest distance first.
 * Rows with NULL user_id are included so single-user/hook-created data stays
 * findable. Returns [] when no key or on any error.
 */
export async function semanticSearch(
  query: string,
  userId?: number | null,
  topK = 5,
): Promise<SemanticResult[]> {
  const vec = await embedText(query)
  if (!vec) return []

  const vecLiteral = `[${vec.join(',')}]`
  const distance = sql<number>`${embeddings.embedding} <=> ${vecLiteral}::vector`

  try {
    const rows = await db.select({
      sourceType: embeddings.sourceType,
      sourceId:   embeddings.sourceId,
      title:      embeddings.title,
      chunk:      embeddings.chunk,
      distance,
    }).from(embeddings)
      .where(
        userId != null
          ? or(eq(embeddings.userId, userId), isNull(embeddings.userId))
          : sql`true`,
      )
      .orderBy(distance)
      .limit(topK)

    return rows.map(r => ({ ...r, distance: Number(r.distance) }))
  } catch (e) {
    console.warn('[embeddings] semanticSearch error:', e instanceof Error ? e.message : e)
    return []
  }
}
