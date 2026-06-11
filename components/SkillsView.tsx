'use client'

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import type { Session } from '@/lib/parser'
import { useI18n } from '@/lib/i18n'

const CATEGORIES: Record<string, string[]> = {
  Docker:         ['docker', 'container', 'compose'],
  Nginx:          ['nginx', 'reverse proxy', 'vhost'],
  WordPress:      ['wordpress', 'wp-cli', 'multisite', 'plugin', 'wpcli'],
  PHP:            ['php', 'lessc', 'piklist'],
  'SSL/Security': ['ssl', 'certbot', 'certificate', 'forensic', 'malware', 'security', 'cvss'],
  Deployment:     ['deploy', 'deployment', 'production', 'staging'],
  'App Dev':      ['sprint', 'app', 'build', 'next.js', 'react', 'typescript', 'tailwind', 'phoenix'],
  Database:       ['sql', 'database', 'db', 'mysql', 'mariadb'],
  Debugging:      ['fix', 'debug', 'troubleshoot'],
  Infrastructure: ['vm', 'vps', 'server', 'backup', 'infra'],
}

const CAT_COLORS: Record<string, string> = {
  Docker: '#0ea5e9', Nginx: '#8b5cf6', WordPress: '#3b82f6',
  PHP: '#7c3aed', 'SSL/Security': '#ef4444', Deployment: '#10b981',
  'App Dev': '#f59e0b', Database: '#06b6d4', Debugging: '#f97316',
  Infrastructure: '#6366f1', General: '#94a3b8',
}

function categorize(title: string, bullets: string): string {
  const text = (title + ' ' + bullets).toLowerCase()
  for (const [cat, kws] of Object.entries(CATEGORIES)) {
    if (kws.some((kw) => text.includes(kw))) return cat
  }
  return 'General'
}

interface Props {
  allTopics: Array<Session & { date: string }>
}

export default function SkillsView({ allTopics }: Props) {
  const { t } = useI18n()
  const [activeFilter, setActiveFilter] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const catMap: Record<string, Array<Session & { date: string }>> = {}
  for (const topic of allTopics) {
    const cat = categorize(topic.title, topic.bullets.join(' '))
    if (!catMap[cat]) catMap[cat] = []
    catMap[cat].push(topic)
  }
  const sorted = Object.entries(catMap).sort((a, b) => b[1].length - a[1].length)
  const maxCount = Math.max(...sorted.map(([, v]) => v.length), 1)

  const filtered = allTopics.filter(topic => {
    const cat = categorize(topic.title, topic.bullets.join(' '))
    const matchCat = !activeFilter || cat === activeFilter
    const matchSearch = !search || topic.title.toLowerCase().includes(search.toLowerCase()) ||
      topic.bullets.some(b => b.toLowerCase().includes(search.toLowerCase()))
    return matchCat && matchSearch
  })

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">{t('skills.title')}</h2>
        <p className="text-xs text-gray-400">{allTopics.length} {t('skills.activities')} · {sorted.length} {t('skills.areas')}</p>
      </div>

      {/* Skill breakdown */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">{t('skills.breakdown')}</p>
        <div className="space-y-2">
          {sorted.map(([cat, items]) => {
            const color = CAT_COLORS[cat] ?? '#94a3b8'
            const isActive = activeFilter === cat
            return (
              <button
                key={cat}
                onClick={() => setActiveFilter(isActive ? null : cat)}
                className={`w-full flex items-center gap-3 rounded-lg px-2 py-1.5 transition ${isActive ? 'bg-gray-100 dark:bg-gray-800' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'}`}
              >
                <div className="w-28 text-xs font-medium text-gray-600 dark:text-gray-400 flex-shrink-0 text-left">{cat}</div>
                <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                  <div className="h-2 rounded-full transition-all" style={{ width: `${(items.length / maxCount) * 100}%`, background: color }} />
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400 w-8 text-right">{items.length}</span>
                {isActive && <span className="text-[10px] text-indigo-500">✕</span>}
              </button>
            )
          })}
        </div>
        {activeFilter && (
          <button onClick={() => setActiveFilter(null)} className="mt-3 text-xs text-indigo-500 hover:text-indigo-600 transition">
            {t('skills.clear_filter')}
          </button>
        )}
      </div>

      {/* Search + list */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide flex-1">
            {activeFilter ? `${activeFilter} · ` : ''}{filtered.length} {t('skills.count_label')}
          </p>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('skills.search')}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-indigo-400 w-40"
          />
        </div>
        <div className="divide-y divide-gray-50 dark:divide-gray-800 max-h-[480px] overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="text-xs text-gray-400 italic text-center py-8">{t('skills.no_results')}</p>
          ) : filtered.map((topic, i) => {
            const cat = categorize(topic.title, topic.bullets.join(' '))
            const color = CAT_COLORS[cat] ?? '#94a3b8'
            return (
              <div key={i} className="px-5 py-3 flex items-start gap-3">
                <span className="text-[10px] text-gray-400 w-20 flex-shrink-0 mt-0.5 tabular-nums">
                  {format(parseISO(topic.date), 'dd MMM yy')}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">{topic.title}</p>
                  {topic.bullets[0] && (
                    <p className="text-[11px] text-gray-400 mt-0.5 truncate">{topic.bullets[0]}</p>
                  )}
                </div>
                <span className="flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: color + '20', color }}>
                  {cat}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
