import { NextRequest, NextResponse } from 'next/server'
import { db, sageDigests, sageSnapshots } from '@/lib/db'
import { desc, eq } from 'drizzle-orm'
import { callLLM, getLLMConfig } from '@/lib/llm'
import { sendTelegram } from '@/lib/telegram'
import { upsertEmbedding } from '@/lib/embeddings'
import { getRequestContext } from '@/lib/request-auth'
import { OWNER_UID } from '@/lib/auth'

export const runtime = 'nodejs'
export const maxDuration = 300

// ── Sage — weekly AI-ecosystem-update monitoring agent ──────────────────────
// Agent #8. Reports DIRECT to human (parallel to Aryo/Nara, not through them).
// Domain: external AI news (providers, models, free-tier gateways) — NOT
// internal work/ops (that's Aryo's job). Zero LLM tokens for fetch+filter,
// exactly one LLM call to compose the final Indonesian digest.

const CAP_TOTAL = 40

interface RawItem {
  source:      string
  title:       string
  url:         string
  publishedAt: string
}

interface OpenRouterModel {
  id:      string
  pricing?: { prompt?: string; completion?: string }
  [key: string]: unknown
}

// ── Auth: browser session OR machine key (weekly cron calls headless) ───────
async function resolveAuth(req: NextRequest): Promise<{ uid: number } | null> {
  const key = process.env.KAFI_API_KEY || 'kafi-bridge-2026'
  const machineAuth =
    req.headers.get('x-kafi-key') === key ||
    new URL(req.url).searchParams.get('key') === key
  if (machineAuth) return { uid: OWNER_UID }

  const ctx = await getRequestContext()
  if (ctx) return { uid: ctx.uid }
  return null
}

// ── RSS parsing (no XML dep in repo — lightweight regex parser) ─────────────
function extractTag(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const m = block.match(re)
  return m ? m[1] : null
}

function cleanText(s: string): string {
  return s.replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').replace(/<[^>]+>/g, '').trim()
}

function parseRSSItems(xml: string, source: string, limit = 20): RawItem[] {
  const items: RawItem[] = []
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? []
  for (const raw of blocks.slice(0, limit)) {
    const title = extractTag(raw, 'title')
    const link  = extractTag(raw, 'link')
    const pub   = extractTag(raw, 'pubDate') ?? extractTag(raw, 'published') ?? extractTag(raw, 'dc:date')
    if (!title || !link) continue
    const publishedAt = pub && !isNaN(new Date(pub).getTime()) ? new Date(pub).toISOString() : new Date().toISOString()
    items.push({ source, title: cleanText(title), url: cleanText(link), publishedAt })
  }
  return items
}

