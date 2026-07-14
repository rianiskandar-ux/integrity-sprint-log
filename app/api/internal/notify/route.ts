import { NextResponse } from 'next/server'
import { sendTelegram, getTelegramConfig } from '@/lib/telegram'

// Relay Telegram untuk service eksternal (Launcher/Nara) — pakai bot ISL yang
// sudah dikonfigurasi, jadi service lain tidak perlu simpan token sendiri.
const KAFI_KEY = process.env.KAFI_API_KEY

function authed(req: Request): boolean {
  const url = new URL(req.url)
  return req.headers.get('x-kafi-key') === KAFI_KEY || url.searchParams.get('key') === KAFI_KEY
}

// GET — capability probe: apakah Telegram terkonfigurasi & enabled
export async function GET(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json({ configured: !!getTelegramConfig() })
}

// POST { message } — kirim via bot ISL (HTML parse mode)
export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const { message } = await req.json()
    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'message required' }, { status: 400 })
    }
    const ok = await sendTelegram(message.slice(0, 4000))
    return NextResponse.json({ ok, configured: !!getTelegramConfig() })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
