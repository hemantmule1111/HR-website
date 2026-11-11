import { useEffect, useState } from 'react'
import { EmployeeAssets } from './HrDesk'
import { EmployeeLetters } from './Letters'
import { createPortal } from 'react-dom'
import { useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, download } from '../api'
import { useAuth } from '../auth'
import Icon from '../ui/Icon'
import { useBlob } from '../ui/photo'
import { Badge, Button, Card, Confirm, Empty, Field, Loading, Modal, Tabs, useToast } from '../ui/components'
import { fmtDate, money, titleCase } from '../ui/format'
import { EmployeeForm, useLookups } from './Employees'

const Info = ({ label, children }) => <div className="info"><dt>{label}</dt><dd>{children || '—'}</dd></div>

const SECTIONS = {
  personal: { title: 'Edit personal details', fields: [
    ['phone', 'Phone'], ['dob', 'Date of birth', 'date'], ['gender', 'Gender', 'gender'], ['address', 'Address', 'text', 2], ['emergency_name', 'Emergency contact name'], ['emergency_phone', 'Emergency contact phone'],
  ] },
  bank: { title: 'Edit bank & identity', fields: [
    ['bank_name', 'Bank'], ['bank_account', 'Account number'], ['ifsc', 'IFSC'], ['pan', 'PAN'], ['aadhaar', 'Aadhaar'], ['uan', 'UAN (EPF number)'], ['esic_no', 'ESIC number'],
  ] },
}

function SectionEdit({ e, own, section, onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const spec = SECTIONS[section]
  const [f, setF] = useState(() => Object.fromEntries(spec.fields.map(([k]) => [k, e[k] ?? ''])))
  const save = useMutation({
    mutationFn: () => api(own ? '/employees/me' : `/employees/${e.id}`, { method: 'PATCH', body: f }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employee'] }); toast('Saved'); onClose() },
    onError: (er) => toast(er.message, 'error'),
  })
  return (
    <Modal title={spec.title} onClose={onClose}>
      <form className="form-grid" onSubmit={(ev) => { ev.preventDefault(); save.mutate() }}>
        {spec.fields.map(([k, label, type = 'text', span]) => (
          <Field key={k} label={label} span={span}>
            {type === 'gender'
              ? <select className="select" value={f[k]} onChange={(ev) => setF({ ...f, [k]: ev.target.value })}><option value="">—</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select>
              : <input className="input" type={type} value={f[k]} onChange={(ev) => setF({ ...f, [k]: ev.target.value })} />}
          </Field>
        ))}
        <div className="form-actions" style={{ gridColumn: '1 / -1' }}><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button><Button busy={save.isPending}>Save</Button></div>
      </form>
    </Modal>
  )
}

function Overview({ e, own, onSection }) {
  const { can } = useAuth()
  const showPrivate = e.bank_account !== undefined
  const hr = can('employee.manage')
  const editBtn = (section) => <Button variant="light" className="sm" icon="edit" onClick={() => onSection(section)}>Edit</Button>
  return (
    <div className="grid g2">
      <Card title="Personal" action={(hr || own) && editBtn('personal')}>
        <dl className="info-grid">
          <Info label="Full name">{e.name}</Info><Info label="Email">{e.email}</Info><Info label="Phone">{e.phone}</Info><Info label="Date of birth">{e.dob && fmtDate(e.dob)}</Info>
          <Info label="Gender">{e.gender && titleCase(e.gender)}</Info><Info label="Address">{e.address}</Info>
          <Info label="Emergency contact">{e.emergency_name && `${e.emergency_name} · ${e.emergency_phone || ''}`}</Info>
        </dl>
      </Card>
      <Card title="Employment" action={hr && editBtn('employment')}>
        <dl className="info-grid">
          <Info label="Department">{e.department}</Info><Info label="Designation">{e.designation}</Info><Info label="Reports to">{e.manager_name}</Info>
          <Info label="Joined">{fmtDate(e.join_date)}</Info><Info label="Type">{titleCase(e.employment_type)}</Info><Info label="Location">{e.work_location}</Info>
          {e.probation_end && <Info label="Probation ends">{fmtDate(e.probation_end)}</Info>}
          {e.exit_date && <Info label="Exit date">{fmtDate(e.exit_date)}</Info>}
        </dl>
      </Card>
      {showPrivate && (
        <Card title="Bank & identity" className="span-2" action={<>{can('employee.view_sensitive') && <Badge tone="violet">Restricted</Badge>}{(hr || own) && editBtn('bank')}</>}>
          <dl className="info-grid">
            <Info label="Bank">{e.bank_name}</Info><Info label="Account">{e.bank_account}</Info><Info label="IFSC">{e.ifsc}</Info><Info label="PAN">{e.pan}</Info><Info label="Aadhaar">{e.aadhaar}</Info><Info label="UAN (EPF)">{e.uan}</Info><Info label="ESIC number">{e.esic_no}</Info>
          </dl>
        </Card>
      )}
    </div>
  )
}

const REQUIRED_DOCS = [
  { type: 'PAN Card', label: 'PAN Card', required: true },
  { type: 'Aadhar Card', label: 'Aadhar Card', required: true },
  { type: 'Driving Licence', label: 'Driving Licence', required: false },
  { type: 'Passport', label: 'Passport', required: false },
  { type: 'Signature', label: 'Signature', required: true },
  { type: 'Education Documents', label: 'Education Documents', required: true, multiple: true },
]
const MAX_BYTES = 5 * 1024 * 1024

function useDocs(e) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['docs', e.id], queryFn: () => api(`/employees/${e.id}/documents`) })
  return { ...q, refresh: () => qc.invalidateQueries({ queryKey: ['docs', e.id] }) }
}

