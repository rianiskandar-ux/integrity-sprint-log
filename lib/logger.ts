import winston from 'winston'
import 'winston-daily-rotate-file'
import path from 'path'

// Error/event logging. Files di CACHE_DATA_DIR/logs (volume isl-data → persist).
// Rotate harian, simpan 30 hari. Juga ke console (ke-capture docker logs).
const LOG_DIR = path.join(process.env.CACHE_DATA_DIR ?? process.cwd(), 'logs')

const rotate = new winston.transports.DailyRotateFile({
  dirname: LOG_DIR,
  filename: 'isl-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxFiles: '30d',
  level: 'info',
})

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  transports: [
    rotate,
    new winston.transports.Console({
      format: winston.format.combine(winston.format.timestamp(), winston.format.simple()),
    }),
  ],
})

// Telegram alert untuk error kritis — throttle biar nggak spam (max 1/menit per pesan sama).
const lastAlert = new Map<string, number>()
export async function alertCritical(title: string, detail: string) {
  try {
    const key = title.slice(0, 80)
    const now = Date.now()
    if (now - (lastAlert.get(key) ?? 0) < 60_000) return
    lastAlert.set(key, now)
    const { sendTelegram } = await import('./telegram')
    await sendTelegram(`🚨 ISL ERROR: ${title}\n${detail.slice(0, 500)}`)
  } catch { /* alert best-effort */ }
}