// ── Step 1: fetch all sources, each isolated — one failure never kills the run ─
async function fetchOpenAI(): Promise<RawItem[]> {
  try {
    const res = await fetch('https://openai.com/news/rss.xml', { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return []
    return parseRSSItems(await res.text(), 'openai')
  } catch (e) {
    console.warn('[sage] openai fetch error:', e instanceof Error ? e.message : e)
    return []
  }
}

async function fetchAnthropic(): Promise<RawItem[]> {
  try {
    const res = await fetch('https://tim-hilde.github.io/anthropic-rss/rss.xml', { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return []
    return parseRSSItems(await res.text(), 'anthropic')
  } catch (e) {
    console.warn('[sage] anthropic fetch error:', e instanceof Error ? e.message : e)
    return []
  }
}

async function fetchHuggingFace(): Promise<RawItem[]> {
  try {
    const res = await fetch('https://huggingface.co/api/models?sort=createdAt&direction=-1&limit=20', {
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return []
    const models = (await res.json()) as { id?: string; createdAt?: string }[]
    return (Array.isArray(models) ? models : [])
      .filter(m => m.id)
      .map(m => ({
        source:      'huggingface',
        title:       `New model: ${m.id}`,
        url:         `https://huggingface.co/${m.id}`,
        publishedAt: m.createdAt ?? new Date().toISOString(),
      }))
  } catch (e) {
    console.warn('[sage] huggingface fetch error:', e instanceof Error ? e.message : e)
    return []
  }
}

async function fetchGitHub(): Promise<RawItem[]> {
  try {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
    const headers: Record<string, string> = {
      Accept:     'application/vnd.github+json',
      'User-Agent': 'Sage-ISL-Agent',
    }
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`

    const url = `https://api.github.com/search/repositories?q=created:>${since}+topic:llm&sort=stars&order=desc`
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) })
    if (!res.ok) return []
    const data = (await res.json()) as { items?: { full_name: string; description?: string | null; html_url: string; created_at: string }[] }
    return (data.items ?? []).slice(0, 15).map(r => ({
      source:      'github',
      title:       (r.description ? `${r.full_name} — ${r.description}` : r.full_name).slice(0, 200),
      url:         r.html_url,
      publishedAt: r.created_at,
    }))
  } catch (e) {
    console.warn('[sage] github fetch error:', e instanceof Error ? e.message : e)
    return []
  }
}

async function fetchHackerNews(): Promise<RawItem[]> {
  try {
    const since = Math.floor((Date.now() - 7 * 86_400_000) / 1000)
    const url = `https://hn.algolia.com/api/v1/search?tags=story&query=AI&numericFilters=created_at_i>${since}`
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return []
    const data = (await res.json()) as { hits?: { title: string; url?: string | null; objectID: string; created_at: string }[] }
    return (data.hits ?? []).slice(0, 15).map(h => ({
      source:      'hackernews',
      title:       h.title,
      url:         h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      publishedAt: h.created_at,
    }))
  } catch (e) {
    console.warn('[sage] hackernews fetch error:', e instanceof Error ? e.message : e)
    return []
  }
}

// OpenRouter — the free-tier tracker. Diffs current models against last
// week's snapshot (sageSnapshots) to surface new :free models, removals,
// and price changes >10%. Snapshot is overwritten with the current list
// at the end of every run, whether or not the diff produced anything.
async function fetchOpenRouterDiff(): Promise<RawItem[]> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return []
    const json = (await res.json()) as { data?: OpenRouterModel[] }
    const current = Array.isArray(json.data) ? json.data : []
    const currentMap = new Map(current.map(m => [m.id, m]))

    let previous: OpenRouterModel[] = []
    try {
      const rows = await db.select().from(sageSnapshots).where(eq(sageSnapshots.id, 'openrouter-models')).limit(1)
      const data = rows[0]?.data
      if (Array.isArray(data)) previous = data as OpenRouterModel[]
    } catch { /* first run, or migration not applied yet — treat as empty */ }
    const previousMap = new Map(previous.map(m => [m.id, m]))

    const diffs: RawItem[] = []
    const now = new Date().toISOString()
    const OR_URL = 'https://openrouter.ai/models'

    for (const m of current) {
      if (m.id.endsWith(':free') && !previousMap.has(m.id)) {
        diffs.push({ source: 'openrouter', title: `New free model: ${m.id}`, url: OR_URL, publishedAt: now })
      }
    }
    for (const m of previous) {
      if (!currentMap.has(m.id)) {
        diffs.push({ source: 'openrouter', title: `Removed: ${m.id}`, url: OR_URL, publishedAt: now })
      }
    }
    for (const m of current) {
      const prev = previousMap.get(m.id)
      if (!prev) continue
      const oldPrice = Number(prev.pricing?.prompt ?? NaN)
      const newPrice = Number(m.pricing?.prompt ?? NaN)
      if (!Number.isNaN(oldPrice) && !Number.isNaN(newPrice) && oldPrice > 0) {
        const pct = ((newPrice - oldPrice) / oldPrice) * 100
        if (Math.abs(pct) > 10) {
          diffs.push({ source: 'openrouter', title: `Price change: ${m.id} (${pct > 0 ? '+' : ''}${pct.toFixed(0)}%)`, url: OR_URL, publishedAt: now })
        }
      }
    }

    // Save current snapshot back — best-effort, never blocks the run.
    try {
      await db.insert(sageSnapshots)
        .values({ id: 'openrouter-models', data: current, updatedAt: new Date() })
        .onConflictDoUpdate({ target: sageSnapshots.id, set: { data: current, updatedAt: new Date() } })
    } catch (e) {
      console.warn('[sage] openrouter snapshot save error:', e instanceof Error ? e.message : e)
    }

    return diffs
  } catch (e) {
    console.warn('[sage] openrouter fetch error:', e instanceof Error ? e.message : e)
    return []
  }
}

// OpenModel — tracked ONLY as a possible non-Claude free-tier source. Best-effort
// probe of a couple of plausible endpoints; if nothing is found, note it gracefully
// so the digest can say so instead of silently omitting the source.
async function fetchOpenModel(): Promise<RawItem[]> {
  const candidates = ['https://openmodel.ai/api/models', 'https://openmodel.ai/api/v1/models']
  for (const url of candidates) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } })
      if (!res.ok) continue
      const ct = res.headers.get('content-type') ?? ''
      if (!ct.includes('json')) continue
      const json = (await res.json()) as unknown
      const looksLikeList =
        Array.isArray(json) ||
        (typeof json === 'object' && json !== null && (Array.isArray((json as Record<string, unknown>).data) || Array.isArray((json as Record<string, unknown>).models)))
      if (looksLikeList) {
        return [{ source: 'openmodel', title: `OpenModel: public model list found at ${url} — review for non-Claude free-tier opportunities`, url, publishedAt: new Date().toISOString() }]
      }
    } catch { /* try next candidate */ }
  }
  return [{ source: 'openmodel', title: 'OpenModel: no public model list found this run', url: 'https://openmodel.ai', publishedAt: new Date().toISOString() }]
}

