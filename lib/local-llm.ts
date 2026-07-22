/**
 * Local-first LLM helper — Ollama (qwen2.5:3b) sebagai otak utama summarization,
 * gratis & offline. Pattern terbukti di hooks/isl-context.mjs (callOllama).
 *
 * PENTING: untuk output terstruktur, WAJIB pass `schema` = full JSON Schema object.
 * `format` dengan schema penuh → constrained decoding, struktur DIJAMIN persis.
 * format:'json' saja TIDAK cukup — model 3B suka meratakan skema (field naik ke
 * level atas, array kosong).
 *
 * Kontrak: return trimmed response, atau null pada KEGAGALAN APA PUN (HTTP error,
 * timeout, Ollama mati, response kosong). Tidak pernah throw — caller cukup cek
 * null lalu fallback ke Claude (capture-bias: kualitas tidak boleh degrade diam-diam).
 *
 * Ketahanan model (2026-07-22): OLLAMA_CHAT_MODEL boleh berisi DAFTAR model
 * dipisah koma, dicoba berurutan — mis. "qwen2.5:14b,qwen2.5:3b" berarti pakai
 * 14b sebagai utama, dan kalau server/model itu mati/timeout, OTOMATIS turun ke
 * 3b tanpa error — bukan langsung lompat ke fallback cloud si caller. Satu model
 * (perilaku lama) tetap jalan apa adanya.
 */
async function tryOllamaModel(base: string, model: string, prompt: string, schema: object | undefined, timeoutMs: number): Promise<string | null> {
  try {
    const res = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        ...(schema ? { format: schema } : {}),
        options: { temperature: 0.2, num_ctx: 8192 },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return null
    const d = await res.json() as { response?: string }
    const out = (d.response ?? '').trim()
    return out || null
  } catch {
    return null
  }
}

export async function callLocalLLM(prompt: string, schema?: object, opts?: { timeoutMs?: number }): Promise<string | null> {
  const base = process.env.OLLAMA_URL || 'http://localhost:11434'
  // Daftar model utama→cadangan (koma). Default satu model = perilaku lama.
  const models = (process.env.OLLAMA_CHAT_MODEL || 'qwen2.5:3b')
    .split(',').map(m => m.trim()).filter(Boolean)
  // 90s default cukup untuk output pendek/sedang (mayoritas pemakaian).
  // Caller yang minta output PANJANG (mis. aryo/narrative: 3 seksi naratif)
  // boleh menaikkan — model 3B butuh >90s untuk generate sepanjang itu,
  // dan timeout yang pasti gagal = 90s terbuang percuma sebelum fallback.
  const timeoutMs = opts?.timeoutMs ?? 90_000

  for (const model of models) {
    const out = await tryOllamaModel(base, model, prompt, schema, timeoutMs)
    if (out) return out
    // model ini gagal (mati/timeout/kosong) → coba model berikutnya di daftar
  }
  return null
}