function uploadFile(e, type, file, expires) {
  const fd = new FormData(); fd.append('type', type); if (expires) fd.append('expires_on', expires); fd.append('file', file)
  return api(`/employees/${e.id}/documents`, { method: 'POST', body: fd })
}

const isImage = (d) => /^image\//.test(d.mime || '')

const docLabel = (d) => REQUIRED_DOCS.find((s) => s.type === d.type)?.label || d.type

// One popup for every uploaded document, with Previous / Next and a clickable list of names.
function DocViewer({ employeeId, docs, startId, onClose, onVerify, verifying }) {
  const [idx, setIdx] = useState(Math.max(0, docs.findIndex((d) => d.id === startId)))
  const doc = docs[idx]
  const { url, error, type } = useBlob(`/employees/${employeeId}/documents/${doc.id}/download`)
  const prev = () => setIdx((i) => (i - 1 + docs.length) % docs.length)
  const next = () => setIdx((i) => (i + 1) % docs.length)
  useEffect(() => {
    const onKey = (ev) => { if (ev.key === 'ArrowLeft') prev(); else if (ev.key === 'ArrowRight') next() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [docs.length])
  return (
    <Modal wide className="doc-modal" title={docLabel(doc)} onClose={onClose}>
      <div className="doc-stage">
      {error ? <p className="muted">Could not load this document.</p>
        : !url ? <Loading />
        : isImage(doc) && /^image\/(png|jpeg)$/.test(type) ? <img className="doc-viewer-img" src={url} alt={doc.original_name} />
        // Only a real PDF is ever opened in the page. Anything else is offered as a download, so a disguised file can never run.
        : type === 'application/pdf' ? <iframe className="doc-viewer" src={url} title={doc.original_name} />
        : <p className="muted">This file cannot be previewed. <a href={url} download={doc.original_name}>Download it</a>.</p>}
      </div>
      <div className="doc-nav">
        <Button variant="ghost" className="sm" onClick={prev} disabled={docs.length < 2}>‹ Previous</Button>
        <div className="doc-nav-name"><b>{docLabel(doc)}</b><small className="muted">{doc.original_name} · {idx + 1} of {docs.length}</small></div>
        <Button variant="ghost" className="sm" onClick={next} disabled={docs.length < 2}>Next ›</Button>
      </div>
      {onVerify && (
        <div className="doc-verify">
          {doc.verified_at
            ? <span className="doc-verified"><Icon name="checkcircle" size={16} /> Verified — this document is approved</span>
            : <><span className="muted">Check the document above, then approve it.</span><Button icon="check" busy={verifying} onClick={() => onVerify(doc.id)}>Verify document</Button></>}
        </div>
      )}
      <div className="doc-chips">
        {docs.map((d, i) => <button key={d.id} type="button" className={`doc-chip ${i === idx ? 'active' : ''}`} onClick={() => setIdx(i)}>{docLabel(d)}</button>)}
      </div>
    </Modal>
  )
}

function DocItem({ employeeId, doc, onView, canChange, onRemove }) {
  const { url } = useBlob(isImage(doc) ? `/employees/${employeeId}/documents/${doc.id}/download` : null)
  return (
    <div className="doc-item">
      <div className="doc-thumb">{isImage(doc) ? (url ? <img src={url} alt={doc.original_name} /> : null) : <Icon name="file" size={36} />}</div>
      <small className="muted doc-file">{doc.original_name}</small>
      <div className="doc-item-actions">
        <Button variant="soft" className="sm" onClick={() => onView(doc.id)}>View Document</Button>
        {canChange && <Button variant="ghost" className="sm" icon="trash" onClick={() => onRemove(doc)}>Remove</Button>}
      </div>
      {doc.verified_at && <small className="doc-locked"><Icon name="checkcircle" size={12} /> Verified{canChange ? '' : ' · locked'}</small>}
    </div>
  )
}

function DocSlot({ employeeId, spec, docs, file, onPick, onView, inputKey, canChange, onRemove, isHr }) {
  const toast = useToast()
  const mine = docs.filter((d) => d.type === spec.type)
  const status = mine.some((d) => d.verified_at) ? 'Verified' : mine.length ? 'Uploaded' : 'Pending'
  // A one-file document that HR has verified is locked for the employee (HR can still change it).
  const locked = !spec.multiple && !isHr && mine.some((d) => d.verified_at)
  const replacing = !spec.multiple && !locked && mine.length > 0
  const pick = (ev) => {
    const list = Array.from(ev.target.files)
    if (list.some((f) => f.size > MAX_BYTES)) { toast("Each file must be 5 MB or smaller", "error"); ev.target.value = ""; return onPick([]) }
    onPick(list)
  }
  return (
    <div className={`doc-slot ${mine.length ? "done" : ""} ${spec.multiple ? "full" : ""}`}>
      <div className="doc-slot-head">
        <b>{spec.label}{!spec.required && <small className="muted"> (Optional)</small>}</b>
        <Badge tone={status === 'Verified' ? 'green' : status === 'Uploaded' ? 'blue' : 'gray'}>{status}</Badge>
      </div>
      {mine.length > 0 && <div className="doc-items">{mine.map((d) => <DocItem key={d.id} employeeId={employeeId} doc={d} onView={onView} canChange={canChange(d)} onRemove={onRemove} />)}</div>}
      {locked ? (
        <small className="doc-locked-note"><Icon name="shield" size={14} /> HR has verified this document, so it can no longer be changed. Contact HR if it needs correcting.</small>
      ) : (
        <>
          <input key={inputKey} className="input" type="file" accept=".pdf,.jpg,.jpeg,.png" multiple={!!spec.multiple} onChange={pick} aria-label={`${replacing ? 'Replace' : 'Choose'} ${spec.label}`} />
          <small className="muted">
            JPG, PNG, or PDF (max 5MB{spec.multiple ? " each · you can select multiple files" : ""})
            {replacing ? ' · choosing a new file replaces the current one until HR verifies it' : ''}
            {file?.length ? ` · ${file.length} ready to upload` : ""}
          </small>
        </>
      )}
    </div>
  )
}

function Documents({ e }) {
  const { can, user } = useAuth()
  const toast = useToast()
  const isHr = can('employee.manage')
  // HR can change any document. Employees can change their own until HR verifies it.
  const canChange = (d) => isHr || (e.id === user.employeeId && !d.verified_at)
  const [type, setType] = useState('Offer letter')
  const [expires, setExpires] = useState('')
  const [file, setFile] = useState(null)
  const [del, setDel] = useState(null)
  const { data: all = [], isLoading, refresh } = useDocs(e)
  const data = all.filter((d) => d.type !== 'Profile Photo')
  const [picked, setPicked] = useState({})
  const [viewId, setViewId] = useState(null)
  const viewable = REQUIRED_DOCS.flatMap((s) => data.filter((d) => d.type === s.type))
  const [round, setRound] = useState(0)
  const pickedTypes = Object.keys(picked).filter((t) => picked[t]?.length)
  const pickedCount = pickedTypes.reduce((n, t) => n + picked[t].length, 0)
  const uploadAll = useMutation({
    mutationFn: async () => {
      const results = await Promise.allSettled(pickedTypes.flatMap((t) => picked[t].map((f) => uploadFile(e, t, f))))
      const failed = results.filter((r) => r.status === 'rejected')
      if (failed.length) throw new Error(`${failed.length} of ${results.length} failed: ${failed[0].reason.message}`)
      return results.length
    },
    onSuccess: (n) => toast(`${n} document${n > 1 ? 's' : ''} uploaded`),
    onError: (er) => toast(er.message, 'error'),
    onSettled: () => { setPicked({}); setRound((r) => r + 1); refresh() },
  })
  const upload = useMutation({
    mutationFn: () => uploadFile(e, type, file, expires),
    onSuccess: () => { toast('Document uploaded'); setFile(null); setExpires(''); refresh() },
    onError: (er) => toast(er.message, 'error'),
  })
  const verify = useMutation({ mutationFn: (id) => api(`/employees/${e.id}/documents/${id}/verify`, { method: 'POST' }), onSuccess: () => { toast('Marked as verified'); refresh() } })
  const remove = useMutation({
    mutationFn: (id) => api(`/employees/${e.id}/documents/${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast('Document removed'); refresh() },
    onError: (er) => { toast(er.message, 'error'); refresh() },
  })
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="grid" style={{ gap: '1.25rem' }}>
      <Card title="Required documents" action={<small className="muted">JPG, PNG, or PDF · max 5MB each</small>}>
        <div className="doc-grid">
          {REQUIRED_DOCS.map((spec) => <DocSlot key={spec.type} onView={setViewId} employeeId={e.id} inputKey={round} spec={spec} docs={data} canChange={canChange} onRemove={setDel} isHr={isHr} file={picked[spec.type]} onPick={(f) => setPicked((p) => ({ ...p, [spec.type]: f }))} />)}
        </div>
        <div style={{ marginTop: '1rem' }}>
          <Button icon="upload" busy={uploadAll.isPending} disabled={!pickedTypes.length} onClick={() => uploadAll.mutate()}>Upload Documents{pickedCount ? ` (${pickedCount})` : ""}</Button>
        </div>
      </Card>
      <Card title="Past company Other document">
        <form className="dropzone" onSubmit={(ev) => { ev.preventDefault(); upload.mutate() }}>
          <div className="form-grid">
            <Field label="Type"><select className="select" value={type} onChange={(ev) => setType(ev.target.value)}>{['Offer letter', 'Experience letter', 'Signed policy', 'Other'].map((t) => <option key={t}>{t}</option>)}</select></Field>
            <Field label="Expires on (optional)"><input className="input" type="date" value={expires} onChange={(ev) => setExpires(ev.target.value)} /></Field>
            <Field label="File (PDF, JPG or PNG · max 5 MB)" span={2}><input className="input" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(ev) => setFile(ev.target.files[0])} /></Field>
          </div>
          <div><Button icon="upload" busy={upload.isPending} disabled={!file}>Upload</Button></div>
        </form>
      </Card>
      <Card title="Documents" pad={false}>
        {isLoading ? <Loading /> : !data.length ? <Empty icon="file" title="No documents yet" /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Document</th><th>Type</th><th>Expires</th><th>Status</th><th /></tr></thead>
            <tbody>{data.map((d) => (
              <tr key={d.id}>
                <td><div className="who"><span className="event-icon" style={{ background: 'var(--grad)' }}><Icon name="file" size={16} /></span><div><b>{d.original_name}</b><small>{Math.round(d.size / 1024)} KB · {fmtDate(String(d.created_at).slice(0, 10))}</small></div></div></td>
                <td>{d.type}</td>
                <td>{d.expires_on ? <Badge tone={String(d.expires_on).slice(0, 10) < today ? 'red' : 'gray'}>{fmtDate(d.expires_on)}</Badge> : '—'}</td>
                <td>{d.verified_at ? <Badge status="verified">Verified</Badge> : <Badge status="pending">Unverified</Badge>}</td>
                <td><div className="row-actions">
                  <Button variant="ghost" className="sm" icon="download" onClick={() => download(`/employees/${e.id}/documents/${d.id}/download`, d.original_name).catch((er) => toast(er.message, 'error'))}>Download</Button>
                  {can('employee.manage') && !d.verified_at && <Button variant="soft" className="sm" onClick={() => verify.mutate(d.id)}>Verify</Button>}
                  {canChange(d) && <Button variant="ghost" className="sm" icon="trash" onClick={() => setDel(d)} aria-label="Remove">Remove</Button>}
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {viewId && viewable.length > 0 && <DocViewer employeeId={e.id} docs={viewable} startId={viewId} onClose={() => setViewId(null)} onVerify={isHr ? (id) => verify.mutate(id) : null} verifying={verify.isPending} />}
      {del && <Confirm danger title="Remove this document?" message={`"${del.original_name}" will be permanently removed.${del.verified_at ? ' It has been verified, so it will need to be uploaded and verified again.' : ' You can upload a new file afterwards.'}`} confirmLabel="Remove" onConfirm={() => remove.mutate(del.id)} onClose={() => setDel(null)} />}
    </div>
  )
}

function EventModal({ e, onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const { departments, designations } = useLookups()
  const { data: people } = useQuery({ queryKey: ['employee-options'], queryFn: () => api('/employees?limit=100') })
  const [f, setF] = useState({ event: 'promotion', effective_date: new Date().toISOString().slice(0, 10), designation_id: '', department_id: '', manager_id: '', note: '' })
  const set = (k) => (ev) => setF({ ...f, [k]: ev.target.value })
  const m = useMutation({
    mutationFn: () => api(`/employees/${e.id}/events`, { method: 'POST', body: f }),
    onSuccess: () => { toast('Career event recorded'); qc.invalidateQueries({ queryKey: ['employee'] }); qc.invalidateQueries({ queryKey: ['history', e.id] }); onClose() },
  })
  return (
    <Modal title="Record career event" onClose={onClose}>
      <form className="form-grid" onSubmit={(ev) => { ev.preventDefault(); m.mutate() }}>
        <Field label="Event"><select className="select" value={f.event} onChange={set('event')}>{['confirmation', 'promotion', 'transfer', 'exit'].map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}</select></Field>
        <Field label="Effective date"><input className="input" type="date" required value={f.effective_date} onChange={set('effective_date')} /></Field>
        {f.event === 'promotion' && <Field label="New designation" span={2}><select className="select" required value={f.designation_id} onChange={set('designation_id')}><option value="">Select…</option>{designations.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</select></Field>}
        {f.event === 'transfer' && (
          <>
            <Field label="New department"><select className="select" value={f.department_id} onChange={set('department_id')}><option value="">Unchanged</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
            <Field label="New manager"><select className="select" value={f.manager_id} onChange={set('manager_id')}><option value="">Unchanged</option>{(people?.items || []).filter((p) => p.id !== e.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          </>
        )}
        <Field label="Note" span={2}><input className="input" value={f.note} onChange={set('note')} /></Field>
        {f.event === 'exit' && <p className="form-error span-2">This marks the employee as exited and disables their login.</p>}
        {m.error && <p className="form-error span-2">{m.error.message}</p>}
        <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button><Button busy={m.isPending}>Record</Button></div>
      </form>
    </Modal>
  )
}

function Career({ e }) {
  const { can } = useAuth()
  const [adding, setAdding] = useState(false)
  const { data = [], isLoading } = useQuery({ queryKey: ['history', e.id], queryFn: () => api(`/employees/${e.id}/history`) })
  const { designations, departments } = useLookups()
  const describe = (h) => {
    const t = h.to_value || {}
    const parts = []
    if (t.designation_id) parts.push(`Designation → ${designations.find((d) => d.id === t.designation_id)?.title || t.designation_id}`)
    if (t.department_id) parts.push(`Department → ${departments.find((d) => d.id === t.department_id)?.name || t.department_id}`)
    if (t.status) parts.push(`Status → ${titleCase(t.status)}`)
    return parts.join(' · ')
  }
  return (
    <Card title="Career timeline" action={can('employee.manage') && <Button icon="plus" className="sm" onClick={() => setAdding(true)}>Record event</Button>}>
      {isLoading ? <Loading /> : (
        <ul className="timeline">
          {data.map((h) => (
            <li key={h.id}>
              <b>{titleCase(h.event)}</b> <small className="muted">· {fmtDate(h.effective_date)}</small>
              {describe(h) && <div className="muted">{describe(h)}</div>}
              {h.note && <div className="muted">{h.note}</div>}
            </li>
          ))}
        </ul>
      )}
      {adding && <EventModal e={e} onClose={() => setAdding(false)} />}
    </Card>
  )
}

const EARN = [['basic', 'Basic'], ['da', 'DA'], ['hra', 'HRA'], ['allowances', 'Special'], ['conveyance', 'Conveyance'], ['travelling_allowance', 'Travelling'], ['medical', 'Medical'], ['other_allowance', 'Other']]
const EARN_LONG = { basic: 'Basic salary', da: 'Dearness allowance', hra: 'House rent allowance', allowances: 'Special allowance', conveyance: 'Conveyance', travelling_allowance: 'Travelling allowance', medical: 'Medical allowance', other_allowance: 'Other allowances' }
const EXCLUDED = ['hra', 'conveyance', 'travelling_allowance', 'medical', 'other_allowance'] // allowances under the Labour Codes 50% rule
const EMPTY = { basic: '', da: '', hra: '', allowances: '', conveyance: '', travelling_allowance: '', medical: '', other_allowance: '', tds: '', deductions: '', pf_mode: 'ceiling', esic_applicable: false, overtime_eligible: true, pt_state: 'MH', effective_from: new Date().toISOString().slice(0, 10), note: '' }
const PF_LABEL = { ceiling: 'On wage ceiling', actual: 'On actual wages', none: 'Not applicable' }

// What the company's salary master currently allows: standard earnings that are switched on, plus the categories the company added.
function useSalaryMaster() {
  const { data: comps = [] } = useQuery({ queryKey: ['salary-components'], queryFn: () => api('/payroll/components'), staleTime: 30000 })
  const std = EARN.filter(([k]) => { const c = comps.find((x) => x.code === k); return !c || c.active })
  const label = (k) => comps.find((x) => x.code === k)?.name || EARN_LONG[k]
  const custom = comps.filter((c) => !c.is_standard && c.active)
  return { std, label, custom }
}
const itemAmount = (s, id) => Number(s.items?.find((i) => i.component_id === id)?.amount || 0)

// The current structure laid out the way an Indian payslip reads: earnings, then the statutory settings.
function Breakup({ s, master }) {
  const { data: ptStates = [] } = useQuery({ queryKey: ['pt-states'], queryFn: () => api('/payroll/pt-states'), staleTime: 60000 })
  const { std, label, custom } = master
  const customEarn = custom.filter((c) => c.kind === 'earning')
  const customDed = custom.filter((c) => c.kind === 'deduction')
  const g = std.reduce((n, [k]) => n + Number(s[k] || 0), 0) + customEarn.reduce((n, c) => n + itemAmount(s, c.id), 0)
  const excluded = std.filter(([k]) => EXCLUDED.includes(k)).reduce((n, [k]) => n + Number(s[k] || 0), 0) + customEarn.filter((c) => !c.in_wages).reduce((n, c) => n + itemAmount(s, c.id), 0)
  const wages = g - Math.min(excluded, g * 0.5)
  return (
    <div className="sal-sum">
      <div className="sal-col">
        <h4>Monthly earnings</h4>
        {std.map(([k]) => <div className="ps-row" key={k}><span>{label(k)}</span><span>{money(s[k])}</span></div>)}
        {customEarn.map((c) => <div className="ps-row" key={c.id}><span>{c.name}</span><span>{money(itemAmount(s, c.id))}</span></div>)}
        <div className="ps-row total"><span>Gross salary</span><span>{money(g)}</span></div>
        <small className="muted">Statutory wages (Labour Codes 50% rule): <b>{money(wages)}</b></small>
      </div>
      <div className="sal-col">
        <h4>Statutory settings</h4>
        <div className="ps-row"><span>Provident fund</span><span>{PF_LABEL[s.pf_mode] || s.pf_mode}</span></div>
        <div className="ps-row"><span>ESIC</span><span>{s.esic_applicable ? 'Applicable (within wage ceiling)' : 'Not applicable'}</span></div>
        <div className="ps-row"><span>Overtime</span><span>{s.overtime_eligible === 0 || s.overtime_eligible === false ? 'Not eligible' : 'Eligible (paid per the Master sheet policy)'}</span></div>
        <div className="ps-row"><span>Professional tax</span><span>{s.pt_state === 'NONE' ? 'Not applicable' : (ptStates.find((p) => p.state_code === s.pt_state)?.state_name || s.pt_state)}</span></div>
        <div className="ps-row"><span>TDS per month</span><span>{money(s.tds)}</span></div>
        <div className="ps-row"><span>Other recoveries (loan etc.)</span><span>{money(s.deductions)}</span></div>
        {customDed.map((c) => <div className="ps-row" key={c.id}><span>{c.name}</span><span>{money(itemAmount(s, c.id))}</span></div>)}
        <small className="muted">PF, ESIC and professional tax are worked out when payroll runs, using the statutory rates in force that month.</small>
      </div>
    </div>
  )
}

function Salary({ e }) {
  const { data: ptStates = [] } = useQuery({ queryKey: ['pt-states'], queryFn: () => api('/payroll/pt-states'), staleTime: 60000 })
  const { can } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const master = useSalaryMaster()
  const [adding, setAdding] = useState(false)
  const [f, setF] = useState(EMPTY)
  const [extra, setExtra] = useState({}) // amounts for the categories the company added, by category id
  const { data = [], isLoading } = useQuery({ queryKey: ['structures', e.id], queryFn: () => api(`/payroll/structures?employeeId=${e.id}`) })
  const add = useMutation({
    mutationFn: () => api('/payroll/structures', { method: 'POST', body: { ...f, employee_id: e.id, items: master.custom.map((c) => ({ component_id: c.id, amount: Number(extra[c.id] || 0) })) } }),
    onSuccess: () => { toast('Salary revision saved'); setAdding(false); qc.invalidateQueries({ queryKey: ['structures', e.id] }) },
  })
  const set = (k) => (ev) => setF({ ...f, [k]: ev.target.value })
  // A new revision starts from the current one so only the changes need typing.
  const open = () => {
    const c = data[0]
    setF(c ? { ...EMPTY, ...Object.fromEntries([...EARN.map(([k]) => k), 'tds', 'deductions'].map((k) => [k, Number(c[k]) || ''])), pf_mode: c.pf_mode, esic_applicable: !!c.esic_applicable, overtime_eligible: c.overtime_eligible !== 0 && c.overtime_eligible !== false, pt_state: c.pt_state } : EMPTY)
    setExtra(c ? Object.fromEntries((c.items || []).map((i) => [i.component_id, i.amount || ''])) : {})
    setAdding(true)
  }
  const num = (k, hint) => <Field label={master.label(k)} hint={hint}><input className="input" type="number" min="0" step="0.01" required={k === 'basic'} value={f[k]} onChange={set(k)} /></Field>
  const customEarn = master.custom.filter((c) => c.kind === 'earning')
  const customDed = master.custom.filter((c) => c.kind === 'deduction')
  const total = master.std.reduce((n, [k]) => n + Number(f[k] || 0), 0) + customEarn.reduce((n, c) => n + Number(extra[c.id] || 0), 0)
  const grossOf = (s) => master.std.reduce((n, [k]) => n + Number(s[k] || 0), 0) + customEarn.reduce((n, c) => n + itemAmount(s, c.id), 0)
  const extraBox = (c) => <Field key={c.id} label={c.name}><input className="input" type="number" min="0" step="0.01" value={extra[c.id] ?? ''} onChange={(ev) => setExtra({ ...extra, [c.id]: ev.target.value })} /></Field>
  return (
    <div className="grid" style={{ gap: '1.25rem' }}>
      {data[0] && <Card title="Current salary breakup"><Breakup s={data[0]} master={master} /></Card>}
      <Card title="Salary structure history" action={can('payroll.manage') && <Button icon="plus" className="sm" onClick={open}>New revision</Button>} pad={false}>
        {isLoading ? <Loading /> : !data.length ? <Empty icon="wallet" title="No salary structure" hint="Payroll cannot be run until one is added." /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Effective from</th>{master.std.map(([k]) => <th key={k} className="num">{master.label(k)}</th>)}{master.custom.map((c) => <th key={c.id} className="num">{c.name}</th>)}<th className="num">Gross</th><th>PF</th><th>ESIC</th><th className="num">TDS</th><th>Note</th></tr></thead>
            <tbody>{data.map((s, i) => (
              <tr key={s.id}>
                <td className="nowrap"><b>{fmtDate(s.effective_from)}</b> {i === 0 && <Badge tone="green">Current</Badge>}</td>
                {master.std.map(([k]) => <td key={k} className="num">{Number(s[k]) ? money(s[k]) : '—'}</td>)}
                {master.custom.map((c) => <td key={c.id} className="num">{itemAmount(s, c.id) ? money(itemAmount(s, c.id)) : '—'}</td>)}
                <td className="num"><b>{money(grossOf(s))}</b></td><td className="nowrap">{PF_LABEL[s.pf_mode]}</td><td>{s.esic_applicable ? 'Yes' : 'No'}</td><td className="num">{Number(s.tds) ? money(s.tds) : '—'}</td><td>{s.note}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {adding && (
        <Modal wide title="New salary revision (monthly)" onClose={() => setAdding(false)}>
          <form className="form-grid" onSubmit={(ev) => { ev.preventDefault(); add.mutate() }}>
            <h4 className="span-2 form-sub">Earnings (per month)</h4>
            {master.std.map(([k]) => <span key={k} style={{ display: 'contents' }}>{num(k, k === 'allowances' ? 'The balancing amount' : undefined)}</span>)}
            {customEarn.map(extraBox)}
            <Field label="Gross salary"><input className="input" readOnly value={money(total)} /></Field>
            <h4 className="span-2 form-sub">Statutory &amp; deductions</h4>
            <Field label="Provident fund (PF)" hint="Most employers pay PF on the wage ceiling"><select className="select" value={f.pf_mode} onChange={set('pf_mode')}><option value="ceiling">On wage ceiling (capped)</option><option value="actual">On actual wages (Basic + DA + ...)</option><option value="none">Not applicable</option></select></Field>
            <Field label="Professional tax" hint="State slabs are kept on the Master sheet"><select className="select" value={f.pt_state} onChange={set('pt_state')}>{ptStates.map((p) => <option key={p.state_code} value={p.state_code}>{p.state_name}</option>)}</select></Field>
            <Field label="ESIC" hint="Applies only while wages are within the ESIC ceiling"><select className="select" value={f.esic_applicable ? '1' : '0'} onChange={(ev) => setF({ ...f, esic_applicable: ev.target.value === '1' })}><option value="0">Not applicable</option><option value="1">Applicable</option></select></Field>
            <Field label="Overtime" hint="Rates and limits are set on the Master sheet"><select className="select" value={f.overtime_eligible ? '1' : '0'} onChange={(ev) => setF({ ...f, overtime_eligible: ev.target.value === '1' })}><option value="1">Eligible for overtime pay</option><option value="0">Not eligible</option></select></Field>
            <Field label="Income tax (TDS) per month" hint="From the employee tax projection"><input className="input" type="number" min="0" step="0.01" value={f.tds} onChange={set('tds')} /></Field>
            <Field label="Other recoveries per month" hint="Loan, advance, canteen..."><input className="input" type="number" min="0" step="0.01" value={f.deductions} onChange={set('deductions')} /></Field>
            {customDed.map(extraBox)}
            <Field label="Effective from"><input className="input" type="date" required value={f.effective_from} onChange={set('effective_from')} /></Field>
            <Field label="Note" span={2}><input className="input" value={f.note} onChange={set('note')} /></Field>
            {add.error && <p className="form-error span-2">{add.error.message}</p>}
            <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button variant="ghost" type="button" onClick={() => setAdding(false)}>Cancel</Button><Button busy={add.isPending}>Save revision</Button></div>
          </form>
        </Modal>
      )}
    </div>
  )
}

export default function EmployeeDetail() {
  const { id } = useParams()
  const { can, user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [editing, setEditing] = useState(false)
  const [section, setSection] = useState(null)
  const path = id ? `/employees/${id}` : '/employees/me'
  const { data: e, isLoading, error } = useQuery({ queryKey: ['employee', id || 'me'], queryFn: () => api(path) })
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById('crumb-extra')) }, [])
  if (isLoading) return <Loading />
  if (error) return <Empty icon="alert" title="Cannot open this profile" hint={error.message} />
  const own = e.id === user.employeeId
  const wanted = params.get('tab') || 'overview'
  const tabs = [
    { id: 'overview', label: 'Overview' }, { id: 'documents', label: 'Documents' }, { id: 'career', label: 'Career' },
    ...(can('payroll.view_all') || own ? [{ id: 'salary', label: 'Salary' }] : []),
    ...(can('employee.manage') || own ? [{ id: 'assets', label: 'Assets' }, { id: 'letters', label: 'Letters' }] : []),
  ]
  const tab = tabs.some((t) => t.id === wanted) ? wanted : 'overview'
  const setTab = (t) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true })
  return (
    <>
      {slot && createPortal(
        <>
          <span className="crumb-sep">›</span>
          <b className="crumb-name">{e.name}</b>
          <span className="muted crumb-role">{e.designation || "No designation"} · {e.department || "No department"}</span>
          <span className="crumb-badges">
            <Badge status={e.status}>{titleCase(e.status)}</Badge><Badge tone="gray">{e.emp_code}</Badge>
            {e.work_location && <Badge tone="blue"><Icon name="pin" size={12} />{e.work_location}</Badge>}
          </span>
          {can("employee.manage") && <Button variant="light" className="sm" icon="edit" onClick={() => setEditing(true)}>Edit</Button>}
        </>,
        slot,
      )}
      <div>
        <Tabs tabs={tabs} value={tab} onChange={setTab} />
        {tab === 'overview' && <Overview e={e} own={own} onSection={(k) => (k === 'employment' ? setEditing(true) : setSection(k))} />}
        {tab === 'documents' && <Documents e={e} />}
        {tab === 'career' && <Career e={e} />}
        {tab === 'salary' && <Salary e={e} />}
        {tab === 'assets' && <EmployeeAssets employeeId={e.id} />}
        {tab === 'letters' && <EmployeeLetters employeeId={e.id} />}
      </div>
      {section && <SectionEdit e={e} own={own} section={section} onClose={() => setSection(null)} />}
      {editing && <EmployeeForm employee={e} onClose={() => setEditing(false)} />}
    </>
  )
}
