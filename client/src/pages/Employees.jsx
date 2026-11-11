import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useAuth } from '../auth'
import Icon from '../ui/Icon'
import { Avatar, Badge, Button, Card, Empty, Field, Loading, Modal, PageHeader, useToast } from '../ui/components'
import { fmtDate, titleCase } from '../ui/format'

export function useLookups() {
  const q = (key, path) => useQuery({ queryKey: [key], queryFn: () => api(path), staleTime: 60000 }) // eslint-disable-line react-hooks/rules-of-hooks
  return { departments: q('departments', '/departments').data || [], designations: q('designations', '/designations').data || [], shifts: q('shifts', '/shifts').data || [] }
}

export function EmployeeForm({ employee, onClose }) {
  const { can } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const { departments, designations, shifts } = useLookups()
  const { data: people } = useQuery({ queryKey: ['employee-options'], queryFn: () => api('/employees?limit=100') })
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: () => api('/roles') })
  const edit = !!employee
  const [f, setF] = useState(() => ({
    first_name: '', last_name: '', email: '', phone: '', dob: '', gender: '', address: '', emergency_name: '', emergency_phone: '',
    department_id: '', designation_id: '', manager_id: '', shift_id: '', join_date: new Date().toISOString().slice(0, 10),
    employment_type: 'full_time', work_location: '', status: 'probation', bank_name: '', bank_account: '', ifsc: '', pan: '', aadhaar: '',
    create_login: true, role_id: '',
    ...Object.fromEntries(Object.entries(employee || {}).map(([k, v]) => [k, v ?? ''])),
  }))
  const [result, setResult] = useState(null)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const sensitive = can('employee.view_sensitive')

  const save = useMutation({
    mutationFn: () => {
      const body = { ...f }
      if (edit) {
        for (const k of ['id', 'emp_code', 'name', 'department', 'designation', 'manager_name', 'created_at', 'updated_at', 'create_login', 'role_id']) delete body[k]
      } else if (!body.role_id) delete body.role_id
      else body.role_id = Number(body.role_id)
      return api(edit ? `/employees/${employee.id}` : '/employees', { method: edit ? 'PATCH' : 'POST', body })
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['employees'] }); qc.invalidateQueries({ queryKey: ['employee'] }); qc.invalidateQueries({ queryKey: ['org-tree'] })
      if (res.temp_password) setResult(res)
      else { toast('Employee saved'); onClose() }
    },
  })

  if (result) {
    return (
      <Modal title="Employee created" onClose={onClose}>
        <p><b>{result.name}</b> ({result.emp_code}) has been added.</p>
        <div className="demo-box" style={{ marginTop: '1rem' }}>
          <small>Login credentials — share securely</small>
          <p><b>{result.email}</b></p><p>Temporary password: <code>{result.temp_password}</code></p>
        </div>
        <div className="form-actions"><Button onClick={onClose}>Done</Button></div>
      </Modal>
    )
  }
  const sel = (k, opts, label = (o) => o.name, blank = '—') => (
    <select className="select" value={f[k]} onChange={set(k)}>
      <option value="">{blank}</option>
      {opts.map((o) => <option key={o.id} value={o.id}>{label(o)}</option>)}
    </select>
  )
  const text = (k, type = 'text', props = {}) => <input className="input" type={type} value={f[k]} onChange={set(k)} {...props} />

  return (
    <Modal title={edit ? `Edit ${employee.name}` : 'Add employee'} onClose={onClose} wide>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
        <Field label="First name">{text('first_name', 'text', { required: true })}</Field>
        <Field label="Last name">{text('last_name')}</Field>
        <Field label="Work email">{text('email', 'email', { required: true })}</Field>
        <Field label="Phone">{text('phone', 'tel')}</Field>
        <Field label="Date of birth">{text('dob', 'date')}</Field>
        <Field label="Gender"><select className="select" value={f.gender} onChange={set('gender')}><option value="">—</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select></Field>
        <Field label="Department">{sel('department_id', departments.filter((d) => d.status === 'active'))}</Field>
        <Field label="Designation">{sel('designation_id', designations.filter((d) => d.status === 'active'), (o) => o.title)}</Field>
        <Field label="Reports to">{sel('manager_id', (people?.items || []).filter((p) => p.id !== employee?.id), (o) => `${o.name} (${o.emp_code})`, 'No manager')}</Field>
        <Field label="Shift">{sel('shift_id', shifts.filter((s) => s.status === 'active'), (o) => `${o.name} · ${o.start_time}–${o.end_time}`, 'Default shift')}</Field>
        <Field label="Joining date">{text('join_date', 'date', { required: true })}</Field>
        <Field label="Employment type"><select className="select" value={f.employment_type} onChange={set('employment_type')}>{['full_time', 'part_time', 'contract', 'intern'].map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}</select></Field>
        <Field label="Work location">{text('work_location')}</Field>
        <Field label="Status"><select className="select" value={f.status} onChange={set('status')}>{['probation', 'active', 'notice', 'exited'].map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}</select></Field>
        <Field label="Address" span={2}>{text('address')}</Field>
        <Field label="Emergency contact">{text('emergency_name')}</Field>
        <Field label="Emergency phone">{text('emergency_phone', 'tel')}</Field>
        {(sensitive || !edit) && (
          <>
            <Field label="Bank name">{text('bank_name')}</Field>
            <Field label="Account number">{text('bank_account')}</Field>
            <Field label="IFSC">{text('ifsc')}</Field>
            <Field label="PAN">{text('pan')}</Field>
            <Field label="Aadhaar" span={2}>{text('aadhaar')}</Field>
          </>
        )}
        {!edit && (
          <>
            <label className="check span-2"><input type="checkbox" checked={f.create_login} onChange={set('create_login')} />Create a login for this employee</label>
            {f.create_login && <Field label="Access role" span={2}><select className="select" value={f.role_id} onChange={set('role_id')}><option value="">Employee (default)</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>}
          </>
        )}
        {save.error && <p className="form-error span-2">{save.error.message}</p>}
        <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}>
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button busy={save.isPending}>{edit ? 'Save changes' : 'Add employee'}</Button>
        </div>
      </form>
    </Modal>
  )
}