// ── Step 2: cheap keyword filter + dedupe + prioritized cap (zero LLM) ──────
const RELEVANT_WORDS = [
  'model', 'release', 'launch', 'gpt', 'claude', 'gemini', 'llama', 'qwen',
  'agent', 'fine-tune', 'finetune', 'api', 'free', 'pricing', 'open-source',
  'opensource', 'benchmark', 'context window',
]

// Always-relevant sources: HF newest models, OpenRouter diffs, OpenModel probe result.
const STRUCTURAL_SOURCES = new Set(['huggingface', 'openrouter', 'openmodel'])

function isRelevant(item: RawItem): boolean {
  if (STRUCTURAL_SOURCES.has(item.source)) return true
  const text = item.title.toLowerCase()
  return RELEVANT_WORDS.some(w => text.includes(w))
}

// Cap priority: OpenRouter diffs first, then official RSS, then GitHub/HN.
const SOURCE_PRIORITY: Record<string, number> = {
  openrouter:  0,
  openmodel:   1,
  openai:      2,
  anthropic:   2,
  huggingface: 3,
  github:      4,
  hackernews:  5,
}

function filterDedupeCap(items: RawItem[]): RawItem[] {
  const relevant = items.filter(isRelevant)
  const seen = new Set<string>()
  const deduped: RawItem[] = []
  for (const item of relevant) {
    if (seen.has(item.url)) continue
    seen.add(item.url)
    deduped.push(item)
  }
  deduped.sort((a, b) => (SOURCE_PRIORITY[a.source] ?? 9) - (SOURCE_PRIORITY[b.source] ?? 9))
  return deduped.slice(0, CAP_TOTAL)
}

