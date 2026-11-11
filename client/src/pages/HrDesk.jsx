import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, download } from '../api'
import { useAuth } from '../auth'
import Icon from '../ui/Icon'
import { Badge, Button, Card, Confirm, Empty, Field, Loading, Modal, PageHeader, Tabs, useToast } from '../ui/components'
import { fmtDate } from '../ui/format'

const today = () => new Date().toISOString().slice(0, 10)
const when = (v) => (v ? fmtDate(String(v).slice(0, 10)) : '—')

// ============================ Help desk ============================
const CATEGORY = { hr: 'HR question', payroll: 'Payroll', it: 'IT / equipment', admin: 'Office / admin', grievance: 'Grievance (private)', other: 'Other' }
const STATUS = { open: ['amber', 'Open'], in_progress: ['blue', 'In progress'], resolved: ['green', 'Resolved'], closed: ['gray', 'Closed'] }
const PRIORITY = { low: ['gray', 'Low'], normal: ['blue', 'Normal'], high: ['red', 'High'] }

function NewTicket({ onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [f, setF] = useState({ category: 'hr', subject: '', description: '', priority: 'normal' })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const m = useMutation({ mutationFn: () => api('/helpdesk/tickets', { method: 'POST', body: f }), onSuccess: () => { toast('Ticket sent to HR'); qc.invalidateQueries({ queryKey: ['helpdesk'] }); onClose() } })
  return (
    <Modal title="New ticket" onClose={onClose}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
        <Field label="What is it about?"><select className="select" value={f.category} onChange={set('category')}>{Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="How urgent?"><select className="select" value={f.priority} onChange={set('priority')}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></Field>
        <Field label="Subject" span={2}><input className="input" required minLength={3} maxLength={150} value={f.subject} onChange={set('subject')} placeholder="A few words" /></Field>
        <Field label="Details" span={2} hint={f.category === 'grievance' ? 'A grievance is seen only by you and the HR team.' : undefined}><textarea className="input" required minLength={5} rows={5} value={f.description} onChange={set('description')} placeholder="Tell us what happened or what you need" /></Field>
        {m.error && <p className="form-error span-2">{m.error.message}</p>}
        <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button><Button busy={m.isPending}>Send</Button></div>
      </form>
    </Modal>
  )
}

function TicketView({ id, onClose }) {
  const { can } = useAuth()
  const hr = can('employee.manage')
  const toast = useToast()
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [internal, setInternal] = useState(false)
  const { data: t, isLoading } = useQuery({ queryKey: ['helpdesk', 'ticket', id], queryFn: () => api(`/helpdesk/tickets/${id}`) })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['helpdesk'] }) }
  const reply = useMutation({ mutationFn: () => api(`/helpdesk/tickets/${id}/comments`, { method: 'POST', body: { body: text, internal } }), onSuccess: () => { setText(''); setInternal(false); refresh() }, onError: (e) => toast(e.message, 'error') })
  const patch = useMutation({ mutationFn: (body) => api(`/helpdesk/tickets/${id}`, { method: 'PATCH', body }), onSuccess: refresh, onError: (e) => toast(e.message, 'error') })
  return (
    <Modal wide title={t ? t.subject : 'Ticket'} onClose={onClose}>
      {isLoading || !t ? <Loading /> : (
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <Badge tone={STATUS[t.status][0]}>{STATUS[t.status][1]}</Badge><Badge tone={PRIORITY[t.priority][0]}>{PRIORITY[t.priority][1]} priority</Badge><Badge tone={t.category === 'grievance' ? 'red' : 'gray'}>{CATEGORY[t.category]}</Badge>
            <small className="muted">{hr ? `${t.name} · ` : ''}raised {when(t.created_at)}</small>
          </div>
          <p style={{ whiteSpace: 'pre-wrap' }}>{t.description}</p>
          {hr ? (
            <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
              <select className="select" style={{ width: 'auto' }} value={t.status} onChange={(e) => patch.mutate({ status: e.target.value })}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v[1]}</option>)}</select>
              <select className="select" style={{ width: 'auto' }} value={t.priority} onChange={(e) => patch.mutate({ priority: e.target.value })}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v[1]} priority</option>)}</select>
            </div>
          ) : (
            <div>{t.status === 'closed' ? <Button variant="light" className="sm" onClick={() => patch.mutate({ status: 'open' })}>Open it again</Button> : <Button variant="light" className="sm" onClick={() => patch.mutate({ status: 'closed' })}>Close this ticket</Button>}</div>
          )}
          <div className="thread">
            {!t.comments.length && <p className="muted">No replies yet.</p>}
            {t.comments.map((c) => (
              <div key={c.id} className={`thread-msg ${c.is_internal ? 'internal' : ''}`}>
                <div><b>{c.name}</b> <small className="muted">{when(c.created_at)}</small>{c.is_internal && <Badge tone="amber">Internal note</Badge>}</div>
                <p style={{ whiteSpace: 'pre-wrap' }}>{c.body}</p>
              </div>
            ))}
          </div>
          {t.status !== 'closed' && (
            <form onSubmit={(e) => { e.preventDefault(); reply.mutate() }} style={{ display: 'grid', gap: '.5rem' }}>
              <textarea className="input" rows={3} required value={text} onChange={(e) => setText(e.target.value)} placeholder={internal ? 'A note only HR can see' : 'Write a reply'} />
              <div className="form-actions" style={{ justifyContent: 'space-between' }}>
                {hr ? <label className="check"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />Internal note (hidden from the employee)</label> : <span />}
                <Button busy={reply.isPending} icon="send">{internal ? 'Add note' : 'Reply'}</Button>
              </div>
            </form>
          )}
        </div>
      )}
    </Modal>
  )
}

