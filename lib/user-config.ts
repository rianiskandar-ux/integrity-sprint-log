import fs from 'fs'
import path from 'path'
import { encrypt, decrypt } from './crypto'

const CONFIG_DIR  = process.env.CACHE_DATA_DIR || process.cwd()
const CONFIG_FILE = path.join(CONFIG_DIR, 'user-config.json')

// Fields encrypted at rest. Transparent: stored ciphertext, returned plaintext.
const SECRET_FIELDS = ['opToken', 'anthropicKey', 'llmApiKey', 'telegramBotToken'] as const

export interface UserConfig {
  displayName:      string
  opBaseUrl:        string
  opProjectId:      string
  opToken:          string
  anthropicKey:     string   // legacy
  llmProvider:      string
  llmApiKey:        string
  llmModel:         string
  llmEffort:        string   // reasoning effort untuk claude-cli: low|medium|high|max ('' = default)
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
  llmEffort:        '',
  setupDone:        false,
  updatedAt:        '',
  telegramBotToken: '',
  telegramChatId:   '',
  telegramEnabled:  false,
}

export function loadUserConfig(): UserConfig {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return EMPTY
    const cfg = { ...EMPTY, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) } as UserConfig
    // Decrypt secret fields (plaintext passes through for backward compat)
    for (const f of SECRET_FIELDS) {
      if (cfg[f]) (cfg[f] as string) = decrypt(cfg[f] as string)
    }
    return cfg
  } catch {
    return EMPTY
  }
}

export function saveUserConfig(partial: Partial<UserConfig>): UserConfig {
  const existing = loadUserConfig()
  const updated: UserConfig = { ...existing, ...partial, updatedAt: new Date().toISOString() }
  // Encrypt secret fields before writing to disk
  const onDisk: UserConfig = { ...updated }
  for (const f of SECRET_FIELDS) {
    if (onDisk[f]) (onDisk[f] as string) = encrypt(onDisk[f] as string)
  }
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(onDisk, null, 2))
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
