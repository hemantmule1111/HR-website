import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Card, Field, Loading, Modal, PasswordInput, Stat, useToast } from '../ui/components'
import { fmtDate } from '../ui/format'

export const fmtBytes = (n) => (n > 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(0, Math.round((n || 0) / 1024))} KB`)
export const ago = (t) => {
  if (!t) return 'Never'
  const d = Math.floor((Date.now() - new Date(String(t).replace(' ', 'T') + (String(t).endsWith('Z') ? '' : 'Z')).getTime()) / 86400000)
  return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`
}

// Plans are only a starting point for the switches below them.
const PRESETS = {
  Basic: { payroll: false, overtime: false, tests: false, geo: false, hrdesk: true, letters: true, chat: true },
  Standard: { payroll: true, overtime: false, tests: false, geo: true, hrdesk: true, letters: true, chat: true },
  Full: { payroll: true, overtime: true, tests: true, geo: true, hrdesk: true, letters: true, chat: true },
}

export function PlanFields({ papi, f, setF }) {
  const { data: list = [] } = useQuery({ queryKey: ['platform', 'features'], queryFn: () => papi('/features') })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  return (
    <>
      <Field label="Plan" hint="A label you choose. The presets just fill in the switches."><div style={{ display: 'flex', gap: '.5rem' }}>
        <input className="input" maxLength={40} value={f.plan} onChange={set('plan')} placeholder="Basic, Standard, Full…" list="plan-names" />
        <datalist id="plan-names">{Object.keys(PRESETS).map((p) => <option key={p} value={p} />)}</datalist>
        <select className="select" style={{ width: 'auto' }} value="" onChange={(e) => e.target.value && setF({ ...f, plan: e.target.value, features: { ...PRESETS[e.target.value] } })} aria-label="Apply a preset"><option value="">Preset…</option>{Object.keys(PRESETS).map((p) => <option key={p} value={p}>{p}</option>)}</select>
      </div></Field>
      <Field label="Own web address" hint="For example hr.acme.com. Point it at this site first."><input className="input" value={f.domain} onChange={set('domain')} placeholder="hr.acme.com" /></Field>
      <div className="span-2" style={{ gridColumn: 'span 2' }}>
        <b style={{ fontSize: '.88rem' }}>Included features</b>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '.35rem .9rem', marginTop: '.4rem' }}>
          {list.map((x) => <label key={x.key} className="check"><input type="checkbox" checked={f.features[x.key] !== false} onChange={(e) => setF({ ...f, features: { ...f.features, [x.key]: e.target.checked } })} />{x.label}</label>)}
        </div>
        <small className="muted">A feature that is off disappears from the company's menu and is refused by the server, so it can be sold as an add-on.</small>
      </div>
    </>
  )
}

export function OverviewStats({ ov }) {
  const t = ov?.totals
  if (!t) return null
  return (
    <div className="grid g4" style={{ marginBottom: '1.25rem' }}>
      <Stat icon="building" label="Companies" value={t.companies} hint={`${t.active} active · ${t.suspended} suspended`} />
      <Stat icon="users" tone="green" label="Employees in total" value={t.employees} hint={fmtBytes(t.storage_bytes) + ' of files'} />
      <Stat icon="calendar" tone={t.expiring_30 || t.expired ? 'amber' : 'green'} label="Subscriptions" value={t.expiring_30} hint={`end within 30 days · ${t.expired} already ended`} />
      <Stat icon="clock" tone={t.quiet_30 ? 'amber' : 'green'} label="Quiet companies" value={t.quiet_30} hint="nobody signed in for 30 days" />
    </div>
  )
}

