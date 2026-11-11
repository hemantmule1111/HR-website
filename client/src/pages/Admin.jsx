import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useAuth } from '../auth'
import Icon from '../ui/Icon'
import { Avatar, Badge, Button, Card, Confirm, Empty, Field, Loading, Modal, PageHeader, useToast } from '../ui/components'
import { fmtDateTime, timeAgo } from '../ui/format'

// ---------------- Users & access ----------------
function Secret({ title, email, password, onClose }) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="demo-box"><small>Share securely — shown only once</small>{email && <p><b>{email}</b></p>}<p>Temporary password: <code>{password}</code></p></div>
      <div className="form-actions"><Button onClick={onClose}>Done</Button></div>
    </Modal>
  )
}

export function Users() {
  const { user } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [secret, setSecret] = useState(null)
  const [reset, setReset] = useState(null)
  const [reset2, setReset2] = useState(null)
  const { data = [], isLoading } = useQuery({ queryKey: ['users'], queryFn: () => api('/users') })
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: () => api('/roles') })
  const { data: people } = useQuery({ queryKey: ['employee-options'], queryFn: () => api('/employees?limit=100') })
  const [f, setF] = useState({ email: '', role_id: '', employee_id: '' })
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] })
  const create = useMutation({
    mutationFn: () => api('/users', { method: 'POST', body: { email: f.email, role_id: Number(f.role_id), employee_id: f.employee_id ? Number(f.employee_id) : null } }),
    onSuccess: (r) => { setCreating(false); setSecret({ title: 'User created', email: r.email, password: r.temp_password }); refresh() },
  })
  const patch = useMutation({
    mutationFn: ({ id, body }) => api(`/users/${id}`, { method: 'PATCH', body }),
    onSuccess: () => { toast('Updated'); refresh() }, onError: (e) => toast(e.message, 'error'),
  })
  const doReset2 = useMutation({
    mutationFn: (id) => api(`/users/${id}/reset-2fa`, { method: 'POST' }),
    onSuccess: () => { toast('Two-step sign-in reset'); setReset2(null) }, onError: (e) => toast(e.message, 'error'),
  })
  const doReset = useMutation({
    mutationFn: (id) => api(`/users/${id}/reset-password`, { method: 'POST' }),
    onSuccess: (r, id) => setSecret({ title: 'Password reset', email: data.find((u) => u.id === id)?.email, password: r.temp_password }),
  })
  return (
    <>
      <PageHeader title="Users & access" subtitle="Who can sign in and what they can do">
        <Button icon="plus" onClick={() => setCreating(true)}>Add user</Button>
      </PageHeader>
      <Card pad={false}>
        {isLoading ? <Loading /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>User</th><th>Role</th><th>Last sign-in</th><th>Status</th><th /></tr></thead>
            <tbody>{data.map((u) => {
              const name = u.first_name ? `${u.first_name} ${u.last_name || ''}`.trim() : u.email
              return (
                <tr key={u.id}>
                  <td><div className="who"><Avatar name={name} size={34} /><div><b>{name}</b><small>{u.email}</small></div></div></td>
                  <td><select className="select" style={{ width: 'auto' }} value={u.role_id} disabled={u.id === user.id} onChange={(e) => patch.mutate({ id: u.id, body: { role_id: Number(e.target.value) } })}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></td>
                  <td className="muted">{u.last_login_at ? timeAgo(u.last_login_at) : 'Never'}</td>
                  <td><Badge status={u.is_active ? 'active' : 'inactive'}>{u.is_active ? 'Active' : 'Disabled'}</Badge></td>
                  <td><div className="row-actions">
                    <Button variant="ghost" className="sm" icon="key" onClick={() => setReset(u)}>Reset password</Button>
                    <Button variant="ghost" className="sm" icon="shield" onClick={() => setReset2(u)}>Reset two-step</Button>
                    {u.id !== user.id && <Button variant="ghost" className="sm" onClick={() => patch.mutate({ id: u.id, body: { is_active: !u.is_active } })}>{u.is_active ? 'Disable' : 'Enable'}</Button>}
                  </div></td>
                </tr>
              )
            })}</tbody>
          </table></div>
        )}
      </Card>
      {creating && (
        <Modal title="Add user" onClose={() => setCreating(false)}>
          <form className="form-grid" onSubmit={(e) => { e.preventDefault(); create.mutate() }}>
            <Field label="Email" span={2}><input className="input" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field label="Role"><select className="select" required value={f.role_id} onChange={(e) => setF({ ...f, role_id: e.target.value })}><option value="">Select…</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
            <Field label="Linked employee"><select className="select" value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })}><option value="">None</option>{(people?.items || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            {create.error && <p className="form-error span-2">{create.error.message}</p>}
            <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button variant="ghost" type="button" onClick={() => setCreating(false)}>Cancel</Button><Button busy={create.isPending}>Create user</Button></div>
          </form>
        </Modal>
      )}
      {reset2 && <Confirm title="Reset two-step sign-in?" message={`${reset2.email} will sign in with the password alone until they set up a new phone. Do this when someone has lost their phone.`} confirmLabel="Reset" onConfirm={() => doReset2.mutate(reset2.id)} onClose={() => setReset2(null)} />}
      {reset && <Confirm title="Reset password?" message={`A new temporary password will be generated for ${reset.email}.`} confirmLabel="Reset" onConfirm={() => doReset.mutate(reset.id)} onClose={() => setReset(null)} />}
      {secret && <Secret {...secret} onClose={() => setSecret(null)} />}
    </>
  )
}

