import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import BrandLogo from '../ui/BrandLogo'
import Icon from '../ui/Icon'
import { Button, PasswordInput } from '../ui/components'
import { getCompany } from '../api'

// Forgot password and reset password. Both are public pages: the person is not signed in.
async function post(path, body) {
  const res = await fetch(`${import.meta.env.BASE_URL}api/v1${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (res.status === 204) return {}
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = data.details?.[0]?.message ? ` (${data.details[0].message})` : ''
    throw new Error(`${data.error || `Something went wrong (${res.status})`}${data.error === 'Validation failed' ? detail : ''}`)
  }
  return data
}

function Shell({ children }) {
  return (
    <div className="ct-shell">
      <header className="ct-head"><BrandLogo /><Link to="/login" className="muted">Back to sign in</Link></header>
      <main className="ct-card">{children}</main>
    </div>
  )
}

export function ForgotPassword() {
  const [params] = useSearchParams()
  const [company, setCompany] = useState(params.get('c') || getCompany() || (import.meta.env.DEV ? 'default' : ''))
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('')
    try { setSent((await post('/auth/forgot-password', { company: company.trim(), email })).message) } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  if (sent) {
    return (
      <Shell>
        <div style={{ display: 'grid', gap: '.8rem', justifyItems: 'center', textAlign: 'center' }}>
          <span className="stat-icon green"><Icon name="mail" size={24} /></span>
          <h2>Check your email</h2>
          <p className="muted">{sent}</p>
          <p className="muted" style={{ fontSize: '.85rem' }}>Nothing arrived after a few minutes? Look in your spam folder, check the address, or ask your HR team to reset your password.</p>
          <Link className="btn light" to="/login">Back to sign in</Link>
        </div>
      </Shell>
    )
  }
  return (
    <Shell>
      <form className="login-form" onSubmit={submit} style={{ width: '100%' }}>
        <div><h2>Forgot your password?</h2><p className="muted" style={{ marginTop: '.3rem' }}>Enter your company code and work email. We will email you a link to choose a new password.</p></div>
        <label className="field"><span>Company code</span><input className="input" required value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. acme" autoCapitalize="none" spellCheck="false" /></label>
        <label className="field"><span>Work email</span><input className="input" type="email" required autoFocus autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button busy={busy} icon="mail">Send reset link</Button>
      </form>
    </Shell>
  )
}

export function ResetPassword() {
  const [params] = useSearchParams()
  const nav = useNavigate()
  const token = params.get('t') || ''
  const company = params.get('c') || getCompany()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault(); setError('')
    if (pw !== pw2) return setError('The two passwords do not match')
    setBusy(true)
    try { await post('/auth/reset-password', { token, password: pw, company: company || undefined }); setDone(true); setTimeout(() => nav('/login', { replace: true }), 2500) } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  if (!token) {
    return <Shell><div style={{ display: 'grid', gap: '.8rem' }}><h2>This link is not complete</h2><p className="muted">Open the link from your email again, or ask for a new one.</p><Link className="btn light" to="/forgot-password">Ask for a new link</Link></div></Shell>
  }
  if (done) {
    return <Shell><div style={{ display: 'grid', gap: '.8rem', justifyItems: 'center', textAlign: 'center' }}><span className="stat-icon green"><Icon name="checkcircle" size={24} /></span><h2>Password changed</h2><p className="muted">You can now sign in with your new password.</p><Link className="btn" to="/login">Sign in</Link></div></Shell>
  }
  return (
    <Shell>
      <form className="login-form" onSubmit={submit} style={{ width: '100%' }}>
        <div><h2>Choose a new password</h2><p className="muted" style={{ marginTop: '.3rem' }}>At least 10 characters. Avoid common words and your own name.</p></div>
        <label className="field"><span>New password</span><PasswordInput value={pw} onChange={(e) => setPw(e.target.value)} required minLength={10} autoComplete="new-password" /></label>
        <label className="field"><span>Repeat the new password</span><PasswordInput value={pw2} onChange={(e) => setPw2(e.target.value)} required minLength={10} autoComplete="new-password" /></label>
        {error && <p className="form-error" role="alert">{error} {/expired|valid|used/.test(error) && <Link to="/forgot-password">Ask for a new link</Link>}</p>}
        <Button busy={busy} icon="key">Change password</Button>
      </form>
    </Shell>
  )
}
