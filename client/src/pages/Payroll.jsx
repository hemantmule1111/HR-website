import { useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, download } from '../api'
import Icon from '../ui/Icon'
import { Avatar, Badge, Button, Card, Confirm, Empty, Field, Loading, Modal, PageHeader, Stat, Tabs, useToast } from '../ui/components'
import { useAuth } from '../auth'
import { currentMonth, fmtDate, money, monthLabel, shiftMonth } from '../ui/format'

import { PayslipView, useCompany } from '../ui/Payslip'
import { useBlob } from '../ui/photo'
import { PayrollTools, PayrollControls, PtSlabs, StatutoryFiles } from './PayrollTools'
import { getPosition } from '../ui/geo'
import { AttendanceRules, PunchDevices } from './AttendanceRules'
export { PayslipView }

function RunDetail({ run, onBack }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [view, setView] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const { user } = useAuth()
  const { data: settings } = useQuery({ queryKey: ['payroll-settings'], queryFn: () => api('/payroll/settings') })
  const { data, isLoading } = useQuery({ queryKey: ['run', run.id], queryFn: () => api(`/payroll/runs/${run.id}/payslips`) })
  const done = () => { qc.invalidateQueries({ queryKey: ['run', run.id] }); qc.invalidateQueries({ queryKey: ['runs'] }) }
  const act = useMutation({
    mutationFn: ({ path, method, body }) => api(path, { method, body }),
    onSuccess: (_d, v) => { toast(v.done); v.method === 'DELETE' ? (qc.invalidateQueries({ queryKey: ['runs'] }), onBack()) : done() },
    onError: (e) => toast(e.message, 'error'),
  })
  if (isLoading) return <Loading />
  const status = data.run.status
  const total = data.payslips.reduce((s, p) => s + Number(p.net), 0)
  const base = `/payroll/runs/${run.id}`
  const mine = user?.id
  const blockApprove = settings?.dual_control && status === 'draft' && data.run.created_by === mine
  const blockPay = settings?.dual_control && status === 'approved' && data.run.approved_by === mine
  return (
    <>
      <PageHeader title={`Payroll · ${monthLabel(run.month)}`} subtitle={`${data.payslips.length} employees`}>
        <Button variant="ghost" icon="left" onClick={onBack}>All runs</Button>
        <Button variant="ghost" icon="download" onClick={() => download(`${base}/payslips?format=csv`, `payroll-${run.month}.csv`)}>Export CSV</Button>
        {status === 'draft' && <>
          <Button variant="ghost" onClick={() => act.mutate({ path: `${base}/recompute`, method: 'POST', done: 'Recomputed from latest attendance' })}>Recompute</Button>
          <Button variant="ghost" icon="trash" onClick={() => setConfirm('delete')}>Delete</Button>
          <Button icon="check" disabled={blockApprove} title={blockApprove ? 'A second person must approve this payroll' : ''} onClick={() => act.mutate({ path: base, method: 'PATCH', body: { action: 'approve' }, done: 'Payroll approved' })}>Approve</Button>
        </>}
        {status === 'approved' && <Button variant="success" icon="wallet" disabled={blockPay} title={blockPay ? 'A different person must mark this as paid' : ''} onClick={() => act.mutate({ path: base, method: 'PATCH', body: { action: 'pay' }, done: 'Marked as paid — employees notified' })}>Mark as paid</Button>}
      </PageHeader>
      {(blockApprove || blockPay) && <p className="muted" style={{ marginBottom: '1rem' }}><Icon name="shield" size={14} /> Second-approver control is on. {blockApprove ? 'You created this payroll, so another payroll approver must approve it.' : 'You approved this payroll, so another person must mark it as paid.'}</p>}
      {status !== 'draft' && <StatutoryFiles run={run} />}
      <div className="grid g3" style={{ marginBottom: '1.25rem' }}>
        <Stat icon="wallet" label="Net payout" value={money(total)} />
        <Stat icon="users" tone="cyan" label="Employees" value={data.payslips.length} />
        <Stat icon="checkcircle" tone={status === 'paid' ? 'green' : 'amber'} label="Status" value={status[0].toUpperCase() + status.slice(1)} />
      </div>
      <Card pad={false}>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Employee</th><th className="num">Paid days</th><th className="num">LOP</th><th className="num">Gross</th><th className="num">Deductions</th><th className="num">Net pay</th><th /></tr></thead>
          <tbody>{data.payslips.map((p) => (
            <tr key={p.id} className="click" onClick={() => setView(p.id)}>
              <td><div className="who"><Avatar name={p.name} size={34} /><div><b>{p.name}</b><small>{p.emp_code}</small></div></div></td>
              <td className="num">{Number(p.paid_days)}/{p.total_days}</td><td className="num">{Number(p.lop_days) > 0 ? <Badge tone="amber">{Number(p.lop_days)}</Badge> : '—'}</td>
              <td className="num">{money(p.gross)}</td><td className="num">{money(p.deductions)}</td><td className="num"><b>{money(p.net)}</b></td>
              <td><Icon name="right" size={16} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      </Card>
      {view && <Modal wide title="Payslip" onClose={() => setView(null)}><PayslipView id={view} /></Modal>}
      {confirm === 'delete' && <Confirm danger title="Delete this draft run?" message="All draft payslips for this month will be removed. You can run payroll again afterwards." confirmLabel="Delete" onConfirm={() => act.mutate({ path: base, method: 'DELETE', done: 'Draft deleted' })} onClose={() => setConfirm(null)} />}
    </>
  )
}

const RULE_LABEL = {
  pf_employee_rate: ['Employee PF', '%'], pf_employer_rate: ['Employer PF', '%'], eps_rate: ['EPS share of employer PF', '%'], pf_wage_ceiling: ['PF wage ceiling', '₹'],
  edli_rate: ['EDLI', '%'], epf_admin_rate: ['PF admin charge', '%'], esic_employee_rate: ['Employee ESIC', '%'], esic_employer_rate: ['Employer ESIC', '%'],
  esic_wage_ceiling: ['ESIC wage ceiling', '₹'], wage_exclusion_limit: ['Allowances limit in wages (50% rule)', '%'], gratuity_days: ['Gratuity days per year', ''], gratuity_divisor: ['Gratuity month divisor', ''],
}
const ruleVal = (k, v) => (RULE_LABEL[k]?.[1] === '₹' ? money(v) : `${Number(v)}${RULE_LABEL[k]?.[1] || ''}`)

// PF / ESIC / gratuity rates with the date each one starts, so a change never alters an old month.
function StatutoryRates() {
  const { can } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const today = new Date().toISOString().slice(0, 10)
  const [adding, setAdding] = useState(false)
  const [f, setF] = useState({ rule_key: 'pf_wage_ceiling', value: '', effective_from: today, note: '' })
  const { data = [], isLoading } = useQuery({ queryKey: ['rules'], queryFn: () => api('/payroll/rules') })
  const save = useMutation({
    mutationFn: () => api('/payroll/rules', { method: 'POST', body: f }),
    onSuccess: () => { toast('Rate saved'); setAdding(false); qc.invalidateQueries({ queryKey: ['rules'] }) },
  })
  const keys = Object.keys(RULE_LABEL)
  const inForce = keys.map((k) => data.find((r) => r.rule_key === k && String(r.effective_from).slice(0, 10) <= today)).filter(Boolean)
  const upcoming = data.filter((r) => String(r.effective_from).slice(0, 10) > today)
  return (
    <Card title="Statutory rates" action={can('payroll.manage') && <Button variant="ghost" className="sm" icon="plus" onClick={() => setAdding(true)}>Change a rate</Button>} pad={false}>
      {isLoading ? <Loading /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Rate</th><th className="num">Value</th><th>In force from</th><th>Note</th></tr></thead>
          <tbody>
            {inForce.map((r) => <tr key={r.id}><td><b>{RULE_LABEL[r.rule_key][0]}</b></td><td className="num">{ruleVal(r.rule_key, r.value)}</td><td className="nowrap">{fmtDate(String(r.effective_from).slice(0, 10))}</td><td className="muted">{r.note}</td></tr>)}
            {upcoming.map((r) => <tr key={'u' + r.id}><td><b>{RULE_LABEL[r.rule_key]?.[0] || r.rule_key}</b> <Badge tone="blue">Upcoming</Badge></td><td className="num">{ruleVal(r.rule_key, r.value)}</td><td className="nowrap">{fmtDate(String(r.effective_from).slice(0, 10))}</td><td className="muted">{r.note}</td></tr>)}
          </tbody>
        </table></div>
      )}
      {adding && (
        <Modal title="Change a statutory rate" onClose={() => setAdding(false)}>
          <form className="form-grid" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
            <Field label="Rate" span={2}><select className="select" value={f.rule_key} onChange={(e) => setF({ ...f, rule_key: e.target.value })}>{keys.map((k) => <option key={k} value={k}>{RULE_LABEL[k][0]}</option>)}</select></Field>
            <Field label={`New value${RULE_LABEL[f.rule_key][1] ? ` (${RULE_LABEL[f.rule_key][1]})` : ''}`}><input className="input" type="number" min="0" step="0.01" required value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></Field>
            <Field label="Applies from" hint="Months starting on or after this date use the new value"><input className="input" type="date" required value={f.effective_from} onChange={(e) => setF({ ...f, effective_from: e.target.value })} /></Field>
            <Field label="Note / notification" span={2}><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
            {save.error && <p className="form-error span-2">{save.error.message}</p>}
            <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button variant="ghost" type="button" onClick={() => setAdding(false)}>Cancel</Button><Button busy={save.isPending}>Save rate</Button></div>
          </form>
        </Modal>
      )}
    </Card>
  )
}

// The company's own list of salary categories: switch standard ones on or off, add new earnings and deductions, remove the ones it no longer uses.
// The website logo: sidebar, sign-in page, browser tab and payslips all use this one image.
function WebsiteLogo({ isAdmin }) {
  const toast = useToast()
  const qc = useQueryClient()
  const input = useRef(null)
  const { data: co } = useCompany()
  const { url: logo } = useBlob(co?.has_logo ? '/company/logo' : null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['company'] })
  const upload = useMutation({
    mutationFn: (file) => { const fd = new FormData(); fd.append('file', file); return api('/company/logo', { method: 'POST', body: fd }) },
    onSuccess: () => { toast('Logo updated'); refresh() },
    onError: (e) => toast(e.message, 'error'),
  })
  const remove = useMutation({ mutationFn: () => api('/company/logo', { method: 'DELETE' }), onSuccess: () => { toast('Logo removed. The built-in logo is shown again.'); refresh() }, onError: (e) => toast(e.message, 'error') })
  const pick = (ev) => {
    const file = ev.target.files[0]; ev.target.value = ''
    if (!file) return
    if (!['image/png', 'image/jpeg'].includes(file.type)) return toast('Logo must be a PNG or JPG image', 'error')
    if (file.size > 2 * 1024 * 1024) return toast('Logo must be 2 MB or smaller', 'error')
    upload.mutate(file)
  }
  return (
    <Card title="Website logo" action={<small className="muted">Used in the sidebar, sign-in page, browser tab and payslips</small>}>
      <div className="company-logo" style={{ margin: 0, padding: 0, border: 0 }}>
        <div className="company-logo-box">{logo ? <img src={logo} alt="Website logo" /> : <img src={`${import.meta.env.BASE_URL}logo.png`} alt="Built-in logo" />}</div>
        <div>
          {isAdmin ? (
            <>
              <input ref={input} type="file" accept=".png,.jpg,.jpeg" hidden onChange={pick} />
              <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap' }}>
                <Button variant="light" icon="upload" busy={upload.isPending} onClick={() => input.current.click()}>{co?.has_logo ? 'Change logo' : 'Upload logo'}</Button>
                {co?.has_logo && <Button variant="ghost" icon="trash" onClick={() => remove.mutate()}>Remove</Button>}
              </div>
              <p className="muted" style={{ fontSize: '.78rem', marginTop: '.4rem' }}>PNG or JPG, up to 2 MB. A wide logo on a white or transparent background works best. {co?.has_logo ? '' : 'Until you upload one, the built-in WorkPilot logo is used.'}</p>
            </>
          ) : <p className="muted">Only the admin can change the logo.</p>}
        </div>
      </div>
    </Card>
  )
}

// Attendance location: where the office is. When the check is on, check-in and check-out only work from inside one of these places.
function LocationForm({ loc, onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [f, setF] = useState(loc ? { name: loc.name, latitude: loc.latitude, longitude: loc.longitude, radius_m: loc.radius_m, active: loc.active } : { name: '', latitude: '', longitude: '', radius_m: 100, active: true })
  const [finding, setFinding] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const here = async () => {
    setFinding(true)
    try { const p = await getPosition(); setF((c) => ({ ...c, latitude: Number(p.latitude.toFixed(7)), longitude: Number(p.longitude.toFixed(7)) })); toast(`Location found (accurate to about ${Math.round(p.accuracy)} m). Stand at the office when you do this.`) } catch (e) { toast(e.message, 'error') } finally { setFinding(false) }
  }
  const m = useMutation({
    mutationFn: () => api(loc ? `/geo/locations/${loc.id}` : '/geo/locations', { method: loc ? 'PATCH' : 'POST', body: { ...f, latitude: Number(f.latitude), longitude: Number(f.longitude), radius_m: Number(f.radius_m) } }),
    onSuccess: () => { toast(loc ? 'Location updated' : 'Location added'); qc.invalidateQueries({ queryKey: ['geo'] }); onClose() },
  })
  return (
    <Modal title={loc ? 'Edit office location' : 'Add an office location'} onClose={onClose}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
        <Field label="Name" span={2}><input className="input" required minLength={2} value={f.name} onChange={set('name')} placeholder="e.g. Head office, Pune" /></Field>
        <div className="span-2" style={{ gridColumn: 'span 2' }}><Button variant="light" type="button" icon="pin" busy={finding} onClick={here}>Use my current location</Button><small className="muted" style={{ display: 'block', marginTop: '.35rem' }}>Open this page on a phone or laptop while standing at the office. Or paste the latitude and longitude from Google Maps (right-click a place, click the numbers).</small></div>
        <Field label="Latitude"><input className="input" type="number" step="any" min="-90" max="90" required value={f.latitude} onChange={set('latitude')} placeholder="18.5204" /></Field>
        <Field label="Longitude"><input className="input" type="number" step="any" min="-180" max="180" required value={f.longitude} onChange={set('longitude')} placeholder="73.8567" /></Field>
        <Field label="Allowed distance (metres)" hint="People can check in within this distance. 100 m suits one building."><input className="input" type="number" min="20" max="5000" required value={f.radius_m} onChange={set('radius_m')} /></Field>
        <Field label="Status"><select className="select" value={f.active ? '1' : '0'} onChange={(e) => setF({ ...f, active: e.target.value === '1' })}><option value="1">Active</option><option value="0">Not in use</option></select></Field>
        {m.error && <p className="form-error span-2">{m.error.message}</p>}
        <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button><Button busy={m.isPending}>{loc ? 'Save' : 'Add location'}</Button></div>
      </form>
    </Modal>
  )
}

// "Download my company data": everything this company has stored, as a ZIP of spreadsheets (CSV files).
function DataExport() {
  const toast = useToast()
  const [busy, setBusy] = useState('')
  const go = async (files) => {
    setBusy(files ? 'files' : 'data')
    try { await download(files ? '/export?files=1' : '/export', `workpilot-data${files ? '-with-files' : ''}.zip`); toast('Your download has started') } catch (e) { toast(e.message, 'error') } finally { setBusy('') }
  }
  return (
    <Card title="Your company data" action={<small className="muted">Admin only</small>}>
      <p className="muted" style={{ marginBottom: '.9rem' }}>Download everything your company has stored in WorkPilot: employees, attendance, leave, payroll, overtime, tests and more. One spreadsheet (CSV) file per list, inside a ZIP. Passwords and security codes are never included. Keep the file safe: it contains personal data.</p>
      <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap' }}>
        <Button variant="light" icon="download" busy={busy === 'data'} onClick={() => go(false)}>Download data (CSV)</Button>
        <Button variant="light" icon="download" busy={busy === 'files'} onClick={() => go(true)}>Download data and files</Button>
      </div>
      <small className="muted" style={{ display: 'block', marginTop: '.6rem' }}>"Data and files" also includes uploaded documents, photos, the logo and chat files, so it can take longer and be larger.</small>
    </Card>
  )
}

function GeoSettings() {
  const toast = useToast()
  const qc = useQueryClient()
  const { data: g } = useQuery({ queryKey: ['geo'], queryFn: () => api('/geo') })
  const [edit, setEdit] = useState(null) // 'new' | location
  const [del, setDel] = useState(null)
  const [f, setF] = useState(null)
  const cur = f || g
  const refresh = () => { qc.invalidateQueries({ queryKey: ['geo'] }); qc.invalidateQueries({ queryKey: ['geo-public'] }) }
  const save = useMutation({ mutationFn: () => api('/geo/settings', { method: 'PUT', body: { enabled: !!cur.enabled, max_accuracy_m: Number(cur.max_accuracy_m) } }), onSuccess: () => { toast('Location settings saved'); setF(null); refresh() }, onError: (e) => toast(e.message, 'error') })
  const rm = useMutation({ mutationFn: (id) => api(`/geo/locations/${id}`, { method: 'DELETE' }), onSuccess: () => { toast('Location removed'); refresh() }, onError: (e) => toast(e.message, 'error') })
  if (!g) return <Card title="Attendance location"><Loading /></Card>
  return (
    <Card title="Attendance location (geo-fence)" action={<Button icon="plus" variant="light" className="sm" onClick={() => setEdit('new')}>Add location</Button>}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
        <Field label="Location check" span={2}>
          <select className="select" value={cur.enabled ? '1' : '0'} onChange={(e) => setF({ ...cur, enabled: e.target.value === '1' })}>
            <option value="0">Off: anyone can check in from anywhere</option>
            <option value="1">On: check in and check out only work at an office location below</option>
          </select>
        </Field>
        <Field label="Least precise location accepted (metres)" hint="A phone location vaguer than this is refused. 100 to 150 works for most phones."><input className="input" type="number" min="20" max="1000" value={cur.max_accuracy_m} onChange={(e) => setF({ ...cur, max_accuracy_m: e.target.value })} /></Field>
        <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button variant="ghost" type="button" disabled={!f} onClick={() => setF(null)}>Reset</Button><Button busy={save.isPending} disabled={!f}>Save</Button></div>
      </form>
      {!g.locations.length ? <p className="muted" style={{ marginTop: '1rem' }}>No office location yet. Add one, then switch the check on.</p> : (
        <div className="table-wrap" style={{ marginTop: '1rem' }}><table className="table">
          <thead><tr><th>Place</th><th>Position</th><th className="num">Distance</th><th>Status</th><th /></tr></thead>
          <tbody>{g.locations.map((l) => (
            <tr key={l.id}>
              <td><b>{l.name}</b></td>
              <td><a href={`https://www.google.com/maps?q=${l.latitude},${l.longitude}`} target="_blank" rel="noreferrer">{l.latitude}, {l.longitude}</a></td>
              <td className="num">{l.radius_m} m</td>
              <td><Badge tone={l.active ? 'green' : 'gray'}>{l.active ? 'Active' : 'Not in use'}</Badge></td>
              <td><div className="row-actions"><Button variant="ghost" className="sm" onClick={() => setEdit(l)}>Edit</Button><Button variant="ghost" className="sm" icon="trash" onClick={() => setDel(l)}>Remove</Button></div></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <small className="muted" style={{ display: 'block', marginTop: '.75rem' }}>When the check is on, employees are asked to allow their location when they check in or out. Without a location, a vague one, or from outside the allowed distance, the punch is refused with a clear message. The place is saved with each punch. Location can only be read on https pages, and a person who really wants to fake it with special tools may still manage to, so use the check together with normal supervision.</small>
      {edit && <LocationForm loc={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {del && <Confirm danger title="Remove this location?" message={del.name} confirmLabel="Remove" onConfirm={() => rm.mutate(del.id)} onClose={() => setDel(null)} />}
    </Card>
  )
}

// Overtime policy: who can claim, how it is priced and the limits. Applies company-wide; only the admin edits it.
function OvertimeSettings({ isAdmin }) {
  const toast = useToast()
  const qc = useQueryClient()
  const { data: p } = useQuery({ queryKey: ['overtime', 'settings'], queryFn: () => api('/overtime/settings') })
  const [f, setF] = useState(null)
  const cur = f || p
  const save = useMutation({
    mutationFn: () => api('/overtime/settings', { method: 'PUT', body: { ...cur, enabled: !!cur.enabled } }),
    onSuccess: () => { toast('Overtime settings saved'); setF(null); qc.invalidateQueries({ queryKey: ['overtime'] }) },
    onError: (e) => toast(e.message, 'error'),
  })
  if (!p) return <Card title="Overtime"><Loading /></Card>
  const set = (k) => (e) => setF({ ...cur, [k]: e.target.value })
  const num = (k, label, hint, step = '0.5') => (
    <Field label={label} hint={hint}><input className="input" type="number" min="0" step={step} disabled={!isAdmin} value={cur[k]} onChange={set(k)} /></Field>
  )
  const per = (Number(cur.days_per_month) || 0) * (Number(cur.hours_per_day) || 0)
  return (
    <Card title="Overtime" action={<small className="muted">Applies to every employee marked eligible on their salary</small>}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
        <Field label="Overtime" span={2}>
          <select className="select" disabled={!isAdmin} value={cur.enabled ? '1' : '0'} onChange={(e) => setF({ ...cur, enabled: e.target.value === '1' })}>
            <option value="1">On: employees can claim overtime and approved hours are paid</option>
            <option value="0">Off: no new claims, and payroll adds no overtime pay</option>
          </select>
        </Field>
        <Field label="Hourly pay is worked out from" hint={`Full-month amount ÷ ${per || '…'} hours`}>
          <select className="select" disabled={!isAdmin} value={cur.basis} onChange={set('basis')}>
            <option value="basic">Basic salary</option>
            <option value="basic_da">Basic + DA (usual)</option>
            <option value="gross">Gross salary</option>
          </select>
        </Field>
        <span />
        {num('days_per_month', 'Working days in a month', 'Usually 26')}
        {num('hours_per_day', 'Working hours in a day', 'Usually 8')}
        {num('rate_weekday', 'Rate on a working day', 'Times the hourly pay. The Factories Act says 2×', '0.25')}
        {num('rate_weekoff', 'Rate on a weekly off', 'Times the hourly pay', '0.25')}
        {num('rate_holiday', 'Rate on a holiday', 'Times the hourly pay', '0.25')}
        <span />
        {num('min_minutes', 'Shortest claim (minutes)', 'Shorter claims are refused', '5')}
        {num('max_hours_day', 'Most hours in one day', undefined, '0.5')}
        {num('max_hours_month', 'Most hours in one month', 'Pending and approved hours together', '1')}
        {num('max_back_days', 'Claim within (days)', 'How long after the work a claim can be raised', '1')}
        {save.error && <p className="form-error span-2">{save.error.message}</p>}
        {isAdmin ? <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button variant="ghost" type="button" disabled={!f} onClick={() => setF(null)}>Reset</Button><Button busy={save.isPending} disabled={!f}>Save overtime settings</Button></div>
          : <p className="muted span-2">View only: the admin keeps these settings up to date.</p>}
      </form>
      <small className="muted" style={{ display: 'block', marginTop: '.75rem' }}>Overtime is paid as an extra line on the payslip. It is not treated as wages for PF, ESIC or gratuity. The rate is fixed when a manager approves a claim.</small>
    </Card>
  )
}

function SalaryMaster() {
  const { can, has } = useAuth()
  const isAdmin = ['user.manage', 'payroll.manage', 'org.manage'].every((k) => can(k)) // only the admin may change the master sheet
  const toast = useToast()
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [del, setDel] = useState(null)
  const [rename, setRename] = useState(null)
  const [f, setF] = useState({ name: '', kind: 'earning', in_wages: false })
  const { data = [], isLoading } = useQuery({ queryKey: ['salary-components'], queryFn: () => api('/payroll/components'), enabled: has('payroll') })
  const refresh = () => qc.invalidateQueries({ queryKey: ['salary-components'] })
  const patch = useMutation({
    mutationFn: ({ id, body }) => api(`/payroll/components/${id}`, { method: 'PATCH', body }),
    onSuccess: () => { refresh(); setRename(null) },
    onError: (e) => toast(e.message, 'error'),
  })
  const create = useMutation({
    mutationFn: () => api('/payroll/components', { method: 'POST', body: f }),
    onSuccess: () => { toast('Category added'); setAdding(false); setF({ name: '', kind: 'earning', in_wages: false }); refresh() },
  })
  const remove = useMutation({
    mutationFn: (id) => api(`/payroll/components/${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast('Category removed'); setDel(null); refresh() },
    onError: (e) => { toast(e.message, 'error'); setDel(null) },
  })
  const block = (title, kind, hint) => {
    const rows = data.filter((c) => c.kind === kind)
    return (
      <Card title={title} action={<small className="muted">{hint}</small>} pad={false}>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Category</th>{kind === 'earning' && <th>Counts as wages (PF / ESIC / gratuity)</th>}<th>Status</th>{isAdmin && <th />}</tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td><b>{c.name}</b> {c.is_standard ? <Badge tone="gray">Standard</Badge> : <Badge tone="blue">Added by company</Badge>}</td>
                {kind === 'earning' && <td>{c.is_standard || !isAdmin ? (c.in_wages ? 'Yes' : 'No — allowance (50% rule)') : (
                  <label className="check"><input type="checkbox" checked={c.in_wages} onChange={(e) => patch.mutate({ id: c.id, body: { in_wages: e.target.checked } })} /> {c.in_wages ? 'Yes' : 'No — allowance (50% rule)'}</label>
                )}</td>}
                <td><Badge tone={c.active ? 'green' : 'gray'}>{c.active ? 'In use' : 'Switched off'}</Badge></td>
                {isAdmin && <td><div className="row-actions">
                  <Button variant="ghost" className="sm" onClick={() => setRename({ id: c.id, name: c.name })}>Rename</Button>
                  {c.code !== 'basic' && <Button variant="ghost" className="sm" onClick={() => patch.mutate({ id: c.id, body: { active: !c.active } })}>{c.active ? 'Switch off' : 'Switch on'}</Button>}
                  {!c.is_standard && <Button variant="ghost" className="sm" icon="trash" onClick={() => setDel(c)}>Remove</Button>}
                </div></td>}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan="4" className="muted" style={{ textAlign: 'center', padding: '1.2rem' }}>Nothing here yet. Use "Add category".</td></tr>}
          </tbody>
        </table></div>
      </Card>
    )
  }
  return (
    <>
      <PageHeader title="Payroll" subtitle="Salary master: the categories that make up your salary structure">
        {isAdmin && <Button icon="plus" onClick={() => setAdding(true)}>Add category</Button>}
      </PageHeader>
      {has('payroll') && <PayrollTabs value="master" />}
      {!isAdmin && <p className="muted" style={{ marginBottom: '1rem' }}>View only: the admin keeps the salary master up to date.</p>}
      {isLoading && has('payroll') ? <Loading /> : (
        <div className="grid" style={{ gap: '1.25rem' }}>
          <WebsiteLogo isAdmin={isAdmin} />
          {has('payroll') && block('Earnings', 'earning', 'Added to gross salary and pro-rated for unpaid days')}
          {has('payroll') && block('Deductions', 'deduction', 'Fixed monthly amount taken from net pay')}
          {has('overtime') && <OvertimeSettings isAdmin={isAdmin} />}
          {isAdmin && has('geo') && <GeoSettings />}
          {isAdmin && <AttendanceRules />}
          {isAdmin && <PunchDevices />}
          {isAdmin && has('payroll') && <PayrollControls />}
          {isAdmin && has('payroll') && <PtSlabs />}
          {isAdmin && <DataExport />}
          <small className="muted">Provident fund, ESIC, professional tax and TDS follow the statutory rules and are set on each employee's salary structure. Switching a category off hides it and leaves it out of new payroll runs; old payslips keep what they showed.</small>
        </div>
      )}
      {adding && (
        <Modal title="Add a salary category" onClose={() => setAdding(false)}>
          <form className="form-grid" onSubmit={(e) => { e.preventDefault(); create.mutate() }}>
            <Field label="Name" span={2}><input className="input" required minLength={2} maxLength={80} autoFocus placeholder="e.g. Performance allowance, Canteen recovery" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Type" span={2}><select className="select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="earning">Earning (added to salary)</option><option value="deduction">Deduction (taken from salary)</option></select></Field>
            {f.kind === 'earning' && <label className="check span-2"><input type="checkbox" checked={f.in_wages} onChange={(e) => setF({ ...f, in_wages: e.target.checked })} /> Counts as wages for PF, ESIC and gratuity (tick only if the law treats it like Basic)</label>}
            {create.error && <p className="form-error span-2">{create.error.message}</p>}
            <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button variant="ghost" type="button" onClick={() => setAdding(false)}>Cancel</Button><Button busy={create.isPending}>Add category</Button></div>
          </form>
        </Modal>
      )}
      {rename && (
        <Modal title="Rename category" onClose={() => setRename(null)}>
          <form onSubmit={(e) => { e.preventDefault(); patch.mutate({ id: rename.id, body: { name: rename.name } }) }}>
            <Field label="Name"><input className="input" required minLength={2} maxLength={80} autoFocus value={rename.name} onChange={(e) => setRename({ ...rename, name: e.target.value })} /></Field>
            <div className="form-actions"><Button variant="ghost" type="button" onClick={() => setRename(null)}>Cancel</Button><Button busy={patch.isPending}>Save</Button></div>
          </form>
        </Modal>
      )}
      {del && <Confirm danger title={`Remove "${del.name}"?`} message="It is removed from the master sheet. If any salary structure still uses it you will be asked to switch it off instead." confirmLabel="Remove" onConfirm={() => remove.mutate(del.id)} onClose={() => setDel(null)} />}
    </>
  )
}

function PayrollTabs({ value }) {
  const nav = useNavigate()
  return <div style={{ marginBottom: '1rem' }}><Tabs tabs={[{ id: 'runs', label: 'Payroll runs' }, { id: 'tools', label: 'Adjustments & calculators' }, { id: 'master', label: 'Salary master' }]} value={value} onChange={(t) => nav(t === 'master' ? '/payroll?tab=master' : t === 'tools' ? '/payroll?tab=tools' : '/payroll')} /></div>
}

function ToolsPage() {
  return (
    <>
      <PageHeader title="Payroll" subtitle="Arrears, bonus, gratuity and leave encashment" />
      <PayrollTabs value="tools" />
      <PayrollTools />
    </>
  )
}

export default function Payroll() {
  const [params] = useSearchParams()
  const tab = params.get('tab')
  if (tab === 'tools') return <ToolsPage />
  return tab === 'master' ? <SalaryMaster /> : <PayrollRuns />
}

function PayrollRuns() {
  const toast = useToast()
  const qc = useQueryClient()
  const [open, setOpen] = useState(null)
  const [creating, setCreating] = useState(false)
  const [month, setMonth] = useState(shiftMonth(currentMonth(), -1))
  const { data = [], isLoading } = useQuery({ queryKey: ['runs'], queryFn: () => api('/payroll/runs') })
  const create = useMutation({
    mutationFn: () => api('/payroll/runs', { method: 'POST', body: { month } }),
    onSuccess: () => { toast('Payroll draft created'); setCreating(false); qc.invalidateQueries({ queryKey: ['runs'] }) },
  })
  if (open) return <RunDetail run={open} onBack={() => setOpen(null)} />
  return (
    <>
      <PageHeader title="Payroll" subtitle="Monthly runs, approvals and payslips">
        <Button icon="plus" onClick={() => setCreating(true)}>Run payroll</Button>
      </PageHeader>
      <PayrollTabs value="runs" />
      <Card pad={false}>
        {isLoading ? <Loading /> : !data.length ? <Empty icon="wallet" title="No payroll runs yet" hint="Add salary structures to employees, then run payroll for a month." /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Month</th><th className="num">Employees</th><th className="num">Net payout</th><th>Status</th><th /></tr></thead>
            <tbody>{data.map((r) => (
              <tr key={r.id} className="click" onClick={() => setOpen(r)}>
                <td><b>{monthLabel(r.month)}</b></td><td className="num">{r.employees}</td><td className="num">{money(r.net_total)}</td>
                <td><Badge status={r.status}>{r.status}</Badge></td><td><Icon name="right" size={16} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      <StatutoryRates />
      {creating && (
        <Modal title="Run payroll" onClose={() => setCreating(false)}>
          <form onSubmit={(e) => { e.preventDefault(); create.mutate() }}>
            <Field label="Month" hint="Salary is pro-rated using attendance, approved leave, holidays and weekly offs."><input className="input" type="month" required max={currentMonth()} value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
            {create.error && <p className="form-error" style={{ marginTop: '.8rem' }}>{create.error.message}</p>}
            <div className="form-actions"><Button variant="ghost" type="button" onClick={() => setCreating(false)}>Cancel</Button><Button busy={create.isPending}>Create draft</Button></div>
          </form>
        </Modal>
      )}
    </>
  )
}
