import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useAuth } from '../auth'
import { Badge, Button, Card, Confirm, Empty, Field, Loading, Modal, PageHeader, Tabs, useToast } from '../ui/components'
import { fmtDate } from '../ui/format'
import { useCompany } from '../ui/Payslip'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const CONFIGS = {
  departments: {
    label: 'Departments', perm: 'org.manage', path: '/departments', noun: 'department',
    fields: [{ key: 'name', label: 'Name', type: 'text', required: true }],
    columns: [['name', 'Name'], ['status', 'Status']],
  },
  designations: {
    label: 'Designations', perm: 'org.manage', path: '/designations', noun: 'designation',
    fields: [{ key: 'title', label: 'Title', type: 'text', required: true }, { key: 'level', label: 'Level (1 = junior)', type: 'number', def: 1 }],
    columns: [['title', 'Title'], ['level', 'Level'], ['status', 'Status']],
  },
  shifts: {
    label: 'Shifts', perm: 'attendance.manage', path: '/shifts', noun: 'shift',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true }, { key: 'start_time', label: 'Start', type: 'time', def: '09:30' }, { key: 'end_time', label: 'End', type: 'time', def: '18:30' },
      { key: 'grace_minutes', label: 'Grace (minutes)', type: 'number', def: 15 }, { key: 'half_day_minutes', label: 'Half-day if worked under (minutes)', type: 'number', def: 240 },
      { key: 'weekly_offs', label: 'Weekly offs', type: 'days', def: '0' },
    ],
    columns: [['name', 'Name'], ['start_time', 'Start'], ['end_time', 'End'], ['grace_minutes', 'Grace'], ['weekly_offs', 'Weekly off', (v) => String(v).split(',').filter(Boolean).map((d) => DAYS[d]).join(', ')], ['status', 'Status']],
  },
  leaveTypes: {
    label: 'Leave types', perm: 'leave.manage', path: '/leave-types', noun: 'leave type',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true }, { key: 'code', label: 'Code', type: 'text', required: true }, { key: 'color', label: 'Color', type: 'color', def: '#6366f1' },
      { key: 'annual_quota', label: 'Annual quota (0 = unlimited)', type: 'number', def: 12 }, { key: 'carry_forward_max', label: 'Max carry-forward', type: 'number', def: 0 },
      { key: 'is_paid', label: 'Paid leave', type: 'bool', def: true }, { key: 'allow_half_day', label: 'Allow half days', type: 'bool', def: true },
      { key: 'count_weekoffs', label: 'Count weekends/holidays inside the range', type: 'bool', def: false },
    ],
    columns: [['name', 'Name', null, (r) => <span><span className="color-dot" style={{ background: r.color }} /> {r.name}</span>], ['code', 'Code'], ['annual_quota', 'Quota'], ['carry_forward_max', 'Carry fwd'], ['is_paid', 'Paid', (v) => (v ? 'Yes' : 'No')], ['status', 'Status']],
  },
  holidays: {
    label: 'Holidays', perm: 'leave.manage', path: '/holidays', noun: 'holiday', hard: true,
    fields: [{ key: 'date', label: 'Date', type: 'date', required: true }, { key: 'name', label: 'Name', type: 'text', required: true }, { key: 'is_optional', label: 'Optional holiday', type: 'bool', def: false }],
    columns: [['date', 'Date', (v) => fmtDate(v)], ['name', 'Name'], ['is_optional', 'Type', (v) => (v ? 'Optional' : 'Company holiday')]],
  },
}

function EditModal({ cfg, row, onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [f, setF] = useState(() => Object.fromEntries(cfg.fields.map((fl) => [fl.key, row ? (fl.type === 'bool' ? !!row[fl.key] : row[fl.key] ?? '') : fl.def ?? ''])))
  const m = useMutation({
    mutationFn: () => {
      const body = {}
      for (const fl of cfg.fields) body[fl.key] = fl.type === 'number' ? Number(f[fl.key]) : f[fl.key]
      return api(row ? `${cfg.path}/${row.id}` : cfg.path, { method: row ? 'PATCH' : 'POST', body })
    },
    onSuccess: () => { toast('Saved'); qc.invalidateQueries({ queryKey: [cfg.path] }); qc.invalidateQueries({ queryKey: [cfg.path.slice(1)] }); onClose() },
  })
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }))
  return (
    <Modal title={`${row ? 'Edit' : 'Add'} ${cfg.noun}`} onClose={onClose}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
        {cfg.fields.map((fl) => fl.type === 'bool' ? (
          <label key={fl.key} className="check span-2"><input type="checkbox" checked={!!f[fl.key]} onChange={(e) => set(fl.key, e.target.checked)} />{fl.label}</label>
        ) : fl.type === 'days' ? (
          <Field key={fl.key} label={fl.label} span={2}>
            <div className="chips">{DAYS.map((d, i) => {
              const on = String(f[fl.key]).split(',').includes(String(i))
              return <button type="button" key={d} className="chip" style={on ? { background: 'var(--primary)', color: '#fff', borderColor: 'var(--primary)' } : undefined}
                onClick={() => { const s = new Set(String(f[fl.key]).split(',').filter(Boolean)); on ? s.delete(String(i)) : s.add(String(i)); set(fl.key, [...s].sort().join(',')) }}>{d}</button>
            })}</div>
          </Field>
        ) : (
          <Field key={fl.key} label={fl.label} span={['text'].includes(fl.type) && fl.key === 'name' && cfg.fields.length < 3 ? 2 : undefined}>
            <input className="input" type={fl.type} required={fl.required} step={fl.type === 'number' ? '0.5' : undefined} min={fl.type === 'number' ? 0 : undefined} value={f[fl.key]} onChange={(e) => set(fl.key, e.target.value)} />
          </Field>
        ))}
        {m.error && <p className="form-error span-2">{m.error.message}</p>}
        <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button><Button busy={m.isPending}>Save</Button></div>
      </form>
    </Modal>
  )
}

