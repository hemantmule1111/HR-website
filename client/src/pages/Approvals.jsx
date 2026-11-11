import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useAuth } from '../auth'
import { Avatar, Badge, Button, Card, Empty, Field, Loading, Modal, PageHeader, Tabs, useToast } from '../ui/components'
import { fmtDate, money } from '../ui/format'

function Decide({ item, kind, action, onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [note, setNote] = useState('')
  const m = useMutation({
    mutationFn: () => api(kind === 'leave' ? `/leave/requests/${item.id}` : kind === 'ot' ? `/overtime/requests/${item.id}` : `/attendance/regularizations/${item.id}`, { method: 'PATCH', body: { action, note: note || undefined } }),
    onSuccess: () => { toast(action === 'approve' ? 'Approved' : 'Rejected'); qc.invalidateQueries({ queryKey: ['approvals'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); onClose() },
    onError: (e) => toast(e.message, 'error'),
  })
  return (
    <Modal title={`${action === 'approve' ? 'Approve' : 'Reject'} request`} onClose={onClose}>
      <p className="muted" style={{ marginBottom: '1rem' }}><b>{item.name}</b> · {kind === 'leave' ? `${item.type_name}, ${item.days} day(s) from ${fmtDate(item.from_date)}` : kind === 'ot' ? `${item.hours} hour(s) of overtime on ${fmtDate(item.date)}, ${item.start_time}–${item.end_time}` : `${fmtDate(item.date)}, ${item.requested_in}–${item.requested_out}`}</p>
      <Field label="Note to employee (optional)"><textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="form-actions">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant={action === 'approve' ? 'success' : 'danger'} busy={m.isPending} onClick={() => m.mutate()}>{action === 'approve' ? 'Approve' : 'Reject'}</Button>
      </div>
    </Modal>
  )
}

function Queue({ kind, showAll }) {
  const [dec, setDec] = useState(null)
  const path = kind === 'leave' ? '/leave/requests?scope=team' : kind === 'ot' ? '/overtime/requests?scope=team' : '/attendance/regularizations?scope=team'
  const { data = [], isLoading } = useQuery({ queryKey: ['approvals', kind], queryFn: () => api(path) })
  const rows = showAll ? data : data.filter((r) => r.status === 'pending')
  return (
    <Card pad={false}>
      {isLoading ? <Loading /> : !rows.length ? <Empty icon="checkcircle" title="Nothing to review" hint="You're all caught up." /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Employee</th>{kind === 'leave' ? <><th>Type</th><th>Dates</th><th className="num">Days</th></> : kind === 'ot' ? <><th>Date</th><th>Extra work</th><th className="num">Hours</th><th className="num">Est. pay</th></> : <><th>Date</th><th>Requested times</th></>}<th>Reason</th><th>Status</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td><div className="who"><Avatar name={r.name} size={34} /><div><b>{r.name}</b><small>{r.emp_code}</small></div></div></td>
              {kind === 'leave' ? (
                <><td><span className="color-dot" style={{ background: r.color }} /> {r.type_name}</td>
                  <td className="nowrap">{fmtDate(r.from_date, false)}{r.to_date !== r.from_date && ` – ${fmtDate(r.to_date, false)}`}</td><td className="num">{r.days}</td></>
              ) : kind === 'ot' ? (<><td className="nowrap">{fmtDate(r.date)}<small className="muted" style={{ display: 'block' }}>{{ weekday: 'Working day', weekoff: 'Weekly off', holiday: 'Holiday' }[r.day_type]} · {r.rate}×</small></td><td>{r.start_time} – {r.end_time}</td><td className="num">{r.hours}</td><td className="num">{money(r.pay)}</td></>)
                : (<><td className="nowrap">{fmtDate(r.date)}</td><td>{r.requested_in} – {r.requested_out}</td></>)}
              <td style={{ maxWidth: 260 }}>{r.source === 'auto' && <Badge tone="blue">From punch times</Badge>} {r.reason}</td>
              <td><Badge status={r.status}>{r.status}</Badge></td>
              <td>{r.status === 'pending' && <div className="row-actions"><Button variant="success" className="sm" icon="check" onClick={() => setDec({ item: r, action: 'approve' })}>Approve</Button><Button variant="ghost" className="sm" onClick={() => setDec({ item: r, action: 'reject' })}>Reject</Button></div>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {dec && <Decide kind={kind} item={dec.item} action={dec.action} onClose={() => setDec(null)} />}
    </Card>
  )
}

export default function Approvals() {
  const { can } = useAuth()
  const [tab, setTab] = useState(can('leave.approve') ? 'leave' : 'att')
  const [all, setAll] = useState(false)
  const { data: dash } = useQuery({ queryKey: ['dashboard'], queryFn: () => api('/dashboard/summary') })
  const tabs = [
    ...(can('leave.approve') ? [{ id: 'leave', label: 'Leave', count: dash?.approvals.leave }] : []),
    { id: 'att', label: 'Attendance', count: dash?.approvals.regularization },
    { id: 'ot', label: 'Overtime', count: dash?.approvals.overtime },
  ]
  return (
    <>
      <PageHeader title="Approvals" subtitle="Requests from your team waiting for a decision">
        <label className="check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />Show decided</label>
      </PageHeader>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'leave' && <Queue kind="leave" showAll={all} />}
      {tab === 'att' && <Queue kind="att" showAll={all} />}
      {tab === 'ot' && <Queue kind="ot" showAll={all} />}
    </>
  )
}
