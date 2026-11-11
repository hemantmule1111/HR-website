import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useAuth } from '../auth'
import Icon from '../ui/Icon'
import { Avatar, Badge, Button, Card, Empty, Field, Loading, Modal, PageHeader, Tabs, useToast } from '../ui/components'
import { Link } from 'react-router-dom'
import { useI18n } from '../i18n'
import { useBlob } from '../ui/photo'
import { currentMonth, fmtDate, fmtTime, hours, monthLabel, shiftMonth } from '../ui/format'

const LABEL = { present: 'Present', half_day: 'Half day', absent: 'Absent', leave: 'Leave', half_leave: 'Half leave', weekoff: 'Week off', pending: 'Today', upcoming: '', na: '' }
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function RegularizeModal({ date, onClose }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [f, setF] = useState({ date, requested_in: '09:30', requested_out: '18:30', reason: '' })
  const m = useMutation({
    mutationFn: () => api('/attendance/regularizations', { method: 'POST', body: f }),
    onSuccess: () => { toast('Request sent to your manager'); qc.invalidateQueries({ queryKey: ['regs'] }); onClose() },
  })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  return (
    <Modal title="Regularize attendance" onClose={onClose}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
        <Field label="Date" span={2}><input className="input" type="date" required max={new Date().toISOString().slice(0, 10)} value={f.date} onChange={set('date')} /></Field>
        <Field label="Check-in"><input className="input" type="time" required value={f.requested_in} onChange={set('requested_in')} /></Field>
        <Field label="Check-out"><input className="input" type="time" required value={f.requested_out} onChange={set('requested_out')} /></Field>
        <Field label="Reason" span={2}><textarea className="input" required minLength={3} value={f.reason} onChange={set('reason')} placeholder="Forgot to punch, client visit, system issue…" /></Field>
        {m.error && <p className="form-error span-2">{m.error.message}</p>}
        <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button><Button busy={m.isPending}>Submit request</Button></div>
      </form>
    </Modal>
  )
}

function PhotoModal({ id, onClose }) {
  const a = useBlob(`/attendance/${id}/photo/in`)
  const b = useBlob(`/attendance/${id}/photo/out`)
  return (
    <Modal title="Punch photos" onClose={onClose}>
      <div className="selfie-pair">
        <figure><figcaption>Check-in</figcaption>{a.url ? <img src={a.url} alt="Check-in selfie" /> : <small className="muted">{a.error ? 'No photo' : 'Loading…'}</small>}</figure>
        <figure><figcaption>Check-out</figcaption>{b.url ? <img src={b.url} alt="Check-out selfie" /> : <small className="muted">{b.error ? 'No photo' : 'Loading…'}</small>}</figure>
      </div>
    </Modal>
  )
}

