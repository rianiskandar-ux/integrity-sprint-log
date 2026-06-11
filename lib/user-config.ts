import fs from 'fs'
import path from 'path'

const CONFIG_DIR  = process.env.CACHE_DATA_DIR || process.cwd()
const CONFIG_FILE = path.join(CONFIG_DIR, 'user-config.json')

export interface UserConfig {
  displayName:      string
  opBaseUrl:        string
  opProjectId:      string
  opToken:          string
  anthropicKey:     string   // legacy
  llmProvider:      string
  llmApiKey:        string
  llmModel:         string
  setupDone:        boolean
  updatedAt:        string
  telegramBotToken: string   // per-user Telegram bot token
  telegramChatId:   string   // per-user Telegram chat ID
  telegramEnabled:  boolean  // master switch
}

const EMPTY: UserConfig = {
  displayName:      '',
  opBaseUrl:        '',
  opProjectId:      '',
  opToken:          '',
  anthropicKey:     '',
  llmProvider:      '',
  llmApiKey:        '',
  llmModel:         '',
  setupDone:        false,
  updatedAt:        '',
  telegramBotToken: '',
  telegramChatId:   '',
  telegramEnabled:  false,
}

export function loadUserConfig(): UserConfig {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return EMPTY
    return { ...EMPTY, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) }
  } catch {
    return EMPTY
  }
}

export function saveUserConfig(partial: Partial<UserConfig>): UserConfig {
  const existing = loadUserConfig()
  const updated: UserConfig = { ...existing, ...partial, updatedAt: new Date().toISOString() }
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2))
  return updated
}

export function isSetupDone(): boolean {
  const cfg = loadUserConfig()
  return cfg.setupDone && !!cfg.opToken && !!getOpBaseUrl()
}

/** Effective OP base URL: user-config → .env.local */
export function getOpBaseUrl(): string {
  const cfg = loadUserConfig()
  return cfg.opBaseUrl || process.env.OP_BASE_URL || ''
}

/** Effective OP project ID: user-config → .env.local */
export function getOpProjectId(): string {
  const cfg = loadUserConfig()
  return cfg.opProjectId || process.env.OP_PROJECT_ID || ''
}

/** Effective OP token: user-config → .env.local */
export function getOpToken(): string {
  const cfg = loadUserConfig()
  return cfg.opToken || process.env.OP_API_TOKEN || ''
}

/** Effective Anthropic key: user-config → .env.local */
export function getAnthropicKey(): string {
  const cfg = loadUserConfig()
  return cfg.anthropicKey || process.env.ANTHROPIC_API_KEY || ''
}
