import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import BrandLogo from '../ui/BrandLogo'
import Icon from '../ui/Icon'
import { Badge, Button, Card, Empty, Field, Loading, Modal, PasswordInput, Stat, useToast } from '../ui/components'
import { fmtDate } from '../ui/format'
import { ForcedTwoFactor } from '../ui/TwoFactor'
import { PlanFields, OverviewStats, HealthModal, LogModal, DeleteModal, fmtBytes, ago } from './PlatformExtra'

// The platform owner's area: create companies, set their limits, suspend them. It has its own sign-in, separate from every company.
const KEY = 'wp-platform-token'
const store = {
  get: () => { try { return sessionStorage.getItem(KEY) } catch { return null } },
  set: (v) => { try { v ? sessionStorage.setItem(KEY, v) : sessionStorage.removeItem(KEY) } catch { /* private mode */ } },
}

async function papi(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${import.meta.env.BASE_URL}api/v1/platform${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(store.get() ? { Authorization: `Bearer ${store.get()}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) return null
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') store.set(null)
    const detail = data.details?.[0] ? ` (${data.details[0].path?.join('.') || ''}: ${data.details[0].message})` : ''
    throw Object.assign(new Error(`${data.error || `Request failed (${res.status})`}${detail}`), { status: res.status })
  }
  return data
}

// Authenticated file download for the platform owner.
async function pdownload(path, filename) {
  const res = await fetch(`${import.meta.env.BASE_URL}api/v1/platform${path}`, { headers: { Authorization: `Bearer ${store.get()}` } })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Download failed')
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
}
const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

const signInUrl = (code) => `${window.location.origin}${import.meta.env.BASE_URL}login?c=${encodeURIComponent(code)}`

function PlatformLogin({ onDone }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [challenge, setChallenge] = useState(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('')
    try {
      if (challenge) { store.set((await papi('/auth/verify', { method: 'POST', body: { challenge, code } })).token); onDone(false); return }
      const r = await papi('/auth/login', { method: 'POST', body: { email, password } })
      if (r.twoFactor) { setChallenge(r.challenge); return }
      store.set(r.token); onDone(!!r.setupRequired)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return (
    <div className="ct-shell">
      <header className="ct-head"><BrandLogo /><span className="muted">Platform owner</span></header>
      <main className="ct-card">
        <form className="login-form" onSubmit={submit} style={{ width: '100%' }}>
          <div><h2>Platform sign in</h2><p className="muted" style={{ marginTop: '.3rem' }}>For the owner of this WorkPilot service. Company users sign in on the normal sign-in page.</p></div>
          {challenge ? (
            <label className="field"><span>6-digit code from your authenticator app (or a recovery code)</span><input className="input" required autoFocus autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" /></label>
          ) : (<>
            <label className="field"><span>Email</span><input className="input" type="email" required autoFocus autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label className="field"><span>Password</span><PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" /></label>
          </>)}
          {error && <p className="form-error" role="alert">{error}</p>}
          <Button busy={busy} icon="login">{challenge ? 'Verify and sign in' : 'Sign in'}</Button>
        </form>
      </main>
    </div>
  )
}

function CompanyForm({ company, onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [f, setF] = useState(company
    ? { name: company.name, code: company.code, max_employees: company.max_employees, valid_until: company.valid_until || '', notes: company.notes || '', plan: company.plan || '', domain: company.domain || '', features: { ...company.features } }
    : { name: '', code: '', admin_email: '', admin_password: '', max_employees: 0, valid_until: '', notes: '', plan: '', domain: '', features: {} })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const m = useMutation({
    mutationFn: () => {
      const common = { name: f.name, max_employees: Number(f.max_employees || 0), valid_until: f.valid_until || null, notes: f.notes || null, plan: f.plan || null, domain: f.domain || null, features: f.features }
      return company
        ? papi(`/companies/${company.id}`, { method: 'PATCH', body: { ...common, code: f.code } })
        : papi('/companies', { method: 'POST', body: { ...common, code: f.code, admin_email: f.admin_email, admin_password: f.admin_password } })
    },
    onSuccess: () => { toast(company ? 'Company updated' : 'Company created'); qc.invalidateQueries({ queryKey: ['platform'] }); onClose(company ? null : { code: f.code, email: f.admin_email, password: f.admin_password }) },
  })
  return (
    <Modal title={company ? `Edit ${company.name}` : 'New company'} onClose={() => onClose(null)}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
        <Field label="Company name" span={2}><input className="input" required minLength={2} value={f.name} onChange={set('name')} placeholder="e.g. Acme Traders Pvt Ltd" /></Field>
        <Field label="Company code" hint="Typed at sign-in. Letters, numbers and hyphens." span={2}><input className="input" required minLength={3} value={f.code} onChange={set('code')} placeholder="e.g. acme" autoCapitalize="none" spellCheck="false" /></Field>
        {!company && <>
          <Field label="Company admin email" hint="The first login of this company"><input className="input" type="email" required value={f.admin_email} onChange={set('admin_email')} /></Field>
          <Field label="Admin password" hint="At least 10 characters"><input className="input" type="text" required minLength={10} value={f.admin_password} onChange={set('admin_password')} autoComplete="off" /></Field>
        </>}
        <Field label="Employee limit" hint="0 means no limit"><input className="input" type="number" min="0" value={f.max_employees} onChange={set('max_employees')} /></Field>
        <Field label="Subscription valid until" hint="Leave empty for no end date"><input className="input" type="date" value={f.valid_until} onChange={set('valid_until')} /></Field>
        <PlanFields papi={papi} f={f} setF={setF} />
        <Field label="Notes (only you see this)" span={2}><textarea className="input" value={f.notes} onChange={set('notes')} placeholder="Plan, invoice number, contact person…" /></Field>
        {m.error && <p className="form-error span-2">{m.error.message}</p>}
        <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button variant="ghost" type="button" onClick={() => onClose(null)}>Cancel</Button><Button busy={m.isPending}>{company ? 'Save' : 'Create company'}</Button></div>
      </form>
    </Modal>
  )
}

function ResetAdmin({ company, onClose }) {
  const toast = useToast()
  const [email, setEmail] = useState(company.admin_email || '')
  const [password, setPassword] = useState('')
  const m = useMutation({ mutationFn: () => papi(`/companies/${company.id}/reset-admin`, { method: 'POST', body: { email: email || undefined, password } }), onSuccess: (r) => { toast(`Admin password changed for ${r.email}`); onClose() } })
  return (
    <Modal title={`Reset admin login: ${company.name}`} onClose={onClose}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
        <Field label="Admin email" span={2}><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="New password" hint="At least 10 characters" span={2}><input className="input" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" /></Field>
        {m.error && <p className="form-error span-2">{m.error.message}</p>}
        <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button><Button busy={m.isPending}>Set password</Button></div>
      </form>
    </Modal>
  )
}

function Created({ info, onClose }) {
  const toast = useToast()
  const copy = (t) => navigator.clipboard?.writeText(t).then(() => toast('Copied'), () => toast('Select the text and copy it', 'error'))
  return (
    <Modal title="Company is ready" onClose={onClose}>
      <p className="muted" style={{ marginBottom: '1rem' }}>Send these to the company's owner. They sign in, then create their own HR, Payroll, Manager and Employee logins under <b>Users &amp; access</b>.</p>
      <div className="access-box">
        <div><small>Sign-in page</small><b>{signInUrl(info.code)}</b><Button variant="ghost" className="sm" onClick={() => copy(signInUrl(info.code))}>Copy</Button></div>
        <div><small>Company code</small><b>{info.code}</b><Button variant="ghost" className="sm" onClick={() => copy(info.code)}>Copy</Button></div>
        <div><small>Admin email</small><b>{info.email}</b><Button variant="ghost" className="sm" onClick={() => copy(info.email)}>Copy</Button></div>
        <div><small>Password</small><b>{info.password}</b><Button variant="ghost" className="sm" onClick={() => copy(info.password)}>Copy</Button></div>
      </div>
      <div className="form-actions"><Button onClick={onClose}>Done</Button></div>
    </Modal>
  )
}

function Backups({ onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const { data = [], isLoading, error } = useQuery({ queryKey: ['platform', 'backups'], queryFn: () => papi('/backups'), retry: false })
  const now = useMutation({ mutationFn: (files) => papi(`/backups${files ? '?files=1' : ''}`, { method: 'POST' }), onSuccess: () => { toast('Backup saved'); qc.invalidateQueries({ queryKey: ['platform', 'backups'] }) }, onError: (e) => toast(e.message, 'error') })
  const dl = async (name) => { try { await pdownload(`/backups/${name}`, name) } catch (e) { toast(e.message, 'error') } }
  return (
    <Modal wide title="Backups" onClose={onClose}>
      <p className="muted" style={{ marginBottom: '.8rem' }}>The whole database (every company) is backed up about once a day, automatically; the newest 14 are kept, and the uploaded files are saved every Sunday (newest 4 kept). <b>Download backups regularly and keep them away from this server.</b> To restore: phpMyAdmin, choose an empty database, Import, pick the .sql.gz file.</p>
      <div style={{ display: 'flex', gap: '.6rem', marginBottom: '.8rem', flexWrap: 'wrap' }}>
        <Button icon="download" busy={now.isPending} onClick={() => now.mutate(false)}>Back up now</Button>
        <Button variant="light" busy={now.isPending} onClick={() => now.mutate(true)}>Back up now, with files</Button>
      </div>
      {error ? <p className="form-error">{error.message}</p> : isLoading ? <Loading /> : !data.length ? <Empty icon="file" title="No backups yet" hint="Press Back up now." /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>File</th><th>Made (UTC)</th><th className="num">Size</th><th /></tr></thead>
          <tbody>{data.map((b) => <tr key={b.name}><td><code>{b.name}</code></td><td className="nowrap">{b.created_at}</td><td className="num">{fmtSize(b.size)}</td><td><Button variant="light" className="sm" icon="download" onClick={() => dl(b.name)}>Download</Button></td></tr>)}</tbody>
        </table></div>
      )}
      <div className="form-actions"><Button variant="ghost" onClick={onClose}>Close</Button></div>
    </Modal>
  )
}

function TestEmail({ onClose }) {
  const [to, setTo] = useState('')
  const [res, setRes] = useState(null)
  const m = useMutation({ mutationFn: () => papi('/test-email', { method: 'POST', body: { to } }), onSuccess: setRes })
  return (
    <Modal title="Send a test email" onClose={onClose}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); setRes(null); m.mutate() }}>
        <Field label="Send to" span={2} hint="Use this after setting up email in app/config.php (PHP) or .env (Node)."><input className="input" type="email" required value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@yourdomain.com" /></Field>
        {m.error && <p className="form-error span-2">{m.error.message}</p>}
        {res && (res.sent
          ? <p className="span-2" style={{ gridColumn: 'span 2', color: 'var(--green)' }}>Sent using "{res.transport}". Check the inbox (and spam) of {to}.</p>
          : <p className="form-error span-2" style={{ gridColumn: 'span 2' }}>Could not send: {res.error}</p>)}
        <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button variant="ghost" type="button" onClick={onClose}>Close</Button><Button busy={m.isPending}>Send test email</Button></div>
      </form>
    </Modal>
  )
}

function Home({ onSignOut }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [edit, setEdit] = useState(null) // 'new' | company
  const [reset, setReset] = useState(null)
  const [created, setCreated] = useState(null)
  const [testing, setTesting] = useState(false)
  const [backups, setBackups] = useState(false)
  const [health, setHealth] = useState(null)
  const [logOpen, setLogOpen] = useState(false)
  const [removing, setRemoving] = useState(null)
  const { data: ov } = useQuery({ queryKey: ['platform', 'overview'], queryFn: () => papi('/overview'), retry: false })
  const storage = new Map((ov?.companies || []).map((c) => [c.id, c.storage_bytes]))
  const { data = [], isLoading, error } = useQuery({ queryKey: ['platform', 'companies'], queryFn: () => papi('/companies'), retry: false })
  if (error?.status === 401) onSignOut()
  const toggle = useMutation({ mutationFn: (c) => papi(`/companies/${c.id}`, { method: 'PATCH', body: { status: c.status === 'active' ? 'suspended' : 'active' } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['platform'] }), onError: (e) => toast(e.message, 'error') })
  const upgrade = useMutation({
    mutationFn: () => papi('/upgrade', { method: 'POST' }),
    onSuccess: (r) => { const bad = r.filter((x) => x.error); toast(bad.length ? `${bad.length} company(ies) failed to update: ${bad[0].error}` : `All databases are up to date (${r.reduce((n, x) => n + (x.applied || 0), 0)} change(s) applied)`, bad.length ? 'error' : undefined); qc.invalidateQueries({ queryKey: ['platform'] }) },
    onError: (e) => toast(e.message, 'error'),
  })
  const active = data.filter((c) => c.status === 'active').length
  const people = data.reduce((n, c) => n + (c.employees || 0), 0)
  return (
    <div className="ct-shell">
      <header className="ct-head" style={{ width: 'min(1100px, 100%)' }}><BrandLogo /><span><span className="muted">Platform owner</span> · <button className="link-btn" onClick={onSignOut}>Sign out</button></span></header>
      <main style={{ width: 'min(1100px, 100%)' }}>
        <div className="page-head"><div><h1>Companies</h1><p className="muted">Every company has its own private data. Nobody can see another company's people, payroll or documents.</p></div>
          <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}><Button variant="light" onClick={() => setLogOpen(true)}>Activity log</Button><Button variant="light" onClick={() => setBackups(true)}>Backups</Button><Button variant="light" onClick={() => setTesting(true)}>Test email</Button><Button variant="light" busy={upgrade.isPending} onClick={() => upgrade.mutate()}>Update databases</Button><Button icon="plus" onClick={() => setEdit('new')}>New company</Button></div>
        </div>
        {ov ? <OverviewStats ov={ov} /> : (
          <div className="grid g4" style={{ marginBottom: '1.25rem' }}>
            <Stat icon="building" label="Companies" value={data.length} hint={`${active} active`} />
            <Stat icon="users" tone="green" label="Employees in total" value={people} />
          </div>
        )}
        <Card pad={false}>
          {isLoading ? <Loading /> : !data.length ? <Empty icon="building" title="No companies yet" hint="Create the first company." /> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Company</th><th>Code</th><th>Plan</th><th className="num">Employees</th><th>Last sign-in</th><th>Valid until</th><th>Status</th><th /></tr></thead>
              <tbody>{data.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.name}</b>{c.notes && <small className="muted" style={{ display: 'block' }}>{c.notes}</small>}</td>
                  <td><code>{c.code}</code></td>
                  <td>{c.plan || '—'}{c.domain && <small className="muted" style={{ display: 'block' }}>{c.domain}</small>}<small className="muted" style={{ display: 'block' }}>{Object.entries(c.features).filter(([, v]) => !v).length ? `${Object.entries(c.features).filter(([, v]) => !v).length} feature(s) off` : 'All features'}</small></td>
                  <td className="num">{c.employees ?? '—'}{c.max_employees > 0 && <small className="muted"> / {c.max_employees}</small>}{c.error && <small className="form-error" style={{ display: 'block' }}>{c.error}</small>}</td>
                  <td className="nowrap">{ago(c.last_login_at)}{storage.has(c.id) && <small className="muted" style={{ display: 'block' }}>{fmtBytes(storage.get(c.id))}</small>}</td>
                  <td className="nowrap">{c.valid_until ? fmtDate(c.valid_until) : 'No end date'}</td>
                  <td><Badge tone={c.status === 'active' ? 'green' : 'red'}>{c.status === 'active' ? 'Active' : 'Suspended'}</Badge></td>
                  <td><div className="row-actions">
                    <Button variant="light" className="sm" icon="edit" onClick={() => setEdit(c)}>Edit</Button>
                    <Button variant="ghost" className="sm" icon="key" onClick={() => setReset(c)}>Admin password</Button>
                    <Button variant="ghost" className="sm" icon="download" onClick={() => pdownload(`/companies/${c.id}/export?files=1`, `workpilot-${c.code}.zip`).catch((e) => toast(e.message, 'error'))}>Export</Button>
                    <Button variant="ghost" className="sm" icon="shield" onClick={() => setHealth(c)}>Health</Button>
                    <Button variant="ghost" className="sm" onClick={() => toggle.mutate(c)}>{c.status === 'active' ? 'Suspend' : 'Activate'}</Button>
                    {c.status !== 'active' && c.code !== 'default' && <Button variant="ghost" className="sm" icon="trash" onClick={() => setRemoving(c)}>Delete</Button>}
                  </div></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
        <p className="muted" style={{ marginTop: '1rem' }}><Icon name="shield" size={14} /> A suspended or expired company cannot sign in. Its data is kept and comes back when you activate it again. After installing a new version of WorkPilot, press <b>Update databases</b> once.</p>
      </main>
      {edit && <CompanyForm company={edit === 'new' ? null : edit} onClose={(info) => { setEdit(null); if (info) setCreated(info) }} />}
      {reset && <ResetAdmin company={reset} onClose={() => { setReset(null); qc.invalidateQueries({ queryKey: ['platform'] }) }} />}
      {created && <Created info={created} onClose={() => setCreated(null)} />}
      {testing && <TestEmail onClose={() => setTesting(false)} />}
      {backups && <Backups onClose={() => setBackups(false)} />}
      {health && <HealthModal papi={papi} company={health} onClose={() => setHealth(null)} />}
      {logOpen && <LogModal papi={papi} onClose={() => setLogOpen(false)} />}
      {removing && <DeleteModal papi={papi} pdownload={pdownload} company={removing} onClose={() => setRemoving(null)} />}
    </div>
  )
}

export default function Platform() {
  const [signedIn, setSignedIn] = useState(!!store.get())
  const [setup, setSetup] = useState(false) // two-step sign-in must be set up first
  const out = () => { store.set(null); setSignedIn(false); setSetup(false) }
  useEffect(() => { // a session that was kept from before: is two-step set up?
    if (signedIn) papi('/2fa').then((s) => { if (!s.enabled) setSetup(true) }).catch(() => {})
  }, [signedIn])
  if (signedIn && setup) return <ForcedTwoFactor call={papi} base="/2fa" onDone={() => setSetup(false)} onSignOut={out} />
  return signedIn ? <Home onSignOut={out} /> : <PlatformLogin onDone={(needSetup) => { setSetup(needSetup); setSignedIn(true) }} />
}
