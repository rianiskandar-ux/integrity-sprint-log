import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { db, uploadedDocs } from '@/lib/db'
import { getRequestContext } from '@/lib/request-auth'
import { upsertEmbedding } from '@/lib/embeddings'

export const runtime = 'nodejs'
export const maxDuration = 120

// ── Doc Parser — upload endpoint ─────────────────────────────────────────────
// Accepts a PDF/Word file, extracts text, chunks it, and embeds each chunk
// into the shared `embeddings` table (sourceType='doc') so chat's hybridSearch
// picks it up automatically — no changes needed on the retrieval side.

const MAX_SIZE_BYTES = 10 * 1024 * 1024 // 10MB
const CHUNK_SIZE = 1500

const ALLOWED_EXT: Record<string, string> = {
  '.pdf':  'application/pdf',
  '.doc':  'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

function extOf(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i === -1 ? '' : filename.slice(i).toLowerCase()
}

/** Chunk text into ~CHUNK_SIZE-char pieces, preferring paragraph boundaries. */
function chunkText(text: string, size = CHUNK_SIZE): string[] {
  const clean = text.replace(/\r\n/g, '\n').trim()
  if (!clean) return []

  const paragraphs = clean.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  const chunks: string[] = []
  let current = ''

  for (const para of paragraphs) {
    // Paragraph itself too big — hard-cut it into size-sized pieces.
    if (para.length > size) {
      if (current) { chunks.push(current); current = '' }
      for (let i = 0; i < para.length; i += size) {
        chunks.push(para.slice(i, i + size))
      }
      continue
    }
    if ((current + '\n\n' + para).length > size) {
      if (current) chunks.push(current)
      current = para
    } else {
      current = current ? `${current}\n\n${para}` : para
    }
  }
  if (current) chunks.push(current)

  return chunks.filter(c => c.trim().length > 0)
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext()
    if (process.env.ISL_MULTIUSER === '1' && !ctx) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const form = await req.formData().catch(() => null)
    const file = form?.get('file')
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ ok: false, error: 'No file provided (field "file")' }, { status: 400 })
    }

    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json({ ok: false, error: `File too large — max ${MAX_SIZE_BYTES / 1024 / 1024}MB` }, { status: 400 })
    }

    const ext = extOf(file.name)
    if (!ALLOWED_EXT[ext]) {
      return NextResponse.json({ ok: false, error: 'Only .pdf, .doc, .docx are accepted' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    let text = ''
    try {
      if (ext === '.pdf') {
        // pdf-parse v1 (pure JS, no native canvas dep — v2 pulls in @napi-rs/canvas
        // which repeatedly crashed `npm ci` on this network; v1 is plenty for
        // text-only extraction, no rendering needed here).
        const pdfParse = (await import('pdf-parse')).default
        const result = await pdfParse(buffer)
        text = result.text ?? ''
      } else {
        const mammoth = await import('mammoth')
        const result = await mammoth.extractRawText({ buffer })
        text = result.value ?? ''
      }
    } catch (e) {
      console.error('[docs/upload] extraction error:', e)
      return NextResponse.json({ ok: false, error: 'Failed to extract text from file' }, { status: 400 })
    }

    const chunks = chunkText(text)
    if (chunks.length === 0) {
      return NextResponse.json({ ok: false, error: 'No extractable text found in file' }, { status: 400 })
    }

    const docId = `doc-${Date.now()}-${randomBytes(4).toString('hex')}`
    const userId = ctx?.uid ?? null

    for (let i = 0; i < chunks.length; i++) {
      await upsertEmbedding({
        userId,
        sourceType: 'doc',
        sourceId: `doc-${docId}-chunk-${i}`,
        title: `${file.name} (bagian ${i + 1}/${chunks.length})`,
        chunk: chunks[i],
      })
    }

    await db.insert(uploadedDocs).values({
      id: docId,
      userId,
      filename: file.name,
      chunkCount: chunks.length,
      sizeBytes: file.size,
    })

    return NextResponse.json({ ok: true, docId, filename: file.name, chunkCount: chunks.length })
  } catch (e) {
    console.error('[docs/upload] error:', e)
    return NextResponse.json({ ok: false, error: 'Upload failed' }, { status: 500 })
  }
}
