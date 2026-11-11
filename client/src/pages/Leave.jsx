import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useAuth } from '../auth'
import Icon from '../ui/Icon'
import { Ring } from '../ui/charts'
import { Avatar, Badge, Button, Card, Confirm, Empty, Field, Loading, Modal, PageHeader, Tabs, useToast } from '../ui/components'
import { currentMonth, fmtDate, monthLabel, shiftMonth } from '../ui/format'

function ApplyModal({ types, balances, onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const [f, setF] = useState({ leave_type_id: types[0]?.id || '', from_date: tomorrow, to_date: tomorrow, day_part: 'full', reason: '' })
  const type = types.find((t) => t.id === Number(f.leave_type_id))
  const bal = balances.find((b) => b.leave_type_id === Number(f.leave_type_id))
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value, ...(k === 'from_date' && f.to_date < e.target.value ? { to_date: e.target.value } : {}) })
  const m = useMutation({
    mutationFn: () => api('/leave/requests', { method: 'POST', body: { ...f, leave_type_id: Number(f.leave_type_id), to_date: f.day_part === 'full' ? f.to_date : f.from_date } }),
    onSuccess: (r) => { toast(`Leave request sent (${r.days} day${r.days === 1 ? '' : 's'})`); qc.invalidateQueries({ queryKey: ['leave'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); onClose() },
  })
  return (
    <Modal title="Apply for leave" onClose={onClose}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
        <Field label="Leave type" span={2} hint={bal && !bal.unlimited ? `${bal.available} day(s) available` : bal?.unlimited ? 'Unpaid — deducted from salary' : undefined}>
          <select className="select" value={f.leave_type_id} onChange={set('leave_type_id')}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        </Field>
        <Field label="Duration" span={2}>
          <select className="select" value={f.day_part} onChange={set('day_part')}>
            <option value="full">Full day(s)</option>
            {type?.allow_half_day ? <><option value="first_half">First half</option><option value="second_half">Second half</option></> : null}
          </select>
        </Field>
        <Field label={f.day_part === 'full' ? 'From' : 'Date'}><input className="input" type="date" required value={f.from_date} onChange={set('from_date')} /></Field>
        {f.day_part === 'full' && <Field label="To"><input className="input" type="date" required min={f.from_date} value={f.to_date} onChange={set('to_date')} /></Field>}
        <Field label="Reason" span={2}><textarea className="input" required minLength={3} value={f.reason} onChange={set('reason')} placeholder="Tell your manager why you need time off" /></Field>
        {m.error && <p className="form-error span-2">{m.error.message}</p>}
        <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button><Button busy={m.isPending}>Send request</Button></div>
      </form>
    </Modal>
  )
}

function MyRequests() {
  const toast = useToast()
  const qc = useQueryClient()
  const [cancel, setCancel] = useState(null)
  const { data = [], isLoading } = useQuery({ queryKey: ['leave', 'mine'], queryFn: () => api('/leave/requests?scope=mine') })
  const m = useMutation({
    mutationFn: (id) => api(`/leave/requests/${id}`, { method: 'PATCH', body: { action: 'cancel' } }),
    onSuccess: () => { toast('Request cancelled'); qc.invalidateQueries({ queryKey: ['leave'] }) },
    onError: (e) => toast(e.message, 'error'),
  })
  const today = new Date().toISOString().slice(0, 10)
  return (
    <Card pad={false}>
      {isLoading ? <Loading /> : !data.length ? <Empty icon="calendar" title="No leave requests yet" hint="Use “Apply for leave” to get started." /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Type</th><th>Dates</th><th className="num">Days</th><th>Reason</th><th>Status</th><th /></tr></thead>
          <tbody>{data.map((r) => (
            <tr key={r.id}>
              <td><span className="color-dot" style={{ background: r.color }} /> <b>{r.type_name}</b></td>
              <td className="nowrap">{fmtDate(r.from_date, false)}{r.to_date !== r.from_date && ` – ${fmtDate(r.to_date)}`}{r.to_date === r.from_date && `, ${String(r.from_date).slice(0, 4)}`}{r.day_part !== 'full' && <small className="muted"> ({r.day_part.replace('_', ' ')})</small>}</td>
              <td className="num">{r.days}</td><td>{r.reason}{r.decision_note && <small className="muted" style={{ display: 'block' }}>Manager: {r.decision_note}</small>}</td>
              <td><Badge status={r.status}>{r.status}</Badge></td>
              <td><div className="row-actions">{(r.status === 'pending' || (r.status === 'approved' && String(r.from_date).slice(0, 10) >= today)) && <Button variant="ghost" className="sm" onClick={() => setCancel(r)}>Cancel</Button>}</div></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {cancel && <Confirm danger title="Cancel this request?" message={`${cancel.type_name} · ${fmtDate(cancel.from_date)}${cancel.status === 'approved' ? ' — your balance will be restored.' : ''}`} confirmLabel="Cancel request" onConfirm={() => m.mutate(cancel.id)} onClose={() => setCancel(null)} />}
    </Card>
  )
}

function TeamCalendar() {
  const [month, setMonth] = useState(currentMonth())
  const { data, isLoading } = useQuery({ queryKey: ['leave', 'cal', month], queryFn: () => api(`/leave/calendar?month=${month}`) })
  return (
    <>
      <div className="toolbar cal-head">
        <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month"><Icon name="left" /></button>
        <h3>{monthLabel(month)}</h3>
        <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month"><Icon name="right" /></button>
      </div>
      <Card pad={false}>
        {isLoading ? <Loading /> : !data.items.length ? <Empty icon="calendar" title="Nobody is on leave this month" /> : (
          <div className="card-body list">
            {data.items.map((l) => (
              <div className="list-item" key={l.id}>
                <Avatar name={l.name} size={38} />
                <div className="grow"><b>{l.name}</b><small>{fmtDate(l.from_date, false)}{l.to_date !== l.from_date && ` – ${fmtDate(l.to_date, false)}`}</small></div>
                <span className="badge" style={{ background: `${l.color}22`, color: l.color }}>{l.type_name}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  )
}

function Holidays() {
  const { data = [], isLoading } = useQuery({ queryKey: ['holidays'], queryFn: () => api('/holidays') })
  const byYear = data.reduce((m, h) => { const y = String(h.date).slice(0, 4); (m[y] ||= []).push(h); return m }, {})
  return (
    <Card pad={false}>
      {isLoading ? <Loading /> : !data.length ? <Empty icon="calendar" title="No holidays configured" /> : (
        <div className="card-body">
          {Object.entries(byYear).sort(([x], [y]) => x - y).map(([year, list]) => (
            <section key={year} className="holiday-year">
              <h3 className="holiday-year-title">{year} <small className="muted">{list.length} holidays</small></h3>
              <div className="list">
                {list.map((h) => {
                  const d = String(h.date).slice(0, 10)
                  return (
                    <div className="list-item" key={h.id}>
                      <div className="date-chip"><small>{fmtDate(h.date).split(' ')[1]}</small><span>{d.slice(8, 10)}</span></div>
                      <div className="grow"><b>{h.name}</b><small>{new Date(`${d}T00:00:00`).toLocaleDateString([], { weekday: 'long' })}, {year}</small></div>
                      {h.is_optional ? <Badge tone="gray">Optional</Badge> : <Badge tone="blue">Company holiday</Badge>}
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </Card>
  )
}

export default function Leave() {
  const { can } = useAuth()
  const [tab, setTab] = useState('mine')
  const [applying, setApplying] = useState(false)
  const { data: balances = [], isLoading } = useQuery({ queryKey: ['leave', 'balances'], queryFn: () => api('/leave/balances') })
  const { data: types = [] } = useQuery({ queryKey: ['leave-types'], queryFn: () => api('/leave-types') })
  if (isLoading) return <Loading />
  return (
    <>
      <PageHeader title="Leave" subtitle="Balances, requests and your team's time off">
        {can('leave.apply') && <Button icon="plus" onClick={() => setApplying(true)}>Apply for leave</Button>}
      </PageHeader>
      <div className="grid g4" style={{ marginBottom: '1.5rem' }}>
        {balances.map((b) => (
          <Card key={b.code}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              {b.unlimited ? <span className="stat-icon" style={{ background: b.color }}><Icon name="calendar" /></span> : <Ring value={b.available} max={b.opening + b.accrued || 1} color={b.color}>{b.available}</Ring>}
              <div><b>{b.name}</b><p className="muted">{b.unlimited ? `${b.used} day(s) taken` : `${b.used} used of ${b.opening + b.accrued}`}</p>{b.opening > 0 && <small className="muted">incl. {b.opening} carried over</small>}</div>
            </div>
          </Card>
        ))}
      </div>
      <Tabs tabs={[{ id: 'mine', label: 'My requests' }, { id: 'team', label: 'Who is off' }, { id: 'holidays', label: 'Holidays' }]} value={tab} onChange={setTab} />
      {tab === 'mine' && <MyRequests />}
      {tab === 'team' && <TeamCalendar />}
      {tab === 'holidays' && <Holidays />}
      {applying && <ApplyModal types={types.filter((t) => t.status === 'active')} balances={balances} onClose={() => setApplying(false)} />}
    </>
  )
}
