import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, download } from '../api'
import Icon from '../ui/Icon'
import { Badge, Button, Card, Confirm, Empty, Field, Loading, Modal, useToast } from '../ui/components'
import { currentMonth, money, monthLabel } from '../ui/format'

const SOURCE = { manual: 'One-off', arrears: 'Arrears', bonus: 'Bonus', gratuity: 'Gratuity', leave_encashment: 'Leave encashment', loan: 'Loan / advance', other: 'Other' }
const useEmployees = () => useQuery({ queryKey: ['emp-pick'], queryFn: () => api('/employees?limit=100') })
const EmpSelect = ({ value, onChange, required = true }) => {
  const { data } = useEmployees()
  return <select className="select" required={required} value={value} onChange={onChange}><option value="">Choose an employee…</option>{(data?.items || []).filter((x) => x.status !== 'exited').map((x) => <option key={x.id} value={x.id}>{x.name} ({x.emp_code})</option>)}</select>
}

// ---------------- one-off adjustments ----------------
function AddAdjustment({ preset, onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [f, setF] = useState({ employee_id: '', month: currentMonth(), kind: 'earning', label: '', amount: '', source: 'manual', note: '', ...preset })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const m = useMutation({ mutationFn: () => api('/payroll/adjustments', { method: 'POST', body: { ...f, employee_id: Number(f.employee_id), amount: Number(f.amount), note: f.note || null } }), onSuccess: () => { toast('Added to payroll'); qc.invalidateQueries({ queryKey: ['adjustments'] }); onClose() } })
  return (
    <Modal title="Add to a payroll month" onClose={onClose}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
        <Field label="Employee" span={2}><EmpSelect value={f.employee_id} onChange={set('employee_id')} /></Field>
        <Field label="Paid in month"><input className="input" type="month" required value={f.month} onChange={set('month')} /></Field>
        <Field label="Type"><select className="select" value={f.kind} onChange={set('kind')}><option value="earning">Earning (added to salary)</option><option value="deduction">Deduction (taken from salary)</option></select></Field>
        <Field label="Shown on the payslip as" span={2}><input className="input" required minLength={2} value={f.label} onChange={set('label')} placeholder="e.g. Arrears for April to June" /></Field>
        <Field label="Amount (₹)"><input className="input" type="number" min="0.01" step="0.01" required value={f.amount} onChange={set('amount')} /></Field>
        <Field label="Kind"><select className="select" value={f.source} onChange={set('source')}>{Object.entries(SOURCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Note (only HR sees it)" span={2}><input className="input" value={f.note} onChange={set('note')} /></Field>
        <p className="muted span-2" style={{ gridColumn: 'span 2', fontSize: '.82rem' }}>An earning is paid in full (it is not reduced for unpaid days) and is not counted as wages for PF or ESIC. It becomes part of the payslip when you run or recompute that month's payroll.</p>
        {m.error && <p className="form-error span-2" style={{ gridColumn: 'span 2' }}>{m.error.message}</p>}
        <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button><Button busy={m.isPending}>Add</Button></div>
      </form>
    </Modal>
  )
}

function Adjustments() {
  const toast = useToast()
  const qc = useQueryClient()
  const [month, setMonth] = useState(currentMonth())
  const [adding, setAdding] = useState(false)
  const { data = [], isLoading } = useQuery({ queryKey: ['adjustments', month], queryFn: () => api(`/payroll/adjustments?month=${month}`) })
  const rm = useMutation({ mutationFn: (id) => api(`/payroll/adjustments/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['adjustments'] }), onError: (e) => toast(e.message, 'error') })
  return (
    <Card title="One-off payroll items" action={<div style={{ display: 'flex', gap: '.6rem', alignItems: 'center' }}><input className="input" type="month" style={{ width: 'auto' }} value={month} onChange={(e) => setMonth(e.target.value)} /><Button icon="plus" className="sm" onClick={() => setAdding(true)}>Add</Button></div>}>
      <p className="muted" style={{ marginBottom: '.8rem' }}>Arrears after a salary revision, bonus, leave encashment, gratuity, a loan recovery... Anything here for {monthLabel(month)} is added to (or taken from) that month's payslips when payroll is run or recomputed.</p>
      {isLoading ? <Loading /> : !data.length ? <Empty icon="wallet" title="Nothing for this month" /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Employee</th><th>Item</th><th>Kind</th><th className="num">Amount</th><th /></tr></thead>
          <tbody>{data.map((a) => <tr key={a.id}><td><b>{a.name}</b> <small className="muted">{a.emp_code}</small></td><td>{a.label}</td><td><Badge tone={a.kind === 'earning' ? 'green' : 'red'}>{a.kind === 'earning' ? 'Earning' : 'Deduction'}</Badge> <small className="muted">{SOURCE[a.source]}</small></td><td className="num">{money(a.amount)}</td><td>{a.locked ? <small className="muted">Payroll approved</small> : <Button variant="ghost" className="sm" icon="trash" onClick={() => rm.mutate(a.id)}>Remove</Button>}</td></tr>)}</tbody>
        </table></div>
      )}
      {adding && <AddAdjustment preset={{ month }} onClose={() => setAdding(false)} />}
    </Card>
  )
}

// ---------------- calculators ----------------
function Result({ rows, note }) {
  return (
    <div className="calc-result">
      {rows.map(([k, v]) => <div className="ps-row" key={k}><span>{k}</span><span>{v}</span></div>)}
      {note && <small className="muted" style={{ display: 'block', marginTop: '.4rem' }}>{note}</small>}
    </div>
  )
}

function Gratuity() {
  const [f, setF] = useState({ employee_id: '', last_working_day: '', early_exit_reason: 'none' })
  const [add, setAdd] = useState(null)
  const m = useMutation({ mutationFn: () => api('/payroll/calc/gratuity', { method: 'POST', body: { ...f, employee_id: Number(f.employee_id), last_working_day: f.last_working_day || undefined } }) })
  const r = m.data
  return (
    <Card title="Gratuity">
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
        <Field label="Employee" span={2}><EmpSelect value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })} /></Field>
        <Field label="Last working day" hint="Leave empty to use the exit date"><input className="input" type="date" value={f.last_working_day} onChange={(e) => setF({ ...f, last_working_day: e.target.value })} /></Field>
        <Field label="Reason for leaving"><select className="select" value={f.early_exit_reason} onChange={(e) => setF({ ...f, early_exit_reason: e.target.value })}><option value="none">Resignation or retirement</option><option value="death">Death</option><option value="disability">Disability</option></select></Field>
        {m.error && <p className="form-error span-2" style={{ gridColumn: 'span 2' }}>{m.error.message}</p>}
        <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button busy={m.isPending}>Calculate</Button></div>
      </form>
      {r && <>
        <Result rows={[['Service', `${r.service.years} years ${r.service.months} months (counted as ${r.service.counted_years} years)`], ['Last drawn basic + DA', money(r.last_drawn_basic_da)], ['Gratuity', r.eligible ? money(r.amount) : 'Not payable']]} note={r.note} />
        {r.eligible && r.amount > 0 && <Button variant="light" className="sm" style={{ marginTop: '.6rem' }} onClick={() => setAdd({ employee_id: String(r.employee.id), kind: 'earning', label: 'Gratuity', amount: String(r.amount), source: 'gratuity' })}>Add to a payroll month</Button>}
      </>}
      {add && <AddAdjustment preset={add} onClose={() => setAdd(null)} />}
    </Card>
  )
}

function LeaveEncashment() {
  const [f, setF] = useState({ employee_id: '', days: '' })
  const [add, setAdd] = useState(null)
  const m = useMutation({ mutationFn: () => api('/payroll/calc/leave-encashment', { method: 'POST', body: { employee_id: Number(f.employee_id), days: Number(f.days) } }) })
  const r = m.data
  return (
    <Card title="Leave encashment">
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
        <Field label="Employee" span={2}><EmpSelect value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })} /></Field>
        <Field label="Days to encash"><input className="input" type="number" min="0.5" step="0.5" required value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /></Field>
        {m.error && <p className="form-error span-2" style={{ gridColumn: 'span 2' }}>{m.error.message}</p>}
        <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button busy={m.isPending}>Calculate</Button></div>
      </form>
      {r && <>
        <Result rows={[['Last drawn basic + DA', money(r.last_drawn_basic_da)], ['Per day (basic + DA ÷ 30)', money(r.per_day)], [`${r.days} day(s)`, money(r.amount)]]} />
        <Button variant="light" className="sm" style={{ marginTop: '.6rem' }} onClick={() => setAdd({ employee_id: String(r.employee.id), kind: 'earning', label: 'Leave encashment', amount: String(r.amount), source: 'leave_encashment' })}>Add to a payroll month</Button>
      </>}
      {add && <AddAdjustment preset={add} onClose={() => setAdd(null)} />}
    </Card>
  )
}

function Bonus() {
  const toast = useToast()
  const qc = useQueryClient()
  const now = new Date()
  const [f, setF] = useState({ fy_start_year: String(now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1), percent: '8.33', wage_ceiling: '7000', eligibility_limit: '21000' })
  const [month, setMonth] = useState(currentMonth())
  const m = useMutation({ mutationFn: () => api('/payroll/calc/bonus', { method: 'POST', body: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Number(v)])) }) })
  const addAll = useMutation({
    mutationFn: async () => { for (const r of m.data.rows.filter((x) => x.eligible && x.amount > 0)) await api('/payroll/adjustments', { method: 'POST', body: { employee_id: r.employee_id, month, kind: 'earning', label: `Bonus ${m.data.financial_year}`, amount: r.amount, source: 'bonus' } }) },
    onSuccess: () => { toast(`Bonus added to ${monthLabel(month)} payroll`); qc.invalidateQueries({ queryKey: ['adjustments'] }) }, onError: (e) => toast(e.message, 'error'),
  })
  const r = m.data
  return (
    <Card title="Statutory bonus (Payment of Bonus Act)">
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
        <Field label="Financial year starting April"><input className="input" type="number" min="2000" max="2100" required value={f.fy_start_year} onChange={(e) => setF({ ...f, fy_start_year: e.target.value })} /></Field>
        <Field label="Bonus %" hint="8.33 to 20"><input className="input" type="number" min="8.33" max="20" step="0.01" required value={f.percent} onChange={(e) => setF({ ...f, percent: e.target.value })} /></Field>
        <Field label="Wage ceiling for the calculation (₹)" hint="Usually 7,000, or the minimum wage if higher"><input className="input" type="number" min="1000" required value={f.wage_ceiling} onChange={(e) => setF({ ...f, wage_ceiling: e.target.value })} /></Field>
        <Field label="Only people earning up to (₹ a month)"><input className="input" type="number" min="1000" required value={f.eligibility_limit} onChange={(e) => setF({ ...f, eligibility_limit: e.target.value })} /></Field>
        {m.error && <p className="form-error span-2" style={{ gridColumn: 'span 2' }}>{m.error.message}</p>}
        <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button busy={m.isPending}>Calculate for everyone</Button></div>
      </form>
      {r && <>
        <div className="table-wrap" style={{ marginTop: '.8rem' }}><table className="table">
          <thead><tr><th>Employee</th><th className="num">Basic + DA</th><th className="num">Months</th><th className="num">Bonus</th></tr></thead>
          <tbody>{r.rows.map((x) => <tr key={x.employee_id} style={x.eligible ? undefined : { opacity: 0.55 }}><td><b>{x.name}</b> <small className="muted">{x.emp_code}</small></td><td className="num">{money(x.basic_da)}</td><td className="num">{x.months}</td><td className="num">{x.eligible ? money(x.amount) : 'Not eligible'}</td></tr>)}</tbody>
        </table></div>
        <p style={{ margin: '.6rem 0' }}>Total bonus for {r.financial_year}: <b>{money(r.total)}</b></p>
        <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap' }}><input className="input" type="month" style={{ width: 'auto' }} value={month} onChange={(e) => setMonth(e.target.value)} /><Button variant="light" disabled={!r.total} busy={addAll.isPending} onClick={() => addAll.mutate()}>Add all to this payroll month</Button></div>
      </>}
    </Card>
  )
}

export function PayrollTools() {
  return (
    <div className="grid" style={{ gap: '1.25rem' }}>
      <Adjustments />
      <div className="grid g2" style={{ alignItems: 'start' }}><Gratuity /><LeaveEncashment /></div>
      <Bonus />
    </div>
  )
}

// ---------------- Master sheet cards (admin) ----------------
export function PayrollControls() {
  const toast = useToast()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['payroll-settings'], queryFn: () => api('/payroll/settings') })
  const save = useMutation({ mutationFn: (dual_control) => api('/payroll/settings', { method: 'PUT', body: { dual_control } }), onSuccess: () => { toast('Saved'); qc.invalidateQueries({ queryKey: ['payroll-settings'] }) }, onError: (e) => toast(e.message, 'error') })
  if (!data) return null
  return (
    <Card title="Payroll approval control">
      <label className="check"><input type="checkbox" checked={data.dual_control} onChange={(e) => save.mutate(e.target.checked)} />Require a second person (recommended)</label>
      <p className="muted" style={{ marginTop: '.5rem' }}>When on, the person who creates a payroll run cannot approve it, and the person who approves it cannot also mark it as paid. This stops one person from running and paying salaries alone. You need at least two people with payroll rights.</p>
    </Card>
  )
}

function SlabForm({ slab, state, onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [f, setF] = useState(slab ? { ...slab, to_amount: slab.to_amount ?? '', feb_amount: slab.feb_amount ?? '' } : { state_code: state?.state_code || '', state_name: state?.state_name || '', gender: 'any', from_amount: 0, to_amount: '', monthly_amount: 0, feb_amount: '', effective_from: new Date().toISOString().slice(0, 10), active: true })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const m = useMutation({
    mutationFn: () => api(slab ? `/payroll/pt-slabs/${slab.id}` : '/payroll/pt-slabs', { method: slab ? 'PUT' : 'POST', body: { ...f, state_code: f.state_code.toUpperCase(), from_amount: Number(f.from_amount), to_amount: f.to_amount === '' ? null : Number(f.to_amount), monthly_amount: Number(f.monthly_amount), feb_amount: f.feb_amount === '' ? null : Number(f.feb_amount) } }),
    onSuccess: () => { toast('Slab saved'); qc.invalidateQueries({ queryKey: ['pt-slabs'] }); qc.invalidateQueries({ queryKey: ['pt-states'] }); onClose() },
  })
  return (
    <Modal title={slab ? 'Edit slab' : 'Add a slab'} onClose={onClose}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
        <Field label="State code" hint="Short code, e.g. KA"><input className="input" required value={f.state_code} onChange={set('state_code')} maxLength={10} /></Field>
        <Field label="State name"><input className="input" required value={f.state_name} onChange={set('state_name')} /></Field>
        <Field label="Applies to"><select className="select" value={f.gender} onChange={set('gender')}><option value="any">Everyone</option><option value="male">Men (and others)</option><option value="female">Women</option></select></Field>
        <Field label="Effective from"><input className="input" type="date" required value={f.effective_from} onChange={set('effective_from')} /></Field>
        <Field label="Monthly gross from (₹)"><input className="input" type="number" min="0" required value={f.from_amount} onChange={set('from_amount')} /></Field>
        <Field label="up to (₹)" hint="Empty = no upper limit"><input className="input" type="number" min="0" value={f.to_amount} onChange={set('to_amount')} /></Field>
        <Field label="Tax per month (₹)"><input className="input" type="number" min="0" max="5000" required value={f.monthly_amount} onChange={set('monthly_amount')} /></Field>
        <Field label="Tax in February (₹)" hint="Empty = same as other months"><input className="input" type="number" min="0" max="5000" value={f.feb_amount} onChange={set('feb_amount')} /></Field>
        {m.error && <p className="form-error span-2" style={{ gridColumn: 'span 2' }}>{m.error.message}</p>}
        <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button><Button busy={m.isPending}>Save</Button></div>
      </form>
    </Modal>
  )
}

export function PtSlabs() {
  const toast = useToast()
  const qc = useQueryClient()
  const [edit, setEdit] = useState(null) // 'new' | slab | { state }
  const [del, setDel] = useState(null)
  const { data = [], isLoading } = useQuery({ queryKey: ['pt-slabs'], queryFn: () => api('/payroll/pt-slabs') })
  const rm = useMutation({ mutationFn: (id) => api(`/payroll/pt-slabs/${id}`, { method: 'DELETE' }), onSuccess: () => { toast('Slab removed'); qc.invalidateQueries({ queryKey: ['pt-slabs'] }) }, onError: (e) => toast(e.message, 'error') })
  const states = [...new Map(data.map((s) => [s.state_code, s.state_name]))]
  return (
    <Card title="Professional tax by state" action={<Button icon="plus" variant="light" className="sm" onClick={() => setEdit('new')}>Add slab</Button>}>
      <p className="muted" style={{ marginBottom: '.8rem' }}>Each state sets its own monthly slabs. These are starting values, so <b>check them against your state's current notification</b> and edit anything that differs. Choose the state for each employee on their salary structure. A change takes effect from the "effective from" date, and the newest set of slabs for a state is the one used.</p>
      {isLoading ? <Loading /> : states.map(([code, name]) => (
        <details key={code} className="slab-state">
          <summary><b>{name}</b> <small className="muted">{code} · {data.filter((s) => s.state_code === code).length} slabs</small></summary>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>For</th><th className="num">Monthly gross</th><th className="num">Tax a month</th><th className="num">February</th><th>From</th><th /></tr></thead>
            <tbody>{data.filter((s) => s.state_code === code).map((s) => <tr key={s.id} style={s.active ? undefined : { opacity: 0.5 }}><td>{{ any: 'Everyone', male: 'Men', female: 'Women' }[s.gender]}</td><td className="num">{money(s.from_amount)} – {s.to_amount === null ? 'above' : money(s.to_amount)}</td><td className="num">{money(s.monthly_amount)}</td><td className="num">{s.feb_amount === null ? '—' : money(s.feb_amount)}</td><td className="nowrap">{s.effective_from}</td><td><div className="row-actions"><Button variant="ghost" className="sm" onClick={() => setEdit(s)}>Edit</Button><Button variant="ghost" className="sm" icon="trash" onClick={() => setDel(s)}>Remove</Button></div></td></tr>)}</tbody>
          </table></div>
          <Button variant="ghost" className="sm" icon="plus" onClick={() => setEdit({ state: { state_code: code, state_name: name } })}>Add a slab to {name}</Button>
        </details>
      ))}
      {edit && <SlabForm slab={edit === 'new' || edit.state ? null : edit} state={edit.state} onClose={() => setEdit(null)} />}
      {del && <Confirm danger title="Remove this slab?" message={`${del.state_name}: ${money(del.from_amount)} to ${del.to_amount === null ? 'above' : money(del.to_amount)}`} confirmLabel="Remove" onConfirm={() => rm.mutate(del.id)} onClose={() => setDel(null)} />}
    </Card>
  )
}

// ---------------- statutory files on a payroll run ----------------
export function StatutoryFiles({ run }) {
  const toast = useToast()
  const [warn, setWarn] = useState(null)
  const FILES = [['ecr', 'PF return (ECR)', 'ECR-'], ['esic', 'ESIC return', 'ESIC-'], ['pt', 'Professional tax', 'PT-'], ['bank', 'Bank transfer file', 'Bank-']]
  const go = async (kind, label) => {
    try {
      const c = await api(`/payroll/runs/${run.id}/export/${kind}?check=1`)
      if (c.warnings.length) setWarn({ kind, label, file: c.file, warnings: c.warnings })
      else { await download(`/payroll/runs/${run.id}/export/${kind}`, c.file); toast(`${label} downloaded`) }
    } catch (e) { toast(e.message, 'error') }
  }
  return (
    <>
      <div className="stat-files">
        <span className="muted">Files for filing and payment:</span>
        {FILES.map(([k, label]) => <Button key={k} variant="light" className="sm" icon="download" onClick={() => go(k, label)}>{label}</Button>)}
      </div>
      {warn && (
        <Modal title={`${warn.label}: check first`} onClose={() => setWarn(null)}>
          <p className="muted" style={{ marginBottom: '.6rem' }}>{warn.warnings.length} problem{warn.warnings.length === 1 ? '' : 's'} found. People listed here are left blank or left out of the file:</p>
          <ul style={{ paddingLeft: '1.2rem', maxHeight: 240, overflow: 'auto', display: 'grid', gap: '.2rem' }}>{warn.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          <div className="form-actions"><Button variant="ghost" onClick={() => setWarn(null)}>Close and fix first</Button><Button icon="download" onClick={async () => { await download(`/payroll/runs/${run.id}/export/${warn.kind}`, warn.file); setWarn(null) }}>Download anyway</Button></div>
        </Modal>
      )}
    </>
  )
}
