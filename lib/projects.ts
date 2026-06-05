export interface Project {
  id: string
  name: string
  desc: string
  color: string
  icon: string
  keywords: string[]
  status: 'active' | 'maintenance' | 'archived'
}

export const PROJECTS: Project[] = [
  {
    id: 'vm-infra',
    name: 'VM Infrastructure',
    desc: 'Server 103.216.188.150 — Docker, Nginx, SSL',
    color: '#6366f1',
    icon: '🖥️',
    keywords: ['vm', 'vps', 'server', 'nginx', 'ssl', 'certbot', 'docker', 'container', 'backup', 'infrastructure', 'infra'],
    status: 'active',
  },
  {
    id: 'kyv',
    name: 'KnowYourVendor',
    desc: 'knowyourvendor.net — WordPress Multisite Docker',
    color: '#0ea5e9',
    icon: '🏢',
    keywords: ['kyv', 'knowyourvendor', 'know your vendor', 'vendor', 'subdomain', 'multisite'],
    status: 'active',
  },
  {
    id: 'minerva',
    name: 'Minerva Global',
    desc: 'minerva-global.com — WordPress Docker',
    color: '#8b5cf6',
    icon: '🎓',
    keywords: ['minerva', 'minerva global', 'minerva-global'],
    status: 'active',
  },
  {
    id: 'empverif',
    name: 'EmpVerif',
    desc: 'employment-verification.com — WordPress Docker',
    color: '#10b981',
    icon: '✅',
    keywords: ['empverif', 'employment', 'employment verification', 'emp verif', 'empverification'],
    status: 'active',
  },
  {
    id: 'eduverif',
    name: 'EduVerif',
    desc: 'education-verification.com — WordPress Docker',
    color: '#f59e0b',
    icon: '📚',
    keywords: ['eduverif', 'education', 'education verification', 'edu verif', 'eduverification'],
    status: 'active',
  },
  {
    id: 'portal',
    name: 'Portal Integrity',
    desc: 'portal.integrity-asia.com — WordPress Docker',
    color: '#ef4444',
    icon: '🔐',
    keywords: ['portal', 'integrity', 'portal integrity', 'integrity asia'],
    status: 'maintenance',
  },
  {
    id: 'phoenix',
    name: 'Phoenix WBS',
    desc: 'Whistleblowing SaaS platform — Next.js',
    color: '#f97316',
    icon: '🐦',
    keywords: ['phoenix', 'wbs', 'whistleblowing', 'whistle'],
    status: 'active',
  },
  {
    id: 'daily-sprint',
    name: 'Daily Sprint App',
    desc: 'This app — local dev tool',
    color: '#14b8a6',
    icon: '🗂️',
    keywords: ['daily sprint', 'sprint app', 'kanban', 'daily-sprint'],
    status: 'active',
  },
  {
    id: 'general',
    name: 'General',
    desc: 'Setup, tooling, misc',
    color: '#94a3b8',
    icon: '⚙️',
    keywords: [],
    status: 'active',
  },
]

export function tagSessionToProject(title: string, bullets: string): string {
  const text = (title + ' ' + bullets).toLowerCase()
  for (const p of PROJECTS) {
    if (p.id === 'general') continue
    if (p.keywords.some((kw) => text.includes(kw))) return p.id
  }
  return 'general'
}

export function getProjectById(id: string): Project {
  return PROJECTS.find((p) => p.id === id) ?? PROJECTS[PROJECTS.length - 1]
}
