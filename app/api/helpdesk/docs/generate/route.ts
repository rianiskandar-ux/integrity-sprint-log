import { NextResponse } from 'next/server'
import { getRequestContext } from '@/lib/request-auth'
import { isOwnerUid } from '@/lib/auth'
import { createStructuredDoc, type DocBlock } from '@/lib/google-docs'

export const runtime = 'nodejs'

// POST /api/helpdesk/docs/generate — creates (or re-creates) the Helpdesk
// system documentation as a real, editable Google Doc in the owner's Drive,
// then returns its link. Owner-only: this writes to the owner's own Google
// account. First real use of lib/google-docs.ts. The doc is a living first
// draft — meant to be edited in Docs afterward, not a frozen artifact.
export async function POST() {
  const ctx = await getRequestContext()
  if (process.env.ISL_MULTIUSER === '1' && !ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (process.env.ISL_MULTIUSER === '1' && !isOwnerUid(ctx?.uid)) {
    return NextResponse.json({ error: 'Owner only' }, { status: 403 })
  }

  const today = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
  const blocks: DocBlock[] = [
    { style: 'TITLE',       text: 'ISL Helpdesk & QA Validation Pipeline — Dokumentasi Sistem' },
    { style: 'NORMAL_TEXT', text: `Dibuat otomatis oleh ISL · ${today}. Dokumen ini draft awal yang bisa diedit langsung di Google Docs.` },

    { style: 'HEADING_1',   text: '1. Gambaran Umum' },
    { style: 'NORMAL_TEXT', text: 'Pipeline ini mengubah tiket helpdesk (Inquiries di OpenProject) menjadi alur triase yang tertata: Tika membaca dan menilai tiap tiket, hasilnya ditinjau manusia (Aufa/owner), lalu tiket yang valid dirutekan ke orang yang benar-benar ditugaskan di OP. Semua otomatisasi bersifat "shadow mode" — Tika TIDAK pernah menulis ke OP sendiri; keputusan tetap di tangan manusia.' },

    { style: 'HEADING_1',   text: '2. Tika — Agen Triase' },
    { style: 'NORMAL_TEXT', text: 'Tika berjalan otomatis via cron Launcher tiap ~30 menit (jam kerja, hari kerja). Untuk tiap tiket yang berubah isinya, Tika melakukan:' },
    { style: 'HEADING_2',   text: 'a. Klasifikasi' },
    { style: 'NORMAL_TEXT', text: 'Menentukan jenis tiket: bug, request, question, atau unclear. Hanya tiket "bug" yang masuk antrean keputusan QA Aufa; sisanya info-only.' },
    { style: 'HEADING_2',   text: 'b. Cek Kelengkapan (Clarity)' },
    { style: 'NORMAL_TEXT', text: 'Mengecek apakah tiket punya langkah reproduksi dan penjelasan "harusnya apa vs yang terjadi". Kalau ada yang kurang, dicatat.' },
    { style: 'HEADING_2',   text: 'c. Deteksi Duplikat' },
    { style: 'NORMAL_TEXT', text: 'Membandingkan tiket dengan tiket lain via embedding (kemiripan makna). Tiket yang mirip ditandai sebagai kemungkinan duplikat, dengan link ke tiket terkait.' },
    { style: 'HEADING_2',   text: 'd. Konteks Nyata (bukan asumsi)' },
    { style: 'NORMAL_TEXT', text: 'Sebelum menilai, Tika membaca konteks di luar teks tiket: work package terkait di OP (relations) dan file Google yang di-link di deskripsi (Google Sheets, Docs, Drive). Ini supaya penilaian berdasarkan data nyata, bukan tebakan.' },
    { style: 'HEADING_2',   text: 'e. Draft Pertanyaan ke Pelapor (Phase 1)' },
    { style: 'NORMAL_TEXT', text: 'Kalau tiket bug kurang informasi, Tika menyiapkan DRAFT pertanyaan untuk pelapor. Draft ini TIDAK langsung terkirim — muncul di kotak "Tanya ke pelapor" di menu Helpdesk, untuk ditinjau/diedit Aufa atau owner, baru dikirim manual (jadi komentar OP atas nama pengirim sendiri).' },

    { style: 'HEADING_1',   text: '3. Antrean QA & Keputusan' },
    { style: 'NORMAL_TEXT', text: 'Menu Helpdesk di ISL menampilkan tiket bug beserta temuan Tika (klasifikasi, kelengkapan, dugaan duplikat). Tampilan ini TRANSPARAN — semua anggota tim bisa melihatnya. Tapi tombol keputusan (PASS) hanya bisa diklik oleh Aufa (role=qa) atau owner; untuk yang lain tombol tampil terkunci.' },
    { style: 'NORMAL_TEXT', text: 'PASS = tiket bug valid. REJECT tidak punya tombol: penolakan dilakukan langsung di OP (ubah status), dan karena scope Inquiries hanya tiket terbuka, tiket yang ditolak otomatis hilang dari intake pada poll berikutnya.' },

    { style: 'HEADING_1',   text: '4. Routing Setelah PASS' },
    { style: 'NORMAL_TEXT', text: 'Saat sebuah tiket di-PASS, ISL membuat entri Push Queue untuk orang yang DITUGASKAN di OP (assignee) — bukan otomatis ke owner. Kalau tiket belum ada assignee-nya, atau assignee-nya belum punya akun ISL, tiket tetap ditandai [UNASSIGNED] dan menunggu — tidak pernah jatuh ke antrean owner sebagai default.' },

    { style: 'HEADING_1',   text: '5. Correction Loop (Tika belajar dari kesalahan)' },
    { style: 'NORMAL_TEXT', text: 'Kalau tiket yang Tika klasifikasikan "bug" ternyata akhirnya ditolak (Rejected) di OP, itu dicatat sebagai koreksi dan di-embed. Saat menilai tiket baru yang mirip, riwayat koreksi ini disuntikkan sebagai konteks ke prompt Tika — bukan mengubah label otomatis, tapi memberi tahu "pola seperti ini pernah salah". Ini pola yang sama dengan correction loop Arka.' },

    { style: 'HEADING_1',   text: '6. Vera — QA Otomatis (rencana, belum jalan)' },
    { style: 'NORMAL_TEXT', text: 'Vera akan menjalankan tes Playwright berdasarkan tiket untuk memverifikasi bug bisa direproduksi, lalu melampirkan bukti (screenshot/langkah) ke antrean QA. Vera berhenti di bukti — tidak memberi verdict approve/reject. Masih menunggu info dari Aufa: URL staging, akun test, perbedaan environment, hal yang harus dihindari.' },

    { style: 'HEADING_1',   text: '7. Prinsip & Batasan' },
    { style: 'NORMAL_TEXT', text: '• Shadow mode: Tika tidak pernah menulis ke OP. • OP tetap sumber kebenaran; tabel helpdesk ISL hanya turunan yang aman dibangun ulang. • Keputusan (PASS, kirim pertanyaan) selalu aksi manusia. • Rate limit: kirim komentar ke pelapor dibatasi 5x per user per 5 menit.' },
  ]

  const result = await createStructuredDoc('ISL Helpdesk — Dokumentasi Sistem', blocks, ctx?.uid)
  const status = result.ok ? 200 : 500
  return NextResponse.json(result, { status })
}