// ---------------- Announcements ----------------
export function Announcements() {
  const { can } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const [edit, setEdit] = useState(null)
  const [del, setDel] = useState(null)
  const { data = [], isLoading } = useQuery({ queryKey: ['announcements'], queryFn: () => api('/announcements') })
  const manage = can('announcement.manage')
  const [f, setF] = useState({ title: '', body: '', pinned: false })
  const open = (a) => { setF(a ? { title: a.title, body: a.body, pinned: !!a.pinned } : { title: '', body: '', pinned: false }); setEdit(a || {}) }
  const save = useMutation({
    mutationFn: () => api(edit.id ? `/announcements/${edit.id}` : '/announcements', { method: edit.id ? 'PATCH' : 'POST', body: f }),
    onSuccess: () => { toast(edit.id ? 'Updated' : 'Published — everyone has been notified'); setEdit(null); qc.invalidateQueries({ queryKey: ['announcements'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }) },
  })
  const remove = useMutation({ mutationFn: (id) => api(`/announcements/${id}`, { method: 'DELETE' }), onSuccess: () => { toast('Deleted'); qc.invalidateQueries({ queryKey: ['announcements'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }) } })
  return (
    <>
      <PageHeader title="Announcements" subtitle="News and updates from HR">
        {manage && <Button icon="plus" onClick={() => open(null)}>New announcement</Button>}
      </PageHeader>
      {isLoading ? <Loading /> : !data.length ? <Card><Empty icon="megaphone" title="No announcements yet" /></Card> : (
        <div className="grid">
          {data.map((a) => (
            <Card key={a.id}>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                <span className="stat-icon indigo"><Icon name={a.pinned ? 'pin' : 'megaphone'} /></span>
                <div style={{ flex: 1 }}>
                  <h3>{a.title} {a.pinned ? <Badge tone="violet">Pinned</Badge> : null}</h3>
                  <p className="muted" style={{ margin: '.3rem 0 .6rem', whiteSpace: 'pre-wrap' }}>{a.body}</p>
                  <small className="muted">{fmtDateTime(a.created_at)}</small>
                </div>
                {manage && <div className="row-actions"><Button variant="ghost" className="sm" icon="edit" onClick={() => open(a)}>Edit</Button><Button variant="ghost" className="sm" icon="trash" aria-label="Delete" onClick={() => setDel(a)} /></div>}
              </div>
            </Card>
          ))}
        </div>
      )}
      {edit && (
        <Modal title={edit.id ? 'Edit announcement' : 'New announcement'} onClose={() => setEdit(null)}>
          <form className="form-grid" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
            <Field label="Title" span={2}><input className="input" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
            <Field label="Message" span={2}><textarea className="input" required rows={5} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
            <label className="check span-2"><input type="checkbox" checked={f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} />Pin to the top of the dashboard</label>
            {save.error && <p className="form-error span-2">{save.error.message}</p>}
            <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button variant="ghost" type="button" onClick={() => setEdit(null)}>Cancel</Button><Button busy={save.isPending}>{edit.id ? 'Save' : 'Publish'}</Button></div>
          </form>
        </Modal>
      )}
      {del && <Confirm danger title="Delete announcement?" message={`"${del.title}" will be removed for everyone.`} confirmLabel="Delete" onConfirm={() => remove.mutate(del.id)} onClose={() => setDel(null)} />}
    </>
  )
}

// ---------------- Audit log ----------------
export function AuditLog() {
  const [limit, setLimit] = useState(50)
  const { data = [], isLoading, isFetching } = useQuery({ queryKey: ['audit', limit], queryFn: () => api(`/audit-logs?limit=${limit}`), placeholderData: (p) => p })
  return (
    <>
      <PageHeader title="Audit log" subtitle="Every sensitive change, who made it and when" />
      <Card pad={false}>
        {isLoading ? <Loading /> : !data.length ? <Empty icon="file" title="No activity recorded" /> : (
          <div className="table-wrap" style={{ opacity: isFetching ? 0.6 : 1 }}><table className="table">
            <thead><tr><th>When</th><th>User</th><th>Entity</th><th>Action</th><th>IP</th></tr></thead>
            <tbody>{data.map((l) => (
              <tr key={l.id}>
                <td className="nowrap">{fmtDateTime(l.created_at)}</td><td>{l.user_email || 'system'}</td>
                <td>{l.entity.replaceAll('_', ' ')} {l.entity_id && <span className="muted">#{l.entity_id}</span>}</td>
                <td><Badge tone={['delete', 'reject', 'cancel', 'deactivate'].includes(l.action) ? 'red' : ['create', 'approve', 'upload'].includes(l.action) ? 'green' : 'blue'}>{l.action.replaceAll('_', ' ')}</Badge></td>
                <td className="muted">{l.ip}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {data.length >= limit && <div className="pager"><span /><Button variant="ghost" className="sm" onClick={() => setLimit(limit + 50)}>Load more</Button></div>}
      </Card>
    </>
  )
}
