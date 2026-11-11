import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useAuth } from '../auth'
import Icon from '../ui/Icon'
import { AreaChart, BarChart, Donut, HBars, Ring } from '../ui/charts'
import { Badge, Button, Card, Empty, Loading, Stat, useToast } from '../ui/components'
import { fmtDate, fmtTime } from '../ui/format'
import { getPosition } from '../ui/geo'
import Selfie from '../ui/Selfie'
import { useI18n } from '../i18n'
import { getQr, clearQr } from '../ui/punch'

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

function Punch({ me }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const toast = useToast()
  const [now, setNow] = useState(new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  const { data: geo } = useQuery({ queryKey: ['geo-public'], queryFn: () => api('/attendance/geo'), staleTime: 60000 })
  const { data: rules } = useQuery({ queryKey: ['att-settings'], queryFn: () => api('/attendance/settings'), staleTime: 60000 })
  const [asking, setAsking] = useState(null) // 'check-in' | 'check-out' while the selfie window is open
  const qr = getQr()
  const needQr = rules?.qr_mode === 'required' && !qr
  const act = useMutation({
    // The location (when the admin switched the check on), a selfie and the scanned office code travel with the punch.
    mutationFn: async ({ kind, photo }) => api(`/attendance/${kind}`, {
      method: 'POST',
      body: { ...(geo?.enabled ? await getPosition() : {}), ...(photo ? { photo } : {}), ...(qr ? { qr } : {}) },
    }),
    onSuccess: (_d, { kind }) => { clearQr(); toast(kind === 'check-in' ? t('Checked in. Have a great day!') : t('Checked out. See you tomorrow!')); qc.invalidateQueries({ queryKey: ['dashboard'] }); qc.invalidateQueries({ queryKey: ['att-cal'] }) },
    onError: (e) => toast(e.message, 'error'),
  })
  const { day } = me
  const nonWorking = ['holiday', 'weekoff', 'leave', 'na'].includes(day.status)
  return (
    <div className="hero">
      <div>
        <h1>{t(greeting())}, {me.name.split(' ')[0]}!</h1>
        <p>{now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}{day.holiday ? ` · ${day.holiday}` : ''}</p>
      </div>
      <div className="punch">
        <div>
          <div className="clock">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          <small>{day.check_in ? `In ${fmtTime(day.check_in)}${day.check_out ? ` · Out ${fmtTime(day.check_out)}` : ' · working'}` : nonWorking ? `Today is a ${day.status === 'weekoff' ? 'weekly off' : day.status}` : t('You have not checked in yet')}</small>
        </div>
        {!day.check_in && <Button variant="light" icon="login" busy={act.isPending} disabled={needQr} onClick={() => (rules?.selfie_required ? setAsking('check-in') : act.mutate({ kind: 'check-in' }))}>{t('Check in')}</Button>}
        {day.check_in && !day.check_out && <Button variant="glass" icon="logout" busy={act.isPending} disabled={needQr} onClick={() => (rules?.selfie_required ? setAsking('check-out') : act.mutate({ kind: 'check-out' }))}>{t('Check out')}</Button>}
        {day.check_out && <Badge tone="green">{t('Day complete')}</Badge>}
        {needQr && !day.check_out && <small className="punch-geo"><Icon name="pin" size={13} /> {t('Scan the QR code on the office screen with your phone to check in or out')}</small>}
        {qr && rules?.qr_mode !== 'off' && !day.check_out && <small className="punch-geo"><Icon name="checkcircle" size={13} /> {t('Office code scanned')}</small>}
        {geo?.enabled && !day.check_out && <small className="punch-geo" title="Your location is checked when you check in and out"><Icon name="pin" size={13} /> {act.isPending ? 'Finding your location…' : t('Location is checked')}</small>}
      </div>
      {asking && <Selfie title={asking === 'check-in' ? t('Selfie to check in') : t('Selfie to check out')} optional={asking === 'check-out'} confirmLabel={asking === 'check-in' ? t('Check in') : t('Check out')} onClose={() => setAsking(null)} onDone={(photo) => { const kind = asking; setAsking(null); act.mutate({ kind, photo }) }} />}
    </div>
  )
}

export default function Dashboard() {
  const { user, can } = useAuth()
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => api('/dashboard/summary') })
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById('crumb-center')) }, [])
  if (isLoading) return <Loading />
  const { me, company, approvals } = data

  return (
    <>
      {me ? <Punch me={me} /> : slot && createPortal(
        <div className="crumb-greet"><b>{greeting()}!</b><span className="crumb-text">Signed in as {user.email} ·</span><span className="bdge bdge-success">{user.role}</span></div>,
        slot,
      )}

      {approvals.total > 0 && (
        <Link to="/approvals" className="card mt" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem 1.35rem', marginBottom: '1.25rem' }}>
          <span className="stat-icon amber"><Icon name="checkcircle" /></span>
          <div style={{ flex: 1, color: 'var(--text)' }}><b>{approvals.total} request{approvals.total > 1 ? 's' : ''} waiting for your approval</b><br /><small className="muted">{approvals.leave} leave · {approvals.regularization} attendance · {approvals.overtime || 0} overtime</small></div>
          <Icon name="right" />
        </Link>
      )}

      {company && (
        <div className="grid g4" style={{ marginBottom: '1.25rem' }}>
          <Stat icon="users" label="Total employees" value={company.total} hint={`${company.new_joiners} joined in 30 days`} />
          <Stat icon="check" tone="green" label="Present today" value={company.present} hint={`${company.total ? Math.round((company.present / company.total) * 100) : 0}% of workforce`} />
          <Stat icon="calendar" tone="pink" label="On leave" value={company.on_leave} hint="Approved leave today" />
          <Stat icon="briefcase" tone="cyan" label="On probation" value={company.probation} hint="Confirmation due" />
        </div>
      )}

      <div className="grid g-main">
        <div className="grid" style={{ alignContent: 'start' }}>
          {company && (
            <Card title="Attendance — last 14 days"><AreaChart data={company.attendance_trend.map((d) => ({ label: fmtDate(d.date, false), value: d.present }))} /></Card>
          )}
          {company && (
            <div className="grid g2">
              <Card title="Headcount by department"><Donut data={company.departments} center={<div className="donut-center"><strong>{company.total}</strong><small>people</small></div>} /></Card>
              <Card title="Joiners vs exits"><BarChart data={company.trend.map((t) => ({ ...t, label: t.month.slice(5) }))} series={[{ key: 'joined', label: 'Joined', color: '#6366f1' }, { key: 'exited', label: 'Exited', color: '#f43f5e' }]} /></Card>
            </div>
          )}
          {company && company.leave_by_type.length > 0 && (
            <Card title="Leave taken this year"><HBars data={company.leave_by_type.map((l) => ({ name: l.name, value: l.used, color: l.color }))} /></Card>
          )}
          {me && !company && (
            <Card title="Quick actions">
              <div className="grid g3">
                {[['/leave', 'calendar', 'Apply for leave', 'Request time off'], ['/attendance', 'clock', 'My attendance', 'Calendar & corrections'], ['/payslips', 'wallet', 'My payslips', 'Download salary slips']].map(([to, icon, t, s]) => (
                  <Link key={to} to={to} className="mini" style={{ display: 'flex', gap: '.8rem', alignItems: 'center', color: 'var(--text)' }}>
                    <span className="stat-icon indigo" style={{ width: 40, height: 40, borderRadius: 12 }}><Icon name={icon} size={18} /></span>
                    <span><b style={{ fontSize: '.9rem' }}>{t}</b><small>{s}</small></span>
                  </Link>
                ))}
              </div>
            </Card>
          )}
          {me && (
            <Card title="My leave balance" action={<Link to="/leave" className="btn sm soft">Apply</Link>}>
              <div className="balances">
                {me.balances.filter((b) => !b.unlimited).map((b) => (
                  <div className="balance" key={b.code}>
                    <Ring value={b.available} max={b.total || 1} color={b.color}>{b.available}<small>of {b.total}</small></Ring>
                    <b>{b.name}</b>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="grid" style={{ alignContent: 'start' }}>
          <Card title="Announcements" action={can('announcement.manage') && <Link to="/announcements" className="btn sm ghost">Manage</Link>}>
            {data.announcements.length === 0 ? <Empty icon="megaphone" title="No announcements" /> : data.announcements.map((a) => (
              <div key={a.id} className={`ann ${a.pinned ? 'pinned' : ''}`}><b>{!!a.pinned && <Icon name="pin" size={14} />}{a.title}</b><p>{a.body}</p></div>
            ))}
          </Card>
          <Card title="Upcoming holidays">
            {data.upcoming_holidays.length === 0 ? <Empty icon="calendar" title="No upcoming holidays" /> : (
              <div className="list">
                {data.upcoming_holidays.map((h) => (
                  <div className="list-item" key={h.id}>
                    <div className="date-chip"><small>{fmtDate(h.date).split(' ')[1]}</small><span>{String(h.date).slice(8, 10)}</span></div>
                    <div className="grow"><b>{h.name}</b><small>{new Date(`${String(h.date).slice(0, 10)}T00:00:00`).toLocaleDateString([], { weekday: 'long' })}</small></div>
                    {h.is_optional ? <Badge tone="gray">Optional</Badge> : null}
                  </div>
                ))}
              </div>
            )}
          </Card>
          {company && (
            <Card title="Birthdays & anniversaries">
              {company.events.length === 0 ? <Empty icon="gift" title="Nothing in the next 30 days" /> : (
                <div className="list">
                  {company.events.map((e, i) => (
                    <div className="list-item" key={i}>
                      <span className="event-icon" style={{ background: e.type === 'birthday' ? 'linear-gradient(135deg,#ec4899,#f472b6)' : 'linear-gradient(135deg,#f59e0b,#fbbf24)' }}><Icon name={e.type === 'birthday' ? 'gift' : 'award'} size={18} /></span>
                      <div className="grow"><b>{e.name}</b><small>{e.type === 'birthday' ? 'Birthday' : `${e.years} year${e.years > 1 ? 's' : ''} with us`}</small></div>
                      <small className="muted nowrap">{fmtDate(e.date, false)}</small>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
          {me && !company && (
            <Card title="Quick stats">
              <div className="list">
                <div className="list-item"><div className="grow"><b>Pending leave requests</b></div><Badge tone="amber">{me.pending_requests}</Badge></div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  )
}