// ── Step 5 helper: minimal markdown → Telegram HTML ─────────────────────────
function mdToTelegramHtml(md: string): string {
  return md
    .replace(/^##\s+(.*)$/gm, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/^-\s+/gm, '• ')
}

function getWeekOf(): string {
  const now = new Date()
  const day = now.getDay() // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(now)
  monday.setDate(now.getDate() + diffToMonday)
  return monday.toISOString().slice(0, 10)
}

// ── GET — latest saved digest (for a future UI) ──────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await resolveAuth(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const rows = await db.select().from(sageDigests).orderBy(desc(sageDigests.createdAt)).limit(1)
    return NextResponse.json({ digest: rows[0] ?? null })
  } catch (e) {
    console.error('[sage] GET error:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// ── POST — run the weekly scan, compose digest, save + notify ───────────────
export async function POST(req: NextRequest) {
  const auth = await resolveAuth(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try { // outer guard — always return JSON
    // Step 1 — fetch everything in parallel, zero LLM tokens.
    const [openai, anthropic, hf, github, hn, openrouterDiff, openModel] = await Promise.all([
      fetchOpenAI(),
      fetchAnthropic(),
      fetchHuggingFace(),
      fetchGitHub(),
      fetchHackerNews(),
      fetchOpenRouterDiff(),
      fetchOpenModel(),
    ])

    const allItems = [...openrouterDiff, ...openModel, ...openai, ...anthropic, ...hf, ...github, ...hn]
    const rawSignalCount = allItems.length

    // Step 2 — cheap filter, dedupe, prioritized cap.
    const items = filterDedupeCap(allItems)

    const weekOf = getWeekOf()

    // Step 3 — the ONLY LLM call: compose the Indonesian markdown digest.
    const signalList = items.map(i => `- [${i.source}] ${i.title} — ${i.url}`).join('\n') || '(tidak ada sinyal relevan minggu ini)'

    const prompt = `Kamu Sage, agent yang memantau update ekosistem AI untuk developer yang pakai Claude (subscription resmi via Claude Code CLI, milik akun TEAM kantor — sangat penting dijaga jangan sampai kena banned) dan model lokal (Ollama). Dari daftar sinyal mentah di bawah, buat digest mingguan Bahasa Indonesia, format markdown:
## Update Provider Utama
(Claude, ChatGPT, Gemini, dll — rilis/perubahan penting, 2-4 poin, sertakan link)
## Model & Tools Baru
(open-source, GitHub trending, HuggingFace — 2-4 poin, sertakan link)
## Peluang Token Gratis
(dari data OpenRouter/OpenModel — model :free baru, perubahan harga, HANYA untuk model NON-Claude — 0-3 poin, sertakan link)
## ⚠️ Perhatian Keamanan
(WAJIB: kalau ada sinyal yang menunjukkan cara mengakses Claude lewat gateway/proxy pihak ketiga (OpenRouter, OpenModel, atau lainnya) — WAJIB tandai di sini sebagai 'JANGAN dipakai untuk Claude — risiko ban akun Team. Gunakan Claude Code CLI resmi.' Kalau tidak ada temuan seperti ini minggu ini, tulis 'Tidak ada temuan risiko minggu ini.')
Kalau salah satu section tidak ada isinya, tulis 'Tidak ada update relevan minggu ini.' Ringkas, to the point, cantumkan link tiap poin. JANGAN sertakan item yang tidak dari daftar sinyal di bawah — jangan mengarang.

DAFTAR SINYAL MENTAH:
${signalList}`

    const llmCfg = getLLMConfig() ?? { provider: 'claude-cli' as const, apiKey: '', model: 'claude' }
    const digest = await callLLM(prompt, llmCfg)

    // Step 4 — persist + fire-and-forget embedding for semantic search.
    const id = `sage-${weekOf}`
    await db.insert(sageDigests)
      .values({ id, weekOf, summary: digest, rawSignalCount })
      .onConflictDoUpdate({ target: sageDigests.id, set: { summary: digest, rawSignalCount, weekOf } })

    upsertEmbedding({
      sourceType: 'sage_digest',
      userId:     null,
      sourceId:   id,
      title:      `Sage AI Update — minggu ${weekOf}`,
      chunk:      digest,
    }).catch(() => {})

    // Step 5 — notify via Telegram (HTML mode; markdown converted to basic HTML).
    try {
      await sendTelegram(`🔭 <b>Sage</b> — Update AI Mingguan\n\n${mdToTelegramHtml(digest)}`)
    } catch (e) {
      console.warn('[sage] telegram send error:', e instanceof Error ? e.message : e)
    }

    return NextResponse.json({ ok: true, summary: digest, rawSignalCount, weekOf })
  } catch (e) {
    console.error('[sage] run error:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
