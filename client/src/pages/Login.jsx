import { useState, useEffect } from 'react'
import BrandLogo from '../ui/BrandLogo'
import { useI18n, LanguagePicker } from '../i18n'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { getCompany } from '../api'
import { useAuth } from '../auth'
import Icon from '../ui/Icon'
import { Button, PasswordInput } from '../ui/components'

const DEMO = [
  ['HR Admin', 'aarav.mehta@demo.com'],
  ['Manager', 'priya.nair@demo.com'],
  ['Employee', 'karan.singh@demo.com'],
  ['Payroll', 'neha.joshi@demo.com'],
]

export default function Login() {
  const { user, login, verifyCode } = useAuth()
  const [challenge, setChallenge] = useState(null)
  const [code, setCode] = useState('')
  const nav = useNavigate()
  const [params] = useSearchParams()
  const [company, setCompany] = useState(params.get('c') || getCompany() || (import.meta.env.DEV ? 'default' : ''))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { t } = useI18n()
  const [own, setOwn] = useState(null) // set when this web address belongs to one company
  useEffect(() => { fetch(`${import.meta.env.BASE_URL}api/v1/auth/host-company`).then((r) => r.json()).then((c) => { if (c?.code) { setOwn(c); setCompany(c.code) } }).catch(() => {}) }, [])

  if (user) return <Navigate to="/" replace />

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await login(email, password, company.trim())
      if (r.twoFactor) { setChallenge(r.challenge); return }
      nav('/', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function submitCode(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await verifyCode(challenge, code, company.trim())
      nav('/', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-shell">
      <section className="login-hero">
        <span className="orb a" /><span className="orb b" /><span className="orb c" />
        <div className="brand"><BrandLogo /></div>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <h1>{t('Everything your people need, in one place.')}</h1>
          <p>{t('Attendance, leave, payroll and approvals — beautifully simple for employees, powerful for HR.')}</p>
        </div>
        <div className="feature-list">
          <div><Icon name="clock" /> {t('One-tap check-in with smart attendance')}</div>
          <div><Icon name="checkcircle" /> {t('Instant leave approvals for managers')}</div>
          <div><Icon name="wallet" /> {t('Payslips and payroll, always on time')}</div>
        </div>
      </section>
      <section className="login-panel">
        {challenge ? (
          <form className="login-form" onSubmit={submitCode}>
            <div>
              <h2>Two-step sign-in</h2>
              <p className="muted" style={{ marginTop: '.3rem' }}>Open your authenticator app and type the 6-digit code for WorkPilot. Lost your phone? Type one of your recovery codes instead.</p>
            </div>
            <label className="field"><span>Code</span>
              <input className="input" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus autoComplete="one-time-code" inputMode="text" placeholder="123456" />
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <Button busy={busy} icon="shield" style={{ width: '100%', padding: '.8rem' }}>{busy ? t('Checking…') : t('Verify and sign in')}</Button>
            <button type="button" className="link-btn" onClick={() => { setChallenge(null); setCode(''); setError('') }}>{t('Back')}</button>
          </form>
        ) : (
        <form className="login-form" onSubmit={submit}>
          <div>
            <div style={{ float: 'right' }}><LanguagePicker style={{ padding: '.3rem .5rem', fontSize: '.85rem' }} /></div>
            <h2>{t('Welcome back 👋')}</h2>
            <p className="muted" style={{ marginTop: '.3rem' }}>{t('Sign in to your workspace.')}</p>
          </div>
          {own ? <p className="muted" style={{ margin: 0 }}>{t('Signing in to')} <b>{own.name}</b></p> : <label className="field"><span>{t('Company code')}</span>
            <input className="input" value={company} onChange={(e) => setCompany(e.target.value)} required autoComplete="organization" placeholder="e.g. acme" autoCapitalize="none" spellCheck="false" />
          </label>}
          <label className="field"><span>{t('Work email')}</span>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus autoComplete="username" placeholder="you@company.com" />
          </label>
          <label className="field"><span>{t('Password')}</span>
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" placeholder="••••••••••" />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div style={{ textAlign: 'right', marginTop: '-.4rem' }}><Link to="/forgot-password" style={{ fontSize: '.88rem' }}>{t('Forgot password?')}</Link></div>
          <Button busy={busy} icon="login" style={{ width: '100%', padding: '.8rem' }}>{busy ? t('Signing in…') : t('Sign in')}</Button>
          <small className="muted" style={{ textAlign: 'center', display: 'none' }}>Your company code was given to you by your HR team. <Link to="/platform">Platform owner?</Link></small>
          {import.meta.env.DEV && (
            <div className="demo-box" style={{ display: 'none' }}>
              <small>Demo accounts · password Demo@12345</small>
              <div className="chips">
                {DEMO.map(([label, em]) => (
                  <button type="button" className="chip" key={em} onClick={() => { setEmail(em); setPassword('Demo@12345') }}>{label}</button>
                ))}
              </div>
            </div>
          )}
        </form>
        )}
      </section>
    </div>
  )
}
