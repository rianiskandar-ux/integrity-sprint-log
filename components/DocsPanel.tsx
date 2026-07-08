'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { FileText, Upload, Trash2, Loader2, CheckCircle2 } from 'lucide-react'
import ConfirmModal from './ConfirmModal'

// ── Doc Parser — 📄 Dokumen ───────────────────────────────────────────────────
// Upload PDF/Word files → extracted, chunked, and embedded into the shared
// pgvector `embeddings` table (sourceType='doc') via app/api/docs/upload.
// Chat's hybridSearch picks these up automatically — no wiring needed here
// beyond upload + list + delete.

interface DocRow {
  id: string
  filename: string
  chunkCount: number
  sizeBytes: number
  uploadedAt: string
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function DocsPanel() {
  const [docs, setDocs]         = useState<DocRow[]>([])
  const [loading, setLoading]   = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [toast, setToast]       = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<DocRow | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/docs')
      const json = await r.json()
      if (json.ok) setDocs(json.docs ?? [])
    } catch { /* offline — keep last known list */ }
  }, [])

  useEffect(() => {
    setLoading(true)
    load().finally(() => setLoading(false))
  }, [load])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  async function handleFile(file: File) {
    setError(null)
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const r = await fetch('/api/docs/upload', { method: 'POST', body: form })
      const json = await r.json()
      if (!json.ok) {
        setError(json.error ?? 'Upload failed')
      } else {
        setToast(`"${json.filename}" uploaded — ${json.chunkCount} chunks embedded`)
        await load()
      }
    } catch {
      setError('Upload failed — check connection')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    const doc = pendingDelete
    setPendingDelete(null)
    try {
      const r = await fetch('/api/docs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId: doc.id }),
      })
      const json = await r.json()
      if (json.ok) {
        setDocs(prev => prev.filter(d => d.id !== doc.id))
        setToast(`"${doc.filename}" deleted`)
      } else {
        setError(json.error ?? 'Delete failed')
      }
    } catch {
      setError('Delete failed — check connection')
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div>
        <h2 className="text-base font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <FileText size={16} /> Dokumen
        </h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Upload PDF/Word — extracted, chunked, and embedded so chat can retrieve from them.
        </p>
      </div>

      {/* Upload box */}
      <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 flex flex-col items-center justify-center gap-3 text-center">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.doc,.docx"
          className="hidden"
          id="doc-upload-input"
          disabled={uploading}
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) handleFile(f)
          }}
        />
        {uploading ? (
          <>
            <Loader2 size={22} className="animate-spin text-indigo-500" />
            <p className="text-xs text-gray-500 dark:text-gray-400">Extracting, chunking &amp; embedding…</p>
          </>
        ) : (
          <>
            <Upload size={22} className="text-gray-400" />
            <label
              htmlFor="doc-upload-input"
              className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition"
            >
              <Upload size={12} /> Choose file to upload
            </label>
            <p className="text-[11px] text-gray-400">PDF, DOC, or DOCX — max 10MB</p>
          </>
        )}
      </div>

      {error && (
        <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/50 border border-red-100 dark:border-red-900 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {toast && (
        <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-100 dark:border-emerald-900 rounded-lg px-3 py-2">
          <CheckCircle2 size={13} className="flex-shrink-0" /> {toast}
        </div>
      )}

      {/* List */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2">Uploaded documents</h3>
        {loading ? (
          <div className="text-center text-gray-400 text-xs py-8">Loading…</div>
        ) : docs.length === 0 ? (
          <div className="text-center text-gray-400 text-xs py-8 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
            No documents uploaded yet.
          </div>
        ) : (
          <div className="space-y-2">
            {docs.map(doc => (
              <div
                key={doc.id}
                className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5"
              >
                <FileText size={16} className="text-indigo-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">{doc.filename}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {doc.chunkCount} chunks · {formatSize(doc.sizeBytes)} · {new Date(doc.uploadedAt).toLocaleString()}
                  </p>
                </div>
                <button
                  onClick={() => setPendingDelete(doc)}
                  title="Delete"
                  className="flex-shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {pendingDelete && (
        <ConfirmModal
          title="Delete document?"
          description={`"${pendingDelete.filename}" and all ${pendingDelete.chunkCount} of its embedded chunks will be removed.`}
          whatHappens="The document will no longer be retrievable from chat. This cannot be undone."
          confirmLabel="Delete"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}