function Master({ cfg }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [edit, setEdit] = useState(null)
  const [del, setDel] = useState(null)
  const { data = [], isLoading } = useQuery({ queryKey: [cfg.path], queryFn: () => api(cfg.path) })
  const remove = useMutation({
    mutationFn: (id) => api(`${cfg.path}/${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast(cfg.hard ? 'Deleted' : 'Deactivated'); qc.invalidateQueries({ queryKey: [cfg.path] }) },
    onError: (e) => toast(e.message, 'error'),
  })
  return (
    <Card pad={false} title={cfg.label} action={<Button icon="plus" className="sm" onClick={() => setEdit({})}>Add</Button>}>
      {isLoading ? <Loading /> : !data.length ? <Empty icon="sliders" title={`No ${cfg.label.toLowerCase()} yet`} /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr>{cfg.columns.map(([, l]) => <th key={l}>{l}</th>)}<th /></tr></thead>
          <tbody>{data.map((r) => (
            <tr key={r.id}>
              {cfg.columns.map(([k, l, fmt, render]) => <td key={l}>{render ? render(r) : k === 'status' ? <Badge status={r.status}>{r.status}</Badge> : fmt ? fmt(r[k]) : r[k]}</td>)}
              <td><div className="row-actions">
                <Button variant="ghost" className="sm" icon="edit" onClick={() => setEdit(r)}>Edit</Button>
                {(cfg.hard || r.status === 'active') && <Button variant="ghost" className="sm" icon="trash" aria-label="Remove" onClick={() => setDel(r)} />}
              </div></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {edit && <EditModal cfg={cfg} row={edit.id ? edit : null} onClose={() => setEdit(null)} />}
      {del && <Confirm danger title={cfg.hard ? 'Delete?' : 'Deactivate?'} message={cfg.hard ? 'This cannot be undone.' : 'It will no longer be selectable. Existing records keep it.'} confirmLabel={cfg.hard ? 'Delete' : 'Deactivate'} onConfirm={() => remove.mutate(del.id)} onClose={() => setDel(null)} />}
    </Card>
  )
}

function CompanyProfile() {
  const toast = useToast()
  const qc = useQueryClient()
  const { data: co, isLoading } = useCompany()
  const [f, setF] = useState(null)
  useEffect(() => { if (co && !f) setF(Object.fromEntries(FIELDS.map(([k]) => [k, co[k] ?? '']))) }, [co])
  const refresh = () => qc.invalidateQueries({ queryKey: ['company'] })
  const save = useMutation({
    mutationFn: () => api('/company', { method: 'PUT', body: f }),
    onSuccess: () => { toast('Company details saved'); refresh() },
    onError: (e) => toast(e.message, 'error'),
  })
  if (isLoading || !f) return <Loading />
  const set = (k) => (ev) => setF({ ...f, [k]: ev.target.value })
  return (
    <Card title="Company profile" action={<small className="muted">Shown on the letterhead of every payslip</small>}>
      <p className="muted" style={{ marginBottom: '1.2rem' }}>The website logo is changed on the <b>Master sheet</b> (admin only). It is used here, on the sign-in page, in the sidebar and on payslips.</p>
      <form className="form-grid" onSubmit={(ev) => { ev.preventDefault(); save.mutate() }}>
        {FIELDS.map(([k, label, kind]) => (
          <Field key={k} label={label} span={kind === 'wide' ? 2 : undefined}>
            {kind === 'color' ? (
              <div className="color-row"><input type="color" value={f[k] || '#4f46e5'} onChange={set(k)} /><input className="input" value={f[k]} onChange={set(k)} maxLength={7} /></div>
            ) : kind === 'wide' ? <textarea className="input" rows={2} value={f[k]} onChange={set(k)} />
              : <input className="input" value={f[k]} onChange={set(k)} required={k === 'name'} />}
          </Field>
        ))}
        <div className="form-actions" style={{ gridColumn: '1 / -1' }}><Button busy={save.isPending}>Save company details</Button></div>
      </form>
    </Card>
  )
}

const FIELDS = [
  ['name', 'Company name'], ['tagline', 'Tagline'],
  ['address', 'Address', 'wide'], ['phone', 'Phone'], ['email', 'Email'], ['website', 'Website'], ['tax_id', 'CIN / GSTIN / Registration no.'],
  ['accent_color', 'Payslip accent colour', 'color'], ['signatory_name', 'Authorised signatory name'], ['signatory_title', 'Signatory title (e.g. HR Manager)'],
  ['payslip_footer', 'Payslip footer note', 'wide'],
]

export default function Settings() {
  const { can } = useAuth()
  const available = Object.entries(CONFIGS).filter(([, c]) => can(c.perm))
  const tabs = [...available.map(([id, c]) => ({ id, label: c.label })), ...(can('org.manage') ? [{ id: 'company', label: 'Company' }] : [])]
  const [tab, setTab] = useState(tabs[0]?.id)
  return (
    <>
      <PageHeader title="Organization settings" subtitle="Departments, shifts, leave policy, holidays and company profile" />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'company' ? <CompanyProfile /> : <Master key={tab} cfg={CONFIGS[tab]} />}
    </>
  )
}
