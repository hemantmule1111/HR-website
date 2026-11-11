import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { api, login as apiLogin, logout as apiLogout, refreshSession, verifyTwoFactor } from './api'

const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadMe = useCallback(async () => setUser(await api('/auth/me')), [])

  useEffect(() => {
    ;(async () => {
      try {
        if (await refreshSession()) await loadMe()
      } finally {
        setLoading(false)
      }
    })()
  }, [loadMe])

  const value = {
    user,
    loading,
    can: (...perms) => perms.some((p) => user?.permissions.includes(p)),
    // Parts of the product the company's plan includes (everything is on when nothing was switched off).
    has: (feature) => user?.features?.[feature] !== false,
    refresh: loadMe,
    // Returns { twoFactor, challenge } when a code is needed next; otherwise the person is signed in.
    async login(email, password, company) {
      const r = await apiLogin(email, password, company)
      if (r.twoFactor) return r
      await loadMe()
      return {}
    },
    async verifyCode(challenge, code, company) {
      await verifyTwoFactor(challenge, code, company)
      await loadMe()
    },
    async logout() {
      await apiLogout()
      setUser(null)
    },
  }
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}
