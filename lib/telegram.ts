import { loadUserConfig } from './user-config'

export interface TelegramConfig {
  botToken: string
  chatId:   string
}

export function getTelegramConfig(): TelegramConfig | null {
  const cfg = loadUserConfig()
  if (!cfg.telegramEnabled) return null
  if (!cfg.telegramBotToken || !cfg.telegramChatId) return null
  return { botToken: cfg.telegramBotToken, chatId: cfg.telegramChatId }
}

export async function sendTelegram(message: string, config?: TelegramConfig): Promise<boolean> {
  const tg = config ?? getTelegramConfig()
  if (!tg) return false
  try {
    const res = await fetch(`https://api.telegram.org/bot${tg.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:    tg.chatId,
        text:       message,
        parse_mode: 'HTML',
      }),
    })
    return res.ok
  } catch {
    return false
  }
}

// ── Notification templates ────────────────────────────────────────────────────

export function notifIncoming(count: number, previews: { id: number; subject: string }[]): string {
  const lines = previews.slice(0, 3).map(t => `  › #${t.id} ${t.subject}`).join('\n')
  return `📥 <b>${count} incoming task${count > 1 ? 's' : ''} baru dari OP</b>\n${lines}${count > 3 ? `\n  › +${count - 3} lainnya` : ''}\n\n<i>Buka ISL → Incoming untuk review</i>`
}

export function notifPushQueue(count: number, sessions: { title: string }[]): string {
  const lines = sessions.slice(0, 3).map(s => `  › ${s.title}`).join('\n')
  return `📤 <b>${count} session menunggu push ke OP</b>\n${lines}\n\n<i>Buka ISL → Push Queue untuk approve</i>`
}

export function notifPushed(title: string, opTaskId: number | null, mins: number): string {
  const dur = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`
  const task = opTaskId ? `OP #${opTaskId}` : 'task baru'
  return `✅ <b>Session di-push ke OP</b>\n  › ${title}\n  › ${task} — ${dur} logged`
}

export function notifSprintDeadline(sprintName: string, daysLeft: number, pct: number): string {
  const emoji = daysLeft <= 1 ? '🚨' : daysLeft <= 3 ? '⚠️' : '🏃'
  const days  = daysLeft === 0 ? 'berakhir hari ini' : `${daysLeft} hari lagi`
  return `${emoji} <b>${sprintName}</b> — ${days}\n  › Progress: ${pct}% selesai\n\n<i>Buka ISL → Sprint Plan</i>`
}

export function notifSessionLogged(title: string, mins: number): string {
  const dur = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`
  return `🤖 <b>Auto Log: session tercatat</b>\n  › ${title}\n  › Durasi: ${dur}\n\n<i>Perlu review? Buka ISL → Push Queue</i>`
}
