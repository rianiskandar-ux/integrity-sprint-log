export interface TeamMember {
  id: number
  name: string
  href: string
}

export interface OPProject {
  id: number
  identifier: string
  name: string
  href: string
  keywords: string[]
}

export interface SprintVersion {
  id: number
  name: string
  startDate: string
  endDate: string
  status: string
  isCurrent?: boolean
}

export interface AppConfig {
  appName: string
  appLogo: string        // emoji atau URL gambar
  orgName: string
  orgUrl: string
  opUrl: string          // link ke OP instance
  socialLinks: Array<{ label: string; url: string }>
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  appName: 'Integrity Sprint Log',
  appLogo: '🚀',
  orgName: 'Integrity Asia',
  orgUrl: 'https://integrity-asia.com',
  opUrl: 'https://tokek.integrity-asia.com',
  socialLinks: [],
}

const APP_CONFIG_KEY = 'isl_app_config'

export function loadAppConfig(): AppConfig {
  if (typeof window === 'undefined') return DEFAULT_APP_CONFIG
  try {
    const raw = localStorage.getItem(APP_CONFIG_KEY)
    if (!raw) return DEFAULT_APP_CONFIG
    return { ...DEFAULT_APP_CONFIG, ...JSON.parse(raw) }
  } catch { return DEFAULT_APP_CONFIG }
}

export function saveAppConfig(c: AppConfig): void {
  localStorage.setItem(APP_CONFIG_KEY, JSON.stringify(c))
}

export type WPStatus = 'in_progress' | 'on_hold' | 'done' | 'rejected' | 'new'

export const WP_STATUSES: { id: WPStatus; label: string; color: string; opId: number }[] = [
  { id: 'new',         label: 'Ready',       color: '#6b7280', opId: 1  },
  { id: 'in_progress', label: 'In Progress', color: '#3b82f6', opId: 7  },
  { id: 'on_hold',     label: 'On Hold',     color: '#f59e0b', opId: 8  },
  { id: 'done',        label: 'Done',        color: '#10b981', opId: 12 },
  { id: 'rejected',    label: 'Rejected',    color: '#ef4444', opId: 6  },
]

export interface UserSettings {
  userId: number
  userName: string
  userHref: string
  defaultAccountableId: number | null
  defaultProjectIdentifier: string
  watchedProjects: string[]
  defaultVersionId: number | null
  opApiToken: string
  setupDone: boolean
}

export const TEAM_MEMBERS: TeamMember[] = [
  { id: 8,  name: 'Rian Iskandar',      href: '/api/v3/users/8' },
  { id: 5,  name: 'Nicolas Georget',    href: '/api/v3/users/5' },
  { id: 6,  name: 'Rizal Kahfi',        href: '/api/v3/users/6' },
  { id: 7,  name: 'Sahid Prasetyo',     href: '/api/v3/users/7' },
  { id: 10, name: 'Muhammad Aufa Athallah', href: '/api/v3/users/10' },
  { id: 12, name: 'Apip Subarkah',      href: '/api/v3/users/12' },
  { id: 26, name: 'Ijal Fauzi',         href: '/api/v3/users/26' },
  { id: 34, name: 'Ferdian Nugraha',    href: '/api/v3/users/34' },
]

export const OP_PROJECTS: OPProject[] = [
  { id: 12, identifier: 'integritys-websites', name: "Integrity's Websites", href: '/api/v3/projects/12',
    keywords: ['kyv', 'knowyourvendor', 'minerva', 'empverif', 'eduverif', 'employment', 'education', 'wordpress', 'laragon', 'daily-sprint', 'portal', 'integrity website'] },
  { id: 20, identifier: 'know-your-vendor-kyv', name: 'Know Your Vendor (KYV)', href: '/api/v3/projects/20',
    keywords: ['kyv', 'know your vendor', 'vendor'] },
  { id: 11, identifier: 'knowme', name: 'Knowme', href: '/api/v3/projects/11',
    keywords: ['knowme', 'know me'] },
  { id: 25, identifier: 'omnibot-omni-channel-with-chatbot', name: 'OmniBot', href: '/api/v3/projects/25',
    keywords: ['omnibot', 'chatbot', 'omni', 'crisp', 'chat'] },
  { id: 9,  identifier: 'phoenix', name: 'Phoenix', href: '/api/v3/projects/9',
    keywords: ['phoenix', 'wbs', 'customer portal'] },
  { id: 40, identifier: 'services-websites', name: 'Services Websites', href: '/api/v3/projects/40',
    keywords: ['services', 'integrity asia', 'integrity indonesia', 'integrity malaysia', 'integrity thailand', 'headless'] },
  { id: 10, identifier: 'minerva', name: 'Minerva', href: '/api/v3/projects/10',
    keywords: ['minerva', 'minerva-global'] },
]

export const DEFAULT_SETTINGS: UserSettings = {
  userId: 8,
  userName: 'Rian Iskandar',
  userHref: '/api/v3/users/8',
  defaultAccountableId: null,
  defaultProjectIdentifier: 'integritys-websites',
  watchedProjects: ['integritys-websites', 'know-your-vendor-kyv'],
  defaultVersionId: null,
  opApiToken: '',
  setupDone: false,
}

const STORAGE_KEY = 'isl_user_settings'

export function loadSettings(): UserSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(s: UserSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

export function detectProject(title: string, bullets: string[] = []): OPProject {
  const text = [title, ...bullets].join(' ').toLowerCase()
  for (const proj of OP_PROJECTS) {
    if (proj.keywords.some((k) => text.includes(k))) return proj
  }
  return OP_PROJECTS.find((p) => p.identifier === 'integritys-websites')!
}

export function detectType(title: string): 'task' | 'bug' | 'feature' {
  const t = title.toLowerCase()
  if (/bug|fix|error|crash|broken|gagal|rusak|fail/.test(t)) return 'bug'
  if (/feature|fitur|build|tambah|implement|buat|create/.test(t)) return 'feature'
  return 'task'
}

export function typeId(type: 'task' | 'bug' | 'feature'): number {
  return { task: 1, bug: 7, feature: 4 }[type]
}
