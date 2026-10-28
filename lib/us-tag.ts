/**
 * Compress a User Story title into a short tag for SprintRecap's child-task
 * rows (Rian 2026-08-31: the first cut just stripped the shared prefix
 * entirely, which lost all context — "Install & Pin Project-Scope Skills"
 * alone doesn't say which US it's under once you've scrolled past the header).
 * This keeps a short recognizable label instead of dropping it to nothing.
 *
 * Deliberately LLM-based, not regex: the examples Rian gave keep different
 * PARTS of the source string each time (leading "Phoenix v2:" + a parenthetical
 * in one case, a middle noun phrase while dropping the leading "v2:" in
 * another) — there's no single mechanical rule that reproduces both without
 * also mangling titles that don't fit the pattern.
 */
import { callLocalLLM } from './local-llm'

const FEW_SHOT = `Contoh:
Judul: "Phoenix v2: interactive system maps (Archify) + presentation wiring"
Tag: Phoenix v2: Archify

Judul: "BE - Remove the hardcoded sales inbox and close the untested delivery paths"
Tag: BE: untested delivery paths

Judul: "v2: System 6 - second workspace for an existing account"
Tag: System 6`

export async function suggestUsTag(subject: string): Promise<string> {
  const fallback = subject.length <= 40 ? subject : subject.slice(0, 37) + '…'
  try {
    const prompt = `Ringkas judul User Story ini jadi TAG pendek (2-5 kata, tanpa tanda kutip) yang paling mewakili — bukan potongan awal kalimat, tapi bagian yang paling BEDA/dikenali dari judul lain. Boleh gabung prefix + kata kunci pakai titik dua kalau perlu.

Buang prefix generik yang cuma versi/nomor telanjang seperti "v2:", "V2 -", "Phase 1:" KALAU sisanya sudah cukup dikenali sendiri (contoh: "v2: System 6 - ..." -> "System 6", bukan "v2: System 6"). Prefix generik BOLEH dipertahankan hanya kalau digabung dengan nama spesifik yang menambah makna (contoh: "Phoenix v2: ... (Archify) ..." -> "Phoenix v2: Archify", karena "Phoenix v2" sendiri sudah nama produk, bukan sekadar nomor versi).

Balas HANYA tag-nya, satu baris.

${FEW_SHOT}

Judul: "${subject}"
Tag:`
    const raw = await callLocalLLM(prompt)
    if (raw) {
      const line = raw.trim().split('\n')[0].replace(/^["'\s]+/, '').replace(/["'\s]+$/, '')
      if (line.length >= 2 && line.length <= 60) return line
    }
  } catch { /* fall through */ }
  return fallback
}