export function HelpDesk() {
  const { can } = useAuth()
  const hr = can('employee.manage')
  const [tab, setTab] = useState(hr ? 'all' : 'mine')
  const [status, setStatus] = useState('')
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState(null)
  const { data = [], isLoading } = useQuery({ queryKey: ['helpdesk', 'list', tab, status], queryFn: () => api(`/helpdesk/tickets?scope=${tab}${status ? `&status=${status}` : ''}`), refetchInterval: 20000 })
  return (
    <>
      <PageHeader title="Help desk" subtitle="Ask HR a question, report a problem, or raise a private grievance">
        <Button icon="plus" onClick={() => setAdding(true)}>New ticket</Button>
      </PageHeader>
      {hr && <Tabs tabs={[{ id: 'all', label: 'All tickets' }, { id: 'mine', label: 'My tickets' }]} value={tab} onChange={setTab} />}
      <div style={{ margin: '0 0 1rem' }}><select className="select" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v[1]}</option>)}</select></div>
      <Card pad={false}>
        {isLoading ? <Loading /> : !data.length ? <Empty icon="inbox" title="No tickets" hint="Press New ticket to ask HR something." /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Subject</th>{tab === 'all' && <th>Employee</th>}<th>Type</th><th>Priority</th><th>Status</th><th>Updated</th></tr></thead>
            <tbody>{data.map((t) => (
              <tr key={t.id} className="clickable" onClick={() => setOpen(t.id)}>
                <td><b>{t.subject}</b></td>{tab === 'all' && <td>{t.name}</td>}
                <td>{CATEGORY[t.category]}</td><td><Badge tone={PRIORITY[t.priority][0]}>{PRIORITY[t.priority][1]}</Badge></td>
                <td><Badge tone={STATUS[t.status][0]}>{STATUS[t.status][1]}</Badge></td><td className="nowrap">{when(t.updated_at)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {adding && <NewTicket onClose={() => setAdding(false)} />}
      {open && <TicketView id={open} onClose={() => setOpen(null)} />}
    </>
  )
}

// ============================ Policies ============================
function PolicyForm({ policy, onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const file = useRef(null)
  const [f, setF] = useState({ title: policy?.title || '', description: policy?.description || '', requires_ack: policy ? policy.requires_ack : true })
  const m = useMutation({
    mutationFn: () => {
      const fd = new FormData(); fd.append('title', f.title); fd.append('description', f.description); fd.append('requires_ack', String(f.requires_ack))
      if (file.current.files[0]) fd.append('file', file.current.files[0])
      else if (!policy) throw new Error('Choose the policy file')
      return api(policy ? `/policies/${policy.id}` : '/policies', { method: 'POST', body: fd })
    },
    onSuccess: (r) => { toast(policy ? (file.current.files[0] ? `New version ${r.version} published. Everyone must acknowledge it again.` : 'Policy updated') : 'Policy published'); qc.invalidateQueries({ queryKey: ['policies'] }); onClose() },
  })
  return (
    <Modal title={policy ? `Edit: ${policy.title}` : 'Publish a policy'} onClose={onClose}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
        <Field label="Title" span={2}><input className="input" required minLength={3} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Code of conduct" /></Field>
        <Field label="Short description" span={2}><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label={policy ? 'New file (optional)' : 'File (PDF or Word)'} span={2} hint={policy ? 'Choosing a file publishes a new version, and everyone must acknowledge it again.' : 'Up to 10 MB'}><input ref={file} className="input" type="file" accept=".pdf,.docx" /></Field>
        <label className="check span-2" style={{ gridColumn: 'span 2' }}><input type="checkbox" checked={f.requires_ack} onChange={(e) => setF({ ...f, requires_ack: e.target.checked })} />Everyone must acknowledge that they have read it</label>
        {m.error && <p className="form-error span-2">{m.error.message}</p>}
        <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button><Button busy={m.isPending}>{policy ? 'Save' : 'Publish'}</Button></div>
      </form>
    </Modal>
  )
}

function Acks({ policy, onClose }) {
  const { data, isLoading } = useQuery({ queryKey: ['policies', 'acks', policy.id], queryFn: () => api(`/policies/${policy.id}/acks`) })
  return (
    <Modal wide title={`Who has read: ${policy.title}`} onClose={onClose}>
      {isLoading || !data ? <Loading /> : (
        <>
          <p className="muted" style={{ marginBottom: '.8rem' }}>{data.done} of {data.total} have acknowledged version {data.policy.version}.</p>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Employee</th><th>Status</th><th>When</th></tr></thead>
            <tbody>{data.rows.map((r) => <tr key={r.id}><td><b>{r.name}</b> <small className="muted">{r.emp_code}</small></td><td><Badge tone={r.acknowledged ? 'green' : 'amber'}>{r.acknowledged ? 'Acknowledged' : 'Pending'}</Badge></td><td className="nowrap">{when(r.acknowledged_at)}</td></tr>)}</tbody>
          </table></div>
        </>
      )}
    </Modal>
  )
}

export function Policies() {
  const { can } = useAuth()
  const hr = can('employee.manage')
  const toast = useToast()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(null) // 'new' | policy
  const [acks, setAcks] = useState(null)
  const [del, setDel] = useState(null)
  const [read, setRead] = useState({}) // opened in this visit, so "I have read it" can be offered
  const { data = [], isLoading } = useQuery({ queryKey: ['policies', 'list'], queryFn: () => api('/policies') })
  const refresh = () => qc.invalidateQueries({ queryKey: ['policies'] })
  const ack = useMutation({ mutationFn: (id) => api(`/policies/${id}/acknowledge`, { method: 'POST' }), onSuccess: () => { toast('Thank you. Your acknowledgement is recorded.'); refresh() }, onError: (e) => toast(e.message, 'error') })
  const toggle = useMutation({ mutationFn: (p) => api(`/policies/${p.id}`, { method: 'PATCH', body: { active: !p.active } }), onSuccess: refresh, onError: (e) => toast(e.message, 'error') })
  const rm = useMutation({ mutationFn: (id) => api(`/policies/${id}`, { method: 'DELETE' }), onSuccess: () => { toast('Policy deleted'); refresh() }, onError: (e) => toast(e.message, 'error') })
  const open = async (p) => { try { await download(`/policies/${p.id}/download`, p.original_name); setRead((r) => ({ ...r, [p.id]: true })) } catch (e) { toast(e.message, 'error') } }
  const pending = data.filter((p) => p.pending).length
  return (
    <>
      <PageHeader title="Company policies" subtitle="Read the policies and acknowledge them">{hr && <Button icon="plus" onClick={() => setEditing('new')}>Publish a policy</Button>}</PageHeader>
      {pending > 0 && <p className="muted" style={{ marginBottom: '1rem' }}><Icon name="alert" size={15} /> <b>{pending}</b> polic{pending === 1 ? 'y needs' : 'ies need'} your acknowledgement.</p>}
      <Card pad={false}>
        {isLoading ? <Loading /> : !data.length ? <Empty icon="file" title="No policies yet" hint={hr ? 'Publish the first one.' : 'Your HR team has not published any policies yet.'} /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Policy</th><th>Version</th><th>Status</th><th /></tr></thead>
            <tbody>{data.map((p) => (
              <tr key={p.id} style={p.active ? undefined : { opacity: 0.6 }}>
                <td><b>{p.title}</b>{p.description && <small className="muted" style={{ display: 'block' }}>{p.description}</small>}{!p.active && <Badge tone="gray">Switched off</Badge>}</td>
                <td className="num">v{p.version}</td>
                <td>{!p.requires_ack ? <Badge tone="gray">For information</Badge> : p.acknowledged ? <Badge tone="green">Acknowledged {when(p.acknowledged_at)}</Badge> : <Badge tone="amber">Pending</Badge>}</td>
                <td><div className="row-actions">
                  <Button variant="light" className="sm" icon="eye" onClick={() => open(p)}>Read</Button>
                  {p.pending && <Button className="sm" icon="check" disabled={!read[p.id]} title={read[p.id] ? '' : 'Open the policy first'} busy={ack.isPending} onClick={() => ack.mutate(p.id)}>I have read it</Button>}
                  {hr && <><Button variant="ghost" className="sm" onClick={() => setAcks(p)}>Who read it</Button><Button variant="ghost" className="sm" icon="edit" onClick={() => setEditing(p)}>Edit</Button><Button variant="ghost" className="sm" onClick={() => toggle.mutate(p)}>{p.active ? 'Switch off' : 'Switch on'}</Button><Button variant="ghost" className="sm" icon="trash" onClick={() => setDel(p)}>Delete</Button></>}
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {editing && <PolicyForm policy={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {acks && <Acks policy={acks} onClose={() => setAcks(null)} />}
      {del && <Confirm danger title="Delete this policy?" message={`${del.title} and everyone's acknowledgements will be removed.`} confirmLabel="Delete" onConfirm={() => rm.mutate(del.id)} onClose={() => setDel(null)} />}
    </>
  )
}

// ============================ Assets ============================
const ASSET_CATEGORY = { laptop: 'Laptop', phone: 'Phone', id_card: 'ID card', access_card: 'Access card', accessory: 'Accessory', other: 'Other' }
const ASSET_STATUS = { available: ['green', 'Available'], assigned: ['blue', 'Issued'], repair: ['amber', 'In repair'], retired: ['gray', 'Retired'] }

function AssetForm({ asset, onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [f, setF] = useState(asset ? { tag: asset.tag, name: asset.name, category: asset.category, serial_no: asset.serial_no || '', purchase_date: asset.purchase_date ? String(asset.purchase_date).slice(0, 10) : '', value: asset.value ?? '', notes: asset.notes || '' } : { tag: '', name: '', category: 'laptop', serial_no: '', purchase_date: '', value: '', notes: '' })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const m = useMutation({
    mutationFn: () => api(asset ? `/assets/${asset.id}` : '/assets', { method: asset ? 'PATCH' : 'POST', body: { ...f, serial_no: f.serial_no || null, purchase_date: f.purchase_date || null, value: f.value === '' ? null : Number(f.value), notes: f.notes || null } }),
    onSuccess: () => { toast(asset ? 'Asset updated' : 'Asset added'); qc.invalidateQueries({ queryKey: ['assets'] }); onClose() },
  })
  return (
    <Modal title={asset ? 'Edit asset' : 'Add an asset'} onClose={onClose}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
        <Field label="Asset tag" hint="The label on the item, e.g. LAP-0001"><input className="input" required minLength={2} value={f.tag} onChange={set('tag')} /></Field>
        <Field label="Type"><select className="select" value={f.category} onChange={set('category')}>{Object.entries(ASSET_CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Name" span={2}><input className="input" required minLength={2} value={f.name} onChange={set('name')} placeholder="e.g. Dell Latitude 5440" /></Field>
        <Field label="Serial number"><input className="input" value={f.serial_no} onChange={set('serial_no')} /></Field>
        <Field label="Purchase date"><input className="input" type="date" value={f.purchase_date} onChange={set('purchase_date')} /></Field>
        <Field label="Value (₹)"><input className="input" type="number" min="0" step="0.01" value={f.value} onChange={set('value')} /></Field>
        <Field label="Notes"><input className="input" value={f.notes} onChange={set('notes')} /></Field>
        {m.error && <p className="form-error span-2">{m.error.message}</p>}
        <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button><Button busy={m.isPending}>{asset ? 'Save' : 'Add asset'}</Button></div>
      </form>
    </Modal>
  )
}

function IssueForm({ asset, onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const { data: emps } = useQuery({ queryKey: ['emp-pick'], queryFn: () => api('/employees?limit=100') })
  const [f, setF] = useState({ employee_id: '', issued_on: today(), condition: '' })
  const m = useMutation({ mutationFn: () => api(`/assets/${asset.id}/assign`, { method: 'POST', body: { ...f, employee_id: Number(f.employee_id), condition: f.condition || undefined } }), onSuccess: () => { toast('Asset issued'); qc.invalidateQueries({ queryKey: ['assets'] }); onClose() } })
  return (
    <Modal title={`Issue ${asset.tag}`} onClose={onClose}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
        <Field label="Issue to" span={2}><select className="select" required value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })}><option value="">Choose an employee…</option>{(emps?.items || []).filter((x) => x.status !== 'exited').map((x) => <option key={x.id} value={x.id}>{x.name} ({x.emp_code})</option>)}</select></Field>
        <Field label="Date"><input className="input" type="date" required value={f.issued_on} onChange={(e) => setF({ ...f, issued_on: e.target.value })} /></Field>
        <Field label="Condition now"><input className="input" value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })} placeholder="e.g. New, with charger" /></Field>
        {m.error && <p className="form-error span-2">{m.error.message}</p>}
        <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button><Button busy={m.isPending}>Issue</Button></div>
      </form>
    </Modal>
  )
}

function ReturnForm({ asset, onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [f, setF] = useState({ returned_on: today(), condition: '', status: 'available' })
  const m = useMutation({ mutationFn: () => api(`/assets/${asset.id}/return`, { method: 'POST', body: { ...f, condition: f.condition || undefined } }), onSuccess: () => { toast('Asset taken back'); qc.invalidateQueries({ queryKey: ['assets'] }); onClose() } })
  return (
    <Modal title={`Take back ${asset.tag} from ${asset.holder}`} onClose={onClose}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
        <Field label="Date returned"><input className="input" type="date" required value={f.returned_on} onChange={(e) => setF({ ...f, returned_on: e.target.value })} /></Field>
        <Field label="Then it is"><select className="select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="available">Available again</option><option value="repair">Sent for repair</option><option value="retired">Retired</option></select></Field>
        <Field label="Condition now" span={2}><input className="input" value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })} placeholder="e.g. Good, small scratch on the lid" /></Field>
        {m.error && <p className="form-error span-2">{m.error.message}</p>}
        <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button><Button busy={m.isPending}>Take back</Button></div>
      </form>
    </Modal>
  )
}

function AssetHistory({ asset, onClose }) {
  const { data, isLoading } = useQuery({ queryKey: ['assets', 'history', asset.id], queryFn: () => api(`/assets/${asset.id}`) })
  return (
    <Modal wide title={`History of ${asset.tag}`} onClose={onClose}>
      {isLoading || !data ? <Loading /> : !data.history.length ? <Empty icon="briefcase" title="Never issued" /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Employee</th><th>Issued</th><th>Condition out</th><th>Returned</th><th>Condition in</th></tr></thead>
          <tbody>{data.history.map((h) => <tr key={h.id}><td><b>{h.name}</b> <small className="muted">{h.emp_code}</small></td><td className="nowrap">{when(h.issued_on)}</td><td>{h.condition_out || '—'}</td><td className="nowrap">{h.returned_on ? when(h.returned_on) : <Badge tone="blue">Still holding</Badge>}</td><td>{h.condition_in || '—'}</td></tr>)}</tbody>
        </table></div>
      )}
    </Modal>
  )
}

export function Assets() {
  const toast = useToast()
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [category, setCategory] = useState('')
  const [edit, setEdit] = useState(null) // 'new' | asset
  const [issue, setIssue] = useState(null)
  const [back, setBack] = useState(null)
  const [hist, setHist] = useState(null)
  const [del, setDel] = useState(null)
  const qs = [q && `q=${encodeURIComponent(q)}`, status && `status=${status}`, category && `category=${category}`].filter(Boolean).join('&')
  const { data = [], isLoading } = useQuery({ queryKey: ['assets', 'list', qs], queryFn: () => api(`/assets${qs ? `?${qs}` : ''}`) })
  const rm = useMutation({ mutationFn: (id) => api(`/assets/${id}`, { method: 'DELETE' }), onSuccess: () => { toast('Asset deleted'); qc.invalidateQueries({ queryKey: ['assets'] }) }, onError: (e) => toast(e.message, 'error') })
  const mark = useMutation({ mutationFn: ({ id, status: s }) => api(`/assets/${id}`, { method: 'PATCH', body: { status: s } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['assets'] }), onError: (e) => toast(e.message, 'error') })
  return (
    <>
      <PageHeader title="Assets" subtitle="Laptops, phones, cards and other company property: who has what"><Button icon="plus" onClick={() => setEdit('new')}>Add asset</Button></PageHeader>
      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <input className="input" style={{ maxWidth: 260 }} placeholder="Search tag, name or serial" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{Object.entries(ASSET_STATUS).map(([k, v]) => <option key={k} value={k}>{v[1]}</option>)}</select>
        <select className="select" style={{ width: 'auto' }} value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All types</option>{Object.entries(ASSET_CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </div>
      <Card pad={false}>
        {isLoading ? <Loading /> : !data.length ? <Empty icon="briefcase" title="No assets" hint="Add the first asset." /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Tag</th><th>Asset</th><th>Type</th><th>Status</th><th>With</th><th /></tr></thead>
            <tbody>{data.map((a) => (
              <tr key={a.id}>
                <td><b>{a.tag}</b></td><td>{a.name}{a.serial_no && <small className="muted" style={{ display: 'block' }}>S/N {a.serial_no}</small>}</td><td>{ASSET_CATEGORY[a.category]}</td>
                <td><Badge tone={ASSET_STATUS[a.status][0]}>{ASSET_STATUS[a.status][1]}</Badge></td>
                <td>{a.holder ? <>{a.holder}<small className="muted" style={{ display: 'block' }}>since {when(a.issued_on)}</small></> : '—'}</td>
                <td><div className="row-actions">
                  {a.status === 'available' && <Button variant="light" className="sm" onClick={() => setIssue(a)}>Issue</Button>}
                  {a.status === 'assigned' && <Button variant="light" className="sm" onClick={() => setBack(a)}>Take back</Button>}
                  {a.status === 'repair' && <Button variant="ghost" className="sm" onClick={() => mark.mutate({ id: a.id, status: 'available' })}>Repaired</Button>}
                  <Button variant="ghost" className="sm" onClick={() => setHist(a)}>History</Button>
                  <Button variant="ghost" className="sm" icon="edit" onClick={() => setEdit(a)}>Edit</Button>
                  {a.status !== 'assigned' && <Button variant="ghost" className="sm" icon="trash" onClick={() => setDel(a)}>Delete</Button>}
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {edit && <AssetForm asset={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {issue && <IssueForm asset={issue} onClose={() => setIssue(null)} />}
      {back && <ReturnForm asset={back} onClose={() => setBack(null)} />}
      {hist && <AssetHistory asset={hist} onClose={() => setHist(null)} />}
      {del && <Confirm danger title="Delete this asset?" message={`${del.tag}: ${del.name}. An asset that was ever issued cannot be deleted; mark it as retired instead.`} confirmLabel="Delete" onConfirm={() => rm.mutate(del.id)} onClose={() => setDel(null)} />}
    </>
  )
}

// What one employee holds now and before (shown on their profile).
export function EmployeeAssets({ employeeId }) {
  const { data, isLoading } = useQuery({ queryKey: ['assets', 'employee', employeeId], queryFn: () => api(`/employees/${employeeId}/assets`) })
  if (isLoading || !data) return <Loading />
  const row = (h, now) => <tr key={h.id}><td><b>{h.tag}</b></td><td>{h.name}<small className="muted" style={{ display: 'block' }}>{ASSET_CATEGORY[h.category]}{h.serial_no ? ` · S/N ${h.serial_no}` : ''}</small></td><td className="nowrap">{when(h.issued_on)}</td><td>{now ? <Badge tone="blue">Holding</Badge> : when(h.returned_on)}</td><td>{(now ? h.condition_out : h.condition_in) || '—'}</td></tr>
  return (
    <Card title="Company assets">
      {!data.holding.length && !data.history.length ? <Empty icon="briefcase" title="No assets issued" /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Tag</th><th>Asset</th><th>Issued</th><th>Returned</th><th>Condition</th></tr></thead>
          <tbody>{data.holding.map((h) => row(h, true))}{data.history.map((h) => row(h, false))}</tbody>
        </table></div>
      )}
    </Card>
  )
}