export default function Employees() {
  const nav = useNavigate()
  const { can } = useAuth()
  const { departments } = useLookups()
  const [search, setSearch] = useState('')
  const [department, setDepartment] = useState('')
  const [status, setStatus] = useState('')
  const [docs, setDocs] = useState('')
  const [page, setPage] = useState(1)
  const [adding, setAdding] = useState(false)
  const params = new URLSearchParams({ page, limit: 12, ...(search && { search }), ...(department && { department_id: department }), ...(status && { status }), ...(docs && { docs }) })
  const { data, isLoading, isFetching } = useQuery({ queryKey: ['employees', params.toString()], queryFn: () => api(`/employees?${params}`), placeholderData: (p) => p })
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1

  return (
    <>
      <PageHeader title="Employees" subtitle={data ? `${data.total} people` : ''}>
        {can('employee.manage') && <Button icon="plus" onClick={() => setAdding(true)}>Add employee</Button>}
      </PageHeader>
      <div className="toolbar">
        <div className="search"><Icon name="search" size={16} /><input className="input" placeholder="Search by name, code or email" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} /></div>
        <select className="select" value={department} onChange={(e) => { setDepartment(e.target.value); setPage(1) }}><option value="">All departments</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <select className="select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}><option value="">All statuses</option>{['probation', 'active', 'notice', 'exited'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</select>
        {can('employee.manage') && <select className="select" value={docs} onChange={(e) => { setDocs(e.target.value); setPage(1) }}><option value="">All documents</option><option value="pending">Has pending documents</option><option value="approved">All documents approved</option></select>}
      </div>
      <Card pad={false}>
        {isLoading ? <Loading /> : !data.items.length ? <Empty icon="users" title="No employees found" hint="Try a different search or filter." /> : (
          <div className="table-wrap" style={{ opacity: isFetching ? 0.6 : 1 }}>
            <table className="table">
              <thead><tr><th>Employee</th><th>Department</th><th>Designation</th><th>Reports to</th><th>Joined</th><th>Status</th>{can('employee.manage') && <th>Documents</th>}</tr></thead>
              <tbody>
                {data.items.map((e) => (
                  <tr key={e.id} className="click" onClick={() => nav(`/employees/${e.id}`)}>
                    <td><div className="who"><Avatar name={e.name} /><div><b>{e.name}</b><small>{e.emp_code} · {e.email}</small></div></div></td>
                    <td>{e.department || '—'}</td><td>{e.designation || '—'}</td><td>{e.manager_name || '—'}</td>
                    <td className="nowrap">{fmtDate(e.join_date)}</td><td><Badge status={e.status}>{titleCase(e.status)}</Badge></td>
                    {can('employee.manage') && <td className="nowrap">{e.docs_approved + e.docs_pending === 0 ? <span className="muted">None uploaded</span> : <span className="doc-counts">{e.docs_approved > 0 && <Badge tone="green">{e.docs_approved} approved</Badge>} {e.docs_pending > 0 && <Badge tone="amber">{e.docs_pending} pending</Badge>}</span>}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > data.limit && (
          <div className="pager">
            <span>Page {page} of {pages}</span>
            <div style={{ display: 'flex', gap: '.5rem' }}>
              <Button variant="ghost" className="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} icon="left">Prev</Button>
              <Button variant="ghost" className="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Card>
      {adding && <EmployeeForm onClose={() => setAdding(false)} />}
    </>
  )
}