export function HealthModal({ papi, company, onClose }) {
  const { data: h, error } = useQuery({ queryKey: ['platform', 'health', company.id], queryFn: () => papi(`/companies/${company.id}/health`), gcTime: 0 })
  const Row = ({ k, v, bad }) => <div className="ps-row"><span>{k}</span><span style={bad ? { color: 'var(--red)' } : undefined}>{v}</span></div>
  return (
    <Modal title={`Health of ${company.name}`} onClose={onClose}>
      {error ? <p className="form-error">{error.message}</p> : !h ? <Loading /> : (
        <>
          {h.error && <p className="form-error">{h.error}</p>}
          <Row k="Database" v={h.schema.up_to_date ? `Up to date (${h.schema.applied})` : `Behind: ${h.schema.applied} of ${h.schema.expected}. Press "Update databases".`} bad={!h.schema.up_to_date} />
          {h.tables_missing && <Row k="Missing tables" v={h.tables_missing.length ? h.tables_missing.join(', ') : 'None'} bad={h.tables_missing.length > 0} />}
          <Row k="Status" v={h.status === 'active' ? 'Active' : 'Suspended'} bad={h.status !== 'active'} />
          <Row k="Plan" v={h.plan || '—'} />
          <Row k="Own web address" v={h.domain || '—'} />
          <Row k="Features on" v={Object.entries(h.features).filter(([, v]) => v).map(([k]) => k).join(', ') || 'None'} />
          <Row k="Last sign-in" v={ago(h.last_login_at)} />
          {h.employees !== undefined && <>
            <Row k="Employees / sign-in accounts" v={`${h.employees} / ${h.users}`} />
            <Row k="Signed in during the last 30 days" v={`${h.users_signed_in_30_days} of ${h.users}`} />
            <Row k="Admins with two-step sign-in" v={`${h.admins_with_two_step} of ${h.admins}`} bad={h.admins_with_two_step < h.admins} />
            <Row k="Locked accounts" v={h.locked_users} bad={h.locked_users > 0} />
            <Row k="Payroll runs" v={`${h.payroll_runs}${h.last_payroll_month ? ` (latest ${h.last_payroll_month})` : ''}`} />
            <Row k="Attendance punches this month" v={h.attendance_punches_this_month} />
          </>}
          <Row k="Files stored" v={fmtBytes(h.storage_bytes)} />
          <p className="muted" style={{ marginTop: '.7rem', fontSize: '.82rem' }}>Only counts and settings are shown here. You cannot see this company's people, pay or documents from this screen.</p>
        </>
      )}
      <div className="form-actions"><Button onClick={onClose}>Close</Button></div>
    </Modal>
  )
}

const ACTION = { sign_in: 'Signed in', company_create: 'Created a company', company_update: 'Changed a company', company_suspend: 'Suspended a company', company_activate: 'Activated a company', admin_reset: 'Reset a company admin', company_export: 'Exported a company', company_delete: 'Deleted a company', upgrade: 'Updated databases' }

export function LogModal({ papi, onClose }) {
  const { data = [], isLoading } = useQuery({ queryKey: ['platform', 'log'], queryFn: () => papi('/log'), gcTime: 0 })
  return (
    <Modal title="Platform activity log" onClose={onClose}>
      {isLoading ? <Loading /> : !data.length ? <p className="muted">Nothing yet.</p> : (
        <div className="table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}><table className="table">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Company</th></tr></thead>
          <tbody>{data.map((l) => <tr key={l.id}><td className="nowrap">{fmtDate(l.created_at)} {String(l.created_at).slice(11, 16)}</td><td>{l.admin_email || '—'}<small className="muted" style={{ display: 'block' }}>{l.ip}</small></td><td>{ACTION[l.action] || l.action}{l.detail && <small className="muted" style={{ display: 'block' }}>{l.detail}</small>}</td><td>{l.company_code || '—'}</td></tr>)}</tbody>
        </table></div>
      )}
      <div className="form-actions"><Button onClick={onClose}>Close</Button></div>
    </Modal>
  )
}

export function DeleteModal({ papi, pdownload, company, onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [exported, setExported] = useState(false)
  const del = useMutation({
    mutationFn: () => papi(`/companies/${company.id}`, { method: 'DELETE', body: { confirm_code: code, password } }),
    onSuccess: () => { toast('Company deleted'); qc.invalidateQueries({ queryKey: ['platform'] }); onClose() },
  })
  const exportNow = async () => { try { await pdownload(`/companies/${company.id}/export?files=1`, `workpilot-${company.code}-with-files.zip`); setExported(true) } catch (e) { toast(e.message, 'error') } }
  return (
    <Modal title={`Delete ${company.name}?`} onClose={onClose}>
      <p><b>This removes the company, all its people, payroll, documents and files, and cannot be undone.</b> The company must be suspended first, and you must have downloaded an export in the last 24 hours so the data can be restored if this was a mistake.</p>
      <div style={{ margin: '.8rem 0' }}><Button variant="light" icon="download" onClick={exportNow}>1. Download the export with files</Button>{exported && <Badge tone="green"> Downloaded</Badge>}</div>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); del.mutate() }}>
        <Field label={`2. Type the company code (${company.code}) to confirm`} span={2}><input className="input" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" /></Field>
        <Field label="3. Your platform password" span={2}><PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
        {del.error && <p className="form-error span-2" style={{ gridColumn: 'span 2' }}>{del.error.message}</p>}
        <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button><Button variant="danger" busy={del.isPending} disabled={code.trim().toLowerCase() !== company.code || !password}>Delete everything</Button></div>
      </form>
    </Modal>
  )
}