function MyCalendar() {
  const { can, user } = useAuth()
  const [month, setMonth] = useState(currentMonth())
  const [empId, setEmpId] = useState('')
  const [reg, setReg] = useState(null)
  const [photo, setPhoto] = useState(null)
  const { data: people } = useQuery({ queryKey: ['employee-options'], queryFn: () => api('/employees?limit=100'), enabled: can('employee.view') })
  const { data, isLoading } = useQuery({ queryKey: ['att-cal', month, empId], queryFn: () => api(`/attendance/calendar?month=${month}${empId ? `&employeeId=${empId}` : ''}`) })
  const own = !empId || Number(empId) === user.employeeId
  if (isLoading) return <Loading />
  const first = new Date(`${month}-01T00:00:00Z`).getUTCDay()
  const today = new Date().toISOString().slice(0, 10)
  const s = data.summary
  return (
    <>
      <div className="toolbar">
        <div className="cal-head">
          <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month"><Icon name="left" /></button>
          <h3>{monthLabel(month)}</h3>
          <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= currentMonth()} aria-label="Next month"><Icon name="right" /></button>
        </div>
        <span className="spacer" />
        {can('employee.view') && people && (
          <select className="select" value={empId} onChange={(e) => setEmpId(e.target.value)} aria-label="Employee">
            <option value="">{user.employeeId ? 'Myself' : 'Select employee'}</option>
            {people.items.filter((p) => p.id !== user.employeeId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>
      <div className="summary-row">
        <div className="mini"><small>Present</small><b>{s.present}</b></div>
        <div className="mini"><small>Half days</small><b>{s.half_day}</b></div>
        <div className="mini"><small>Absent</small><b style={{ color: s.absent ? 'var(--red)' : undefined }}>{s.absent}</b></div>
        <div className="mini"><small>Leave</small><b>{s.leave}</b></div>
        <div className="mini"><small>Late arrivals</small><b>{s.late}</b></div>
        <div className="mini"><small>Hours worked</small><b>{hours(s.worked_minutes)}</b></div>
      </div>
      <Card>
        <div className="cal-grid">
          {DOW.map((d) => <div key={d} className="cal-dow">{d}</div>)}
          {Array.from({ length: first }).map((_, i) => <div key={`e${i}`} className="cal-cell empty-cell" />)}
          {data.days.map((d) => {
            const n = Number(d.date.slice(8, 10))
            const label = d.status === 'holiday' ? d.holiday : d.status === 'leave' || d.status === 'half_leave' ? d.leave?.code : LABEL[d.status]
            const canReg = own && d.date < today && !['holiday', 'weekoff', 'leave', 'na'].includes(d.status)
            return (
              <div key={d.date} className={`cal-cell ${d.status} ${d.date === today ? 'today' : ''}`} title={d.holiday || d.leave?.type_name || ''}>
                <span className="d">{n}</span>
                {d.record?.check_in && <span>{fmtTime(d.record.check_in)}{d.record.check_out ? ` – ${fmtTime(d.record.check_out)}` : ''}</span>}
                {d.record?.late_minutes > 0 && <span className="late">Late {d.record.late_minutes}m{d.late_penalty ? ' · ½ day' : ''}</span>}
                {d.record?.early_minutes > 0 && d.record.check_out && <span className="late">Left {d.record.early_minutes}m early</span>}
                {d.record?.source === 'qr' && <span className="src">QR</span>}
                {d.record?.source === 'device' && <span className="src">Machine</span>}
                {(d.record?.in_photo || d.record?.out_photo) && <button className="icon-btn reg" style={{ width: 26, height: 26, borderRadius: 8, right: 30 }} aria-label={`Photos for ${d.date}`} onClick={() => setPhoto(d.record.id)}><Icon name="eye" size={13} /></button>}
                <span className="tag">{label}</span>
                {canReg && <button className="icon-btn reg" style={{ width: 26, height: 26, borderRadius: 8 }} aria-label={`Regularize ${d.date}`} onClick={() => setReg(d.date)}><Icon name="edit" size={13} /></button>}
              </div>
            )
          })}
        </div>
        <div className="cal-legend">
          {[['var(--green-soft)', 'Present'], ['var(--amber-soft)', 'Half day'], ['var(--red-soft)', 'Absent'], ['var(--violet-soft)', 'Leave'], ['var(--blue-soft)', 'Holiday']].map(([c, l]) => <span key={l}><i style={{ background: c, border: '1px solid var(--line)' }} />{l}</span>)}
        </div>
      </Card>
      {reg && <RegularizeModal date={reg} onClose={() => setReg(null)} />}
      {photo && <PhotoModal id={photo} onClose={() => setPhoto(null)} />}
    </>
  )
}

function TeamToday() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const { data, isLoading } = useQuery({ queryKey: ['att-team', date], queryFn: () => api(`/attendance/team?date=${date}`) })
  return (
    <>
      <div className="toolbar"><input className="input" style={{ width: 'auto' }} type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => e.target.value && setDate(e.target.value)} /></div>
      <Card pad={false}>
        {isLoading ? <Loading /> : !data.rows.length ? <Empty icon="users" title="No team members" /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Employee</th><th>Department</th><th>Status</th><th>In</th><th>Out</th><th>Late</th></tr></thead>
            <tbody>{data.rows.map((r) => (
              <tr key={r.id}>
                <td><div className="who"><Avatar name={r.name} size={32} /><div><b>{r.name}</b><small>{r.emp_code}</small></div></div></td>
                <td>{r.department || '—'}</td>
                <td><Badge status={r.status}>{r.leave || LABEL[r.status] || r.status}</Badge></td>
                <td>{fmtTime(r.check_in)}</td><td>{fmtTime(r.check_out)}</td><td>{r.late_minutes ? `${r.late_minutes} min` : '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </>
  )
}

function useMyRegs() {
  return useQuery({ queryKey: ['regs', 'mine'], queryFn: () => api('/attendance/regularizations?scope=mine') })
}

function MyRegularizations({ pending }) {
  const { data: all = [], isLoading } = useMyRegs()
  const data = all.filter((r) => (r.status === 'pending') === pending)
  return (
    <Card pad={false}>
      {isLoading ? <Loading /> : !data.length ? <Empty icon="clock" title={pending ? 'No pending requests' : 'No decided requests yet'} hint={pending ? 'Requests waiting for approval show up here.' : 'Use the edit icon on a past day in your calendar.'} /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Date</th><th>Requested</th><th>Reason</th><th>Status</th><th>Note</th></tr></thead>
          <tbody>{data.map((r) => (
            <tr key={r.id}><td className="nowrap">{fmtDate(r.date)}</td><td>{r.requested_in} – {r.requested_out}</td><td>{r.reason}</td><td><Badge status={r.status}>{r.status}</Badge></td><td>{r.decision_note || '—'}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  )
}

export default function Attendance() {
  const { can } = useAuth()
  const { t } = useI18n()
  const [tab, setTab] = useState('mine')
  const { data: myRegs = [] } = useMyRegs()
  const { data: rules } = useQuery({ queryKey: ['att-settings'], queryFn: () => api('/attendance/settings'), staleTime: 60000 })
  const pendingCount = myRegs.filter((r) => r.status === 'pending').length
  const tabs = [{ id: 'mine', label: t('Calendar') }, ...(can('attendance.view_team', 'attendance.view_all') ? [{ id: 'team', label: t('Team today') }] : []), { id: 'pending', label: pendingCount ? `${t('Pending')} (${pendingCount})` : t('Pending') }, { id: 'regs', label: t('My requests') }]
  return (
    <>
      <PageHeader title={t('Attendance')} subtitle={t('Your check-ins, late marks and regularization requests')}>{can('attendance.manage') && rules?.qr_mode && rules.qr_mode !== 'off' && <Link to="/attendance/qr" className="btn light">{t('Office QR code')}</Link>}</PageHeader>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'mine' && <MyCalendar />}
      {tab === 'team' && <TeamToday />}
      {tab === 'pending' && <MyRegularizations pending />}
      {tab === 'regs' && <MyRegularizations pending={false} />}
    </>
  )
}
