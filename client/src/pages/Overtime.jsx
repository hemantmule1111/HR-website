import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { Badge, Button, Card, Confirm, Empty, Field, Loading, Modal, PageHeader, Stat, useToast } from '../ui/components'
import { currentMonth, fmtDate, money, monthLabel, shiftMonth } from '../ui/format'

export const DAY_TYPE = { weekday: 'Working day', weekoff: 'Weekly off', holiday: 'Holiday' }
const hrs = (n) => `${Number(n || 0)} h`

function RequestModal({ onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const today = new Date().toISOString().slice(0, 10)
  const [f, setF] = useState({ date: today, start_time: '18:30', end_time: '20:30', reason: '' })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const hours = Math.max(0, (mins(f.end_time) - mins(f.start_time)) / 60)
  const m = useMutation({
    mutationFn: () => api('/overtime/requests', { method: 'POST', body: f }),
    onSuccess: (r) => { toast(`Overtime request sent (${r.hours} hour${r.hours === 1 ? '' : 's'})`); qc.invalidateQueries({ queryKey: ['overtime'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); onClose() },
  })
  return (
    <Modal title="Request overtime" onClose={onClose}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
        <Field label="Date worked" span={2} hint="Overtime is claimed after the work is done"><input className="input" type="date" required max={today} value={f.date} onChange={set('date')} /></Field>
        <Field label="Extra work from"><input className="input" type="time" required value={f.start_time} onChange={set('start_time')} /></Field>
        <Field label="Until" hint={hours > 0 ? `${hours} hour${hours === 1 ? '' : 's'}` : 'Must be after the start time'}><input className="input" type="time" required value={f.end_time} onChange={set('end_time')} /></Field>
        <Field label="Reason" span={2}><textarea className="input" required minLength={3} value={f.reason} onChange={set('reason')} placeholder="What did you work on?" /></Field>
        {m.error && <p className="form-error span-2">{m.error.message}</p>}
        <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button><Button busy={m.isPending}>Send request</Button></div>
      </form>
    </Modal>
  )
}

export default function Overtime() {
  const toast = useToast()
  const qc = useQueryClient()
  const [month, setMonth] = useState(currentMonth())
  const [asking, setAsking] = useState(false)
  const [cancel, setCancel] = useState(null)
  const { data: sum } = useQuery({ queryKey: ['overtime', 'summary', month], queryFn: () => api(`/overtime/summary?month=${month}`) })
  const { data = [], isLoading } = useQuery({ queryKey: ['overtime', 'mine', month], queryFn: () => api(`/overtime/requests?scope=mine&month=${month}`) })
  const m = useMutation({
    mutationFn: (id) => api(`/overtime/requests/${id}`, { method: 'PATCH', body: { action: 'cancel' } }),
    onSuccess: () => { toast('Request cancelled'); qc.invalidateQueries({ queryKey: ['overtime'] }) },
    onError: (e) => toast(e.message, 'error'),
  })
  const canAsk = sum?.eligible
  return (
    <>
      <PageHeader title="Overtime" subtitle="Claim extra hours worked. Approved overtime is paid with your salary.">
        <div className="month-pick">
          <Button variant="ghost" className="sm" icon="left" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))} />
          <b>{monthLabel(month)}</b>
          <Button variant="ghost" className="sm" icon="right" aria-label="Next month" disabled={month >= currentMonth()} onClick={() => setMonth(shiftMonth(month, 1))} />
        </div>
        <Button icon="plus" disabled={!canAsk} onClick={() => setAsking(true)}>Request overtime</Button>
      </PageHeader>
      {sum && !sum.enabled && <p className="muted" style={{ marginBottom: '1rem' }}>Overtime is switched off for this company. The admin can turn it on from the Master sheet.</p>}
      {sum && sum.enabled && !sum.has_salary && <p className="muted" style={{ marginBottom: '1rem' }}>Your salary has not been set up yet, so overtime pay cannot be worked out. Please ask HR.</p>}
      {sum && sum.enabled && sum.has_salary && !sum.eligible && <p className="muted" style={{ marginBottom: '1rem' }}>Your salary structure is not marked eligible for overtime. Please ask HR.</p>}
      <div className="grid g4" style={{ marginBottom: '1.5rem' }}>
        <Stat icon="check" tone="green" label="Approved this month" value={hrs(sum?.hours_approved)} hint={`${money(sum?.pay_approved)} to be paid`} />
        <Stat icon="clock" tone="amber" label="Waiting for approval" value={hrs(sum?.hours_pending)} />
        <Stat icon="trending" label="Hours still allowed" value={hrs(sum?.hours_left)} hint={`Limit ${sum?.max_hours_month ?? ''} h a month`} />
        <Stat icon="wallet" tone="indigo" label="Your normal pay per hour" value={money(sum?.per_hour)} hint="Before the overtime rate" />
      </div>
      <Card pad={false}>
        {isLoading ? <Loading /> : !data.length ? <Empty icon="clock" title="No overtime this month" hint="Use “Request overtime” after you have worked extra hours." /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Date</th><th>Time</th><th className="num">Hours</th><th>Day</th><th className="num">Rate</th><th className="num">Pay</th><th>Reason</th><th>Status</th><th /></tr></thead>
            <tbody>{data.map((r) => (
              <tr key={r.id}>
                <td className="nowrap">{fmtDate(r.date)}</td><td className="nowrap">{r.start_time} – {r.end_time}</td><td className="num">{r.hours}</td>
                <td>{DAY_TYPE[r.day_type]}</td><td className="num">{r.rate}×</td><td className="num">{r.status === 'rejected' || r.status === 'cancelled' ? '—' : money(r.pay)}{r.status === 'pending' && <small className="muted" style={{ display: 'block' }}>estimate</small>}</td>
                <td style={{ maxWidth: 240 }}>{r.source === 'auto' && <Badge tone="blue">From punch times</Badge>} {r.reason}{r.decision_note && <small className="muted" style={{ display: 'block' }}>Manager: {r.decision_note}</small>}</td>
                <td><Badge status={r.status}>{r.status}</Badge></td>
                <td><div className="row-actions">{(r.status === 'pending' || r.status === 'approved') && <Button variant="ghost" className="sm" onClick={() => setCancel(r)}>Cancel</Button>}</div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {cancel && <Confirm danger title="Cancel this overtime request?" message={`${fmtDate(cancel.date)} · ${cancel.hours} hour(s)`} confirmLabel="Cancel request" onConfirm={() => m.mutate(cancel.id)} onClose={() => setCancel(null)} />}
      </Card>
      {asking && <RequestModal onClose={() => setAsking(false)} />}
    </>
  )
}
