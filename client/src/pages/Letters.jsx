import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useAuth } from '../auth'
import Icon from '../ui/Icon'
import { Badge, Button, Card, Confirm, Empty, Field, Loading, Modal, PageHeader, Tabs, useToast } from '../ui/components'
import { useCompany } from '../ui/Payslip'
import { useBlob } from '../ui/photo'

const TYPE = { offer: 'Offer', appointment: 'Appointment', experience: 'Experience', relieving: 'Relieving', custom: 'Other' }
const day = (v) => (v ? new Date(`${String(v).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '')

// ---------------- the printed letter ----------------
function Sheet({ letter }) {
  const { data: co } = useCompany()
  const { url: logo } = useBlob(co?.has_logo ? '/company/logo' : null)
  const accent = co?.accent_color || '#4f46e5'
  const paras = String(letter.body).split(/\n{2,}/)
  return (
    <article className="letter-sheet">
      <header className="letter-head" style={{ borderBottomColor: accent }}>
        <img src={logo || `${import.meta.env.BASE_URL}logo.png`} alt="" className="letter-logo" />
        <div>
          <h2 style={{ color: accent }}>{co?.name}</h2>
          {co?.address && <p>{co.address}</p>}
          <p>{[co?.phone, co?.email, co?.website].filter(Boolean).join('  ·  ')}</p>
          {co?.tax_id && <p>{co.tax_id}</p>}
        </div>
      </header>
      <div className="letter-meta"><span>Ref: {letter.reference_no}</span><span>Date: {day(letter.issued_on)}</span></div>
      <h3 className="letter-title">{letter.title}</h3>
      <div className="letter-body">{paras.map((p, i) => <p key={i}>{p}</p>)}</div>
      <footer className="letter-sign">
        <p>For <b>{co?.name}</b></p>
        <div className="letter-sign-space" />
        <p><b>{letter.signatory_name || ''}</b></p>
        <p>{letter.signatory_title || ''}</p>
      </footer>
    </article>
  )
}

export function LetterView() {
  const { id } = useParams()
  const { can } = useAuth()
  const nav = useNavigate()
  const { data: l, isLoading, error } = useQuery({ queryKey: ['letters', 'one', id], queryFn: () => api(`/letters/${id}`) })
  if (isLoading) return <Loading />
  if (error) return <Card><Empty icon="file" title="Letter not found" hint={error.message} /></Card>
  return (
    <>
      <div className="letter-toolbar">
        <Button variant="ghost" icon="left" onClick={() => nav(-1)}>Back</Button>
        <span className="muted">{l.name} · {l.reference_no}</span>
        <Button icon="printer" onClick={() => window.print()}>Print / Save as PDF</Button>
      </div>
      {can('employee.manage') && <small className="muted letter-hint">In the print window choose <b>Save as PDF</b> as the printer to download a PDF. Turn off "Headers and footers" for a clean page.</small>}
      <Sheet letter={l} />
    </>
  )
}

// ---------------- create a letter ----------------
function CreateLetter({ onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const nav = useNavigate()
  const { data: co } = useCompany()
  const { data: emps } = useQuery({ queryKey: ['emp-pick'], queryFn: () => api('/employees?limit=100') })
  const { data: tpl } = useQuery({ queryKey: ['letters', 'templates'], queryFn: () => api('/letters/templates') })
  const active = (tpl?.templates || []).filter((t) => t.active)
  const [f, setF] = useState({ employee_id: '', template_id: '', signatory_name: '', signatory_title: '', last_working_day: '', resignation_date: '', probation_months: '6', notice_period: '30 days' })
  const [draft, setDraft] = useState(null)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const tid = Number(f.template_id || active[0]?.id)
  const selected = active.find((t) => t.id === tid)
  const prep = useMutation({
    mutationFn: () => api('/letters/preview', { method: 'POST', body: { employee_id: Number(f.employee_id), template_id: tid, extra: Object.fromEntries(Object.entries({ signatory_name: f.signatory_name || co?.signatory_name, signatory_title: f.signatory_title || co?.signatory_title, last_working_day: f.last_working_day, resignation_date: f.resignation_date, probation_months: f.probation_months, notice_period: f.notice_period }).filter(([, v]) => v)) } }),
    onSuccess: (r) => setDraft(r),
  })
  const issue = useMutation({
    mutationFn: () => api('/letters', { method: 'POST', body: { employee_id: Number(f.employee_id), template_id: tid, type: draft.type, title: draft.title, body: draft.body, signatory_name: draft.signatory_name, signatory_title: draft.signatory_title } }),
    onSuccess: (r) => { toast(`Letter ${r.reference_no} issued`); qc.invalidateQueries({ queryKey: ['letters'] }); onClose(); nav(`/letters/${r.id}`) },
  })
  if (draft) {
    return (
      <Modal wide title="Check the letter, then issue it" onClose={onClose}>
        <div className="form-grid">
          <Field label="Heading" span={2}><input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
          <Field label="Letter text" span={2} hint="Change anything you need. Blank lines start a new paragraph."><textarea className="input" rows={14} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></Field>
          {draft.missing && <p className="form-error span-2" style={{ gridColumn: 'span 2' }}>Some details are missing and show as [not set] (for example the salary or a date). Fix them in the text, or go back and fill them in.</p>}
          {issue.error && <p className="form-error span-2" style={{ gridColumn: 'span 2' }}>{issue.error.message}</p>}
          <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button variant="ghost" onClick={() => setDraft(null)}>Back</Button><Button icon="check" busy={issue.isPending} onClick={() => issue.mutate()}>Issue letter</Button></div>
        </div>
      </Modal>
    )
  }
  return (
    <Modal title="Create a letter" onClose={onClose}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); prep.mutate() }}>
        <Field label="Employee" span={2}><select className="select" required value={f.employee_id} onChange={set('employee_id')}><option value="">Choose…</option>{(emps?.items || []).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.emp_code})</option>)}</select></Field>
        <Field label="Letter" span={2}><select className="select" value={f.template_id || active[0]?.id || ''} onChange={set('template_id')}>{active.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
        <Field label="Signed by"><input className="input" value={f.signatory_name} onChange={set('signatory_name')} placeholder={co?.signatory_name || 'Name'} /></Field>
        <Field label="Title"><input className="input" value={f.signatory_title} onChange={set('signatory_title')} placeholder={co?.signatory_title || 'e.g. HR Manager'} /></Field>
        {(selected?.type === 'experience' || selected?.type === 'relieving' || selected?.type === 'custom') && <Field label="Last working day"><input className="input" type="date" value={f.last_working_day} onChange={set('last_working_day')} /></Field>}
        {(selected?.type === 'relieving' || selected?.type === 'custom') && <Field label="Resignation date"><input className="input" type="date" value={f.resignation_date} onChange={set('resignation_date')} /></Field>}
        {(selected?.type === 'appointment' || selected?.type === 'custom') && <><Field label="Probation (months)"><input className="input" value={f.probation_months} onChange={set('probation_months')} /></Field><Field label="Notice period"><input className="input" value={f.notice_period} onChange={set('notice_period')} /></Field></>}
        {prep.error && <p className="form-error span-2" style={{ gridColumn: 'span 2' }}>{prep.error.message}</p>}
        <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button><Button busy={prep.isPending}>Prepare letter</Button></div>
      </form>
    </Modal>
  )
}

// ---------------- templates ----------------
function TemplateForm({ template, placeholders, onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [f, setF] = useState(template ? { type: template.type, name: template.name, title: template.title, body: template.body, active: template.active } : { type: 'custom', name: '', title: '', body: '', active: true })
  const m = useMutation({
    mutationFn: () => api(template ? `/letters/templates/${template.id}` : '/letters/templates', { method: template ? 'PATCH' : 'POST', body: f }),
    onSuccess: () => { toast('Template saved'); qc.invalidateQueries({ queryKey: ['letters'] }); onClose() },
  })
  return (
    <Modal wide title={template ? `Edit: ${template.name}` : 'New template'} onClose={onClose}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
        <Field label="Name (for HR)"><input className="input" required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Type"><select className="select" disabled={template?.is_default} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Heading printed on the letter" span={2}><input className="input" required minLength={2} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Letter text" span={2} hint="Click a detail below to add it where the cursor is at the end. It is replaced by the real value for each employee."><textarea className="input" required rows={12} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
        <div className="span-2 chips" style={{ gridColumn: 'span 2' }}>{placeholders.map(([k, label]) => <button type="button" key={k} className="chip" title={`{{${k}}}`} onClick={() => setF({ ...f, body: `${f.body}{{${k}}}` })}>{label}</button>)}</div>
        <label className="check span-2" style={{ gridColumn: 'span 2' }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />In use (shown when creating a letter)</label>
        {m.error && <p className="form-error span-2" style={{ gridColumn: 'span 2' }}>{m.error.message}</p>}
        <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button><Button busy={m.isPending}>Save</Button></div>
      </form>
    </Modal>
  )
}

// ---------------- the HR page ----------------
export default function Letters() {
  const toast = useToast()
  const qc = useQueryClient()
  const [tab, setTab] = useState('letters')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(null)
  const [del, setDel] = useState(null)
  const [delT, setDelT] = useState(null)
  const { data: letters = [], isLoading } = useQuery({ queryKey: ['letters', 'list'], queryFn: () => api('/letters') })
  const { data: tpl } = useQuery({ queryKey: ['letters', 'templates'], queryFn: () => api('/letters/templates') })
  const refresh = () => qc.invalidateQueries({ queryKey: ['letters'] })
  const rm = useMutation({ mutationFn: (id) => api(`/letters/${id}`, { method: 'DELETE' }), onSuccess: () => { toast('Letter deleted'); refresh() }, onError: (e) => toast(e.message, 'error') })
  const rmT = useMutation({ mutationFn: (id) => api(`/letters/templates/${id}`, { method: 'DELETE' }), onSuccess: () => { toast('Template deleted'); refresh() }, onError: (e) => toast(e.message, 'error') })
  const toggle = useMutation({ mutationFn: (t) => api(`/letters/templates/${t.id}`, { method: 'PATCH', body: { active: !t.active } }), onSuccess: refresh, onError: (e) => toast(e.message, 'error') })
  return (
    <>
      <PageHeader title="Letters" subtitle="Offer, appointment, experience and relieving letters on your letterhead"><Button icon="plus" onClick={() => setCreating(true)}>Create a letter</Button></PageHeader>
      <Tabs tabs={[{ id: 'letters', label: 'Issued letters' }, { id: 'templates', label: 'Templates' }]} value={tab} onChange={setTab} />
      {tab === 'letters' ? (
        <Card pad={false}>
          {isLoading ? <Loading /> : !letters.length ? <Empty icon="file" title="No letters yet" hint="Press Create a letter." /> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Reference</th><th>Employee</th><th>Letter</th><th>Issued</th><th /></tr></thead>
              <tbody>{letters.map((l) => (
                <tr key={l.id}><td className="nowrap"><b>{l.reference_no}</b></td><td>{l.name} <small className="muted">{l.emp_code}</small></td><td><Badge tone="blue">{TYPE[l.type]}</Badge> {l.title}</td><td className="nowrap">{day(l.issued_on)}</td>
                  <td><div className="row-actions"><Link className="btn light sm" to={`/letters/${l.id}`}><Icon name="printer" size={14} />View / Print</Link><Button variant="ghost" className="sm" icon="trash" onClick={() => setDel(l)}>Delete</Button></div></td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}><Button icon="plus" variant="light" onClick={() => setEditing('new')}>New template</Button></div>
          <Card pad={false}>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Template</th><th>Type</th><th>Status</th><th /></tr></thead>
              <tbody>{(tpl?.templates || []).map((t) => (
                <tr key={t.id}><td><b>{t.name}</b>{t.is_default && <small className="muted" style={{ display: 'block' }}>Comes with WorkPilot</small>}</td><td>{TYPE[t.type]}</td><td><Badge tone={t.active ? 'green' : 'gray'}>{t.active ? 'In use' : 'Not in use'}</Badge></td>
                  <td><div className="row-actions"><Button variant="light" className="sm" icon="edit" onClick={() => setEditing(t)}>Edit</Button><Button variant="ghost" className="sm" onClick={() => toggle.mutate(t)}>{t.active ? 'Switch off' : 'Switch on'}</Button>{!t.is_default && <Button variant="ghost" className="sm" icon="trash" onClick={() => setDelT(t)}>Delete</Button>}</div></td></tr>
              ))}</tbody>
            </table></div>
          </Card>
        </>
      )}
      {creating && <CreateLetter onClose={() => setCreating(false)} />}
      {editing && tpl && <TemplateForm template={editing === 'new' ? null : editing} placeholders={tpl.placeholders} onClose={() => setEditing(null)} />}
      {del && <Confirm danger title="Delete this letter?" message={`${del.reference_no} for ${del.name}. The employee will no longer see it.`} confirmLabel="Delete" onConfirm={() => rm.mutate(del.id)} onClose={() => setDel(null)} />}
      {delT && <Confirm danger title="Delete this template?" message={delT.name} confirmLabel="Delete" onConfirm={() => rmT.mutate(delT.id)} onClose={() => setDelT(null)} />}
    </>
  )
}

// On a profile: the letters issued to that employee.
export function EmployeeLetters({ employeeId }) {
  const { data = [], isLoading } = useQuery({ queryKey: ['letters', 'employee', employeeId], queryFn: () => api(`/letters?employee_id=${employeeId}`) })
  return (
    <Card title="Letters">
      {isLoading ? <Loading /> : !data.length ? <Empty icon="file" title="No letters issued" /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Reference</th><th>Letter</th><th>Issued</th><th /></tr></thead>
          <tbody>{data.map((l) => <tr key={l.id}><td className="nowrap"><b>{l.reference_no}</b></td><td><Badge tone="blue">{TYPE[l.type]}</Badge> {l.title}</td><td className="nowrap">{day(l.issued_on)}</td><td><Link className="btn light sm" to={`/letters/${l.id}`}><Icon name="printer" size={14} />View / Print</Link></td></tr>)}</tbody>
        </table></div>
      )}
    </Card>
  )
}
