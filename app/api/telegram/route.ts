import { NextRequest, NextResponse } from 'next/server'
import { sendTelegram, getTelegramConfig, notifIncoming, notifPushQueue, notifPushed, notifSprintDeadline, notifSessionLogged } from '@/lib/telegram'
import { loadUserConfig, saveUserConfig } from '@/lib/user-config'
import { getRequestContext } from '@/lib/request-auth'
import { isOwnerUid } from '@/lib/auth'

export const runtime = 'nodejs'

// This config is the single OWNER-global Telegram config (loadUserConfig/
// saveUserConfig — same file as /api/user-config). No owner gate existed on
// any handler here: any logged-in teammate could silently overwrite or
// disable the owner's bot token/chat ID (PATCH), read the owner's chatId +
// masked token (GET), or have their "test" ping delivered via/to the owner's
// Telegram instead of their own (the old `cfg.x || data?.x` order below).
async function requireOwner(): Promise<boolean> {
  const ctx = await getRequestContext()
  return isOwnerUid(ctx?.uid)
}

// POST /api/telegram — send a notification
export async function POST(req: NextRequest) {
  const { type, data, test } = await req.json() as {
    type: string
    data?: Record<string, unknown>
    test?: boolean
  }

  // Test ping — caller-supplied credentials win (a teammate testing their OWN
  // token/chatId should never silently ping the owner's Telegram instead).
  if (test) {
    const cfg = loadUserConfig()
    const botToken = (data?.botToken as string) || cfg.telegramBotToken || ''
    const chatId   = (data?.chatId   as string) || cfg.telegramChatId   || ''
    if (!botToken || !chatId) return NextResponse.json({ ok: false, reason: 'missing token or chatId' })
    const ok = await sendTelegram(
      `✅ <b>ISL Notifier connected!</b>\n\nHai <b>${cfg.displayName || 'Rian'}</b> 👋\nNotifikasi ISL sudah aktif di device ini.\n\n<i>Integrity Sprint Log</i>`,
      { botToken, chatId }
    )
    return NextResponse.json({ ok })
  }

  const cfg = getTelegramConfig()
  if (!cfg) return NextResponse.json({ ok: false, reason: 'telegram not configured' })

  let message = ''
  switch (type) {
    case 'incoming':
      message = notifIncoming(data?.count as number, data?.previews as { id: number; subject: string }[])
      break
    case 'push_queue':
      message = notifPushQueue(data?.count as number, data?.sessions as { title: string }[])
      break
    case 'pushed':
      message = notifPushed(data?.title as string, data?.opTaskId as number | null, data?.mins as number)
      break
    case 'sprint_deadline':
      message = notifSprintDeadline(data?.sprintName as string, data?.daysLeft as number, data?.pct as number)
      break
    case 'session_logged':
      message = notifSessionLogged(data?.title as string, data?.mins as number)
      break
    default:
      message = data?.message as string ?? 'ISL notification'
  }

  const ok = await sendTelegram(message, cfg)
  return NextResponse.json({ ok })
}

// PATCH /api/telegram — save config (only update botToken if provided)
export async function PATCH(req: NextRequest) {
  if (!(await requireOwner())) return NextResponse.json({ error: 'Owner only' }, { status: 403 })
  const { botToken, chatId, enabled } = await req.json()
  const update: Record<string, unknown> = {
    telegramChatId:  chatId  ?? '',
    telegramEnabled: enabled ?? false,
  }
  if (botToken) update.telegramBotToken = botToken  // never wipe existing token
  saveUserConfig(update as Parameters<typeof saveUserConfig>[0])
  return NextResponse.json({ ok: true })
}

// GET /api/telegram — get current config (masked)
export async function GET() {
  if (!(await requireOwner())) return NextResponse.json({ error: 'Owner only' }, { status: 403 })
  const cfg = loadUserConfig()
  return NextResponse.json({
    enabled:      cfg.telegramEnabled,
    configured:   !!(cfg.telegramBotToken && cfg.telegramChatId),
    chatId:       cfg.telegramChatId,
    tokenMasked:  cfg.telegramBotToken ? cfg.telegramBotToken.slice(0, 8) + '...' : '',
  })
}
