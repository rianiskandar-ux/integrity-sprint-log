'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'
import { translations, type Lang, type TranslationKey } from './translations'

interface I18nContextValue {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: TranslationKey, vars?: Record<string, string>) => string
}

const I18nContext = createContext<I18nContextValue>({
  lang: 'en',
  setLang: () => {},
  t: (key) => translations[key]?.en ?? key,
})

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang] = useState<Lang>('en')

  // Language is fixed to English — no toggle
  function setLang(_l: Lang) { /* no-op — English only */ }

  function t(key: TranslationKey, vars?: Record<string, string>): string {
    const entry = translations[key]
    if (!entry) return key
    let str: string = entry[lang] ?? entry['id'] ?? key
    if (vars) Object.entries(vars).forEach(([k, v]) => { str = str.replace(`{${k}}`, v) })
    return str
  }

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>
}

export function useI18n() {
  return useContext(I18nContext)
}

export const LANG_OPTIONS: { value: Lang; label: string; flag: string }[] = [
  { value: 'id', label: 'Indonesia', flag: '🇮🇩' },
  { value: 'en', label: 'English',   flag: '🇬🇧' },
]
