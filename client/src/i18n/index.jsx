// Hindi and Marathi screens. The English text itself is the key: t('Check in'). A phrase with no translation shows in English,
// so the app never has a blank label, and translating more screens is just wrapping text in t() and adding a line to hi.js / mr.js.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import hi from './hi'
import mr from './mr'

export const LANGUAGES = [['en', 'English'], ['hi', 'हिन्दी'], ['mr', 'मराठी']]
const DICT = { hi, mr }
const KEY = 'wp-lang'
const read = () => { try { const v = localStorage.getItem(KEY); return LANGUAGES.some(([c]) => c === v) ? v : 'en' } catch { return 'en' } }

const Ctx = createContext({ lang: 'en', setLang: () => {}, t: (s) => s })

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(read)
  const setLang = useCallback((l) => { setLangState(l); try { localStorage.setItem(KEY, l) } catch { /* private mode */ } }, [])
  useEffect(() => { document.documentElement.lang = lang }, [lang])
  const t = useCallback((s, vars) => {
    let out = (lang !== 'en' && DICT[lang]?.[s]) || s
    if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, v)
    return out
  }, [lang])
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useI18n = () => useContext(Ctx)

// A small language chooser for the login page and the user menu.
export function LanguagePicker({ className = 'select', style }) {
  const { lang, setLang, t } = useI18n()
  return (
    <select className={className} style={style} value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t('Language')}>
      {LANGUAGES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
    </select>
  )
}
