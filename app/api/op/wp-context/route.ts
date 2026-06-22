import { getOpToken, getOpBaseUrl } from '@/lib/user-config'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

// GET /api/op/wp-context?wpId=123
// Tarik konteks LENGKAP & LIVE dari ticket OP: deskripsi, hierarki induk
// (story→epic→feature), komentar/activity, daftar lampiran. Untuk di-inject ke chat AI.

function authHeader(token: string) {
  return 'Basic ' + Buffer.from(`apikey:${token}`).toString('base64')
}

async function opGet(base: string, token: string, path: string) {
  const res = await fetch(`${base}/api/v3${path}`, { headers: { Authorization: authHeader(token) } })
  if (!res.ok) throw new Error(`OP ${path} → HTTP ${res.status}`)
  return res.json()
}

function parentIdOf(wp: { _links?: { parent?: { href?: string } } }): number | null {
  const href = wp?._links?.parent?.href
  if (!href) return null
  const id = parseInt(href.split('/').pop() ?? '')
  return Number.isFinite(id) ? id : null
}

export async function GET(req: Request) {
  const wpId = new URL(req.url).searchParams.get('wpId')
  if (!wpId) return NextResponse.json({ error: 'wpId required' }, { status: 400 })

  const base = (getOpBaseUrl() || '').replace(/\/$/, '')
  const token = getOpToken()
  if (!base || !token) return NextResponse.json({ error: 'OP not configured' }, { status: 400 })

  try {
    // 1) WP utama
    const wp = await opGet(base, token, `/work_packages/${wpId}`)
    const main = {
      id: wp.id,
      subject: wp.subject as string,
      type: wp._links?.type?.title ?? 'Task',
      status: wp._links?.status?.title ?? '',
      description: (wp.description?.raw ?? '').slice(0, 2000),
    }

    // 2) Hierarki induk (naik max 3 level: story → epic → feature)
    const hierarchy: { type: string; id: number; subject: string; description: string }[] = []
    let pid = parentIdOf(wp)
    let hops = 0
    while (pid && hops < 3) {
      try {
        const p = await opGet(base, token, `/work_packages/${pid}`)
        hierarchy.push({
          type: p._links?.type?.title ?? 'Parent',
          id: p.id,
          subject: p.subject,
          description: (p.description?.raw ?? '').slice(0, 800),
        })
        pid = parentIdOf(p)
      } catch { break }
      hops++
    }

    // 3) Komentar / activity (ambil yang ada comment raw, max 10 terakhir)
    let comments: { user: string; at: string; text: string }[] = []
    try {
      const act = await opGet(base, token, `/work_packages/${wpId}/activities`)
      const els = (act._embedded?.elements ?? []) as Array<{
        comment?: { raw?: string }; createdAt?: string; _links?: { user?: { title?: string } }
      }>
      comments = els
        .filter(a => (a.comment?.raw ?? '').trim().length > 0)
        .slice(-10)
        .map(a => ({
          user: a._links?.user?.title ?? '—',
          at: (a.createdAt ?? '').slice(0, 10),
          text: (a.comment!.raw ?? '').slice(0, 600),
        }))
    } catch { /* activities optional */ }

    // 4) Lampiran (nama + ukuran saja; isi file = Phase 2)
    let attachments: { name: string; size: number }[] = []
    try {
      const att = await opGet(base, token, `/work_packages/${wpId}/attachments`)
      attachments = ((att._embedded?.elements ?? []) as Array<{ fileName?: string; fileSize?: number }>)
        .map(a => ({ name: a.fileName ?? 'file', size: a.fileSize ?? 0 }))
    } catch { /* attachments optional */ }

    // Pre-format jadi teks siap inject ke system prompt
    const lines: string[] = []
    lines.push(`KONTEKS TICKET OP (live dari OpenProject):`)
    lines.push(`#${main.id} [${main.type}] ${main.subject} — status: ${main.status}`)
    if (main.description) lines.push(`\nDeskripsi:\n${main.description}`)
    if (hierarchy.length) {
      lines.push(`\nHierarki induk:`)
      hierarchy.forEach((h, i) => {
        lines.push(`${'  '.repeat(i + 1)}↳ [${h.type}] #${h.id} ${h.subject}`)
        if (h.description) lines.push(`${'  '.repeat(i + 1)}   ${h.description.replace(/\n/g, ' ').slice(0, 300)}`)
      })
    }
    if (comments.length) {
      lines.push(`\nKomentar/aktivitas terakhir:`)
      comments.forEach(c => lines.push(`• [${c.at}] ${c.user}: ${c.text}`))
    }
    if (attachments.length) {
      lines.push(`\nLampiran (nama saja — isi belum dibaca):`)
      attachments.forEach(a => lines.push(`• ${a.name} (${Math.round(a.size / 1024)} KB)`))
    }

    return NextResponse.json({
      ok: true,
      context: { main, hierarchy, comments, attachments },
      text: lines.join('\n'),
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
