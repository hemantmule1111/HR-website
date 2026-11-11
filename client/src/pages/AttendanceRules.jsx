import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { api } from '../api'
import { Badge, Button, Card, Confirm, Field, Loading, Modal, PageHeader, useToast } from '../ui/components'

const Check = ({ label, hint, checked, onChange }) => (
  <div className="span-2" style={{ gridColumn: 'span 2' }}>
    <label className="check"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{label}</label>
    {hint && <small className="muted" style={{ display: 'block', marginLeft: '1.7rem' }}>{hint}</small>}
  </div>
)

// ---------------- Master sheet: attendance rules (admin) ----------------
export function AttendanceRules() {
  const toast = useToast()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['att-settings'], queryFn: () => api('/attendance/settings') })
  const [f, setF] = useState(null)
  const cur = f || data
  const save = useMutation({
    mutationFn: () => api('/attendance/settings', { method: 'PUT', body: Object.fromEntries(Object.entries(cur).map(([k, v]) => [k, typeof v === 'boolean' || k === 'qr_mode' ? v : Number(v)])) }),
    onSuccess: () => { toast('Attendance rules saved'); setF(null); qc.invalidateQueries({ queryKey: ['att-settings'] }) }, onError: (e) => toast(e.message, 'error'),
  })
  if (!cur) return <Card title="Attendance rules"><Loading /></Card>
  const set = (k) => (v) => setF({ ...cur, [k]: v })
  const num = (k) => ({ className: 'input', type: 'number', min: 0, max: 480, value: cur[k], onChange: (e) => setF({ ...cur, [k]: e.target.value }) })
  return (
    <Card title="Attendance rules" action={cur.qr_mode !== 'off' && data?.qr_mode !== 'off' ? <Link to="/attendance/qr" className="btn light sm">Open the QR screen</Link> : null}>
      <form className="form-grid" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
        <Check label="Ask for a selfie when checking in" hint="The photo is saved with the punch for HR to look at. It does not match faces, it only makes it harder to punch for someone else." checked={cur.selfie_required} onChange={set('selfie_required')} />
        <Field label="QR sign-in" hint="A code on a screen at the office, changing every 30 seconds. Employees scan it with their phone." span={2}>
          <select className="select" value={cur.qr_mode} onChange={(e) => setF({ ...cur, qr_mode: e.target.value })}>
            <option value="off">Off</option>
            <option value="optional">Optional: scanning is allowed but not needed</option>
            <option value="required">Required: check in and out only after scanning at the office</option>
          </select>
        </Field>
        <Field label="Late arrival becomes a half day after (minutes)" hint="Minutes after the shift start. 0 = never."><input {...num('late_halfday_after_min')} /></Field>
        <Field label="Leaving early becomes a half day before (minutes)" hint="Minutes before the shift end. 0 = never."><input {...num('early_halfday_before_min')} /></Field>
        <Check label="Charge half a day for late arrivals beyond a monthly allowance" hint="Late marks follow the grace time on each person's shift." checked={cur.late_penalty_on} onChange={set('late_penalty_on')} />
        {cur.late_penalty_on && <Field label="Late arrivals allowed each month before it costs half a day"><input {...num('late_free_marks')} max={31} /></Field>}
        <Check label="Work out overtime from the punch times" hint="Work beyond the shift end (or any work on a weekly off or holiday) becomes an overtime claim that the manager approves. Needs Overtime switched on, and people who made their own claim for the day are left alone." checked={cur.auto_overtime} onChange={set('auto_overtime')} />
        {cur.auto_overtime && <Field label="Ignore extra work shorter than (minutes)"><input {...num('auto_overtime_min')} /></Field>}
        <Check label="Send reminders" hint="'You forgot to check out' and 'you have not checked in'. They appear in the bell and are emailed." checked={cur.reminders} onChange={set('reminders')} />
        {cur.reminders && <>
          <Field label="Remind about check-out after the shift ends by (minutes)"><input {...num('remind_checkout_after_min')} /></Field>
          <Field label="Remind about check-in after the shift starts by (minutes)" hint="0 = do not remind about check-in"><input {...num('remind_checkin_after_min')} /></Field>
        </>}
        {save.error && <p className="form-error span-2" style={{ gridColumn: 'span 2' }}>{save.error.message}</p>}
        <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button variant="ghost" type="button" disabled={!f} onClick={() => setF(null)}>Reset</Button><Button busy={save.isPending} disabled={!f}>Save</Button></div>
      </form>
    </Card>
  )
}

// ---------------- Master sheet: biometric machines and other punch sources (admin) ----------------
export function PunchDevices() {
  const toast = useToast()
  const qc = useQueryClient()
  const { data = [], isLoading } = useQuery({ queryKey: ['att-devices'], queryFn: () => api('/attendance/devices') })
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [made, setMade] = useState(null)
  const [del, setDel] = useState(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['att-devices'] })
  const add = useMutation({ mutationFn: () => api('/attendance/devices', { method: 'POST', body: { name } }), onSuccess: (d) => { setAdding(false); setName(''); setMade(d); refresh() } })
  const toggle = useMutation({ mutationFn: (d) => api(`/attendance/devices/${d.id}`, { method: 'PATCH', body: { active: !d.active } }), onSuccess: refresh, onError: (e) => toast(e.message, 'error') })
  const rm = useMutation({ mutationFn: (id) => api(`/attendance/devices/${id}`, { method: 'DELETE' }), onSuccess: () => { toast('Device removed'); refresh() }, onError: (e) => toast(e.message, 'error') })
  const url = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/v1/device/punch`
  return (
    <Card title="Biometric machines" action={<Button icon="plus" variant="light" className="sm" onClick={() => setAdding(true)}>Add a machine</Button>}>
      <p className="muted" style={{ marginBottom: '.8rem' }}>A fingerprint, face or card machine (or the software that comes with it) can send its punches here. Each machine gets its own secret key. The first punch of a day is the check-in, the last is the check-out. The person is found by their <b>employee code</b>, so enter the same code in the machine.</p>
      {isLoading ? <Loading /> : !data.length ? <p className="muted">No machine yet.</p> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Machine</th><th>Last heard from</th><th>Status</th><th /></tr></thead>
          <tbody>{data.map((d) => <tr key={d.id}><td><b>{d.name}</b></td><td>{d.last_seen ? new Date(String(d.last_seen).replace(' ', 'T') + 'Z').toLocaleString() : 'Never'}</td><td><Badge tone={d.active ? 'green' : 'gray'}>{d.active ? 'On' : 'Switched off'}</Badge></td><td><div className="row-actions"><Button variant="ghost" className="sm" onClick={() => toggle.mutate(d)}>{d.active ? 'Switch off' : 'Switch on'}</Button><Button variant="ghost" className="sm" icon="trash" onClick={() => setDel(d)}>Remove</Button></div></td></tr>)}</tbody>
        </table></div>
      )}
      <details style={{ marginTop: '.8rem' }}>
        <summary><b>How the machine sends punches</b></summary>
        <p className="muted" style={{ margin: '.5rem 0' }}>The machine's software (or a small script on a PC in the office) sends an HTTPS POST to this address with the key in the header <code>X-Device-Key</code>. Time is optional and, if given, is the office's local time (or an ISO time with its zone).</p>
        <pre className="code-box">{`POST ${url}
X-Device-Key: <the key shown when you add the machine>
Content-Type: application/json

{ "punches": [ { "emp_code": "EMP0007", "time": "2026-11-10 09:41:12" } ] }`}</pre>
        <p className="muted">Up to 500 punches in one call, up to 62 days old. A punch sent twice is ignored. The answer lists anything it could not use.</p>
      </details>
      {adding && (
        <Modal title="Add a machine" onClose={() => setAdding(false)}>
          <form className="form-grid" onSubmit={(e) => { e.preventDefault(); add.mutate() }}>
            <Field label="Name" span={2}><input className="input" required minLength={2} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="Main gate fingerprint machine" autoFocus /></Field>
            {add.error && <p className="form-error span-2" style={{ gridColumn: 'span 2' }}>{add.error.message}</p>}
            <div className="form-actions span-2" style={{ gridColumn: 'span 2' }}><Button variant="ghost" type="button" onClick={() => setAdding(false)}>Cancel</Button><Button busy={add.isPending}>Create key</Button></div>
          </form>
        </Modal>
      )}
      {made && (
        <Modal title={`Key for ${made.name}`} onClose={() => setMade(null)}>
          <p>Copy this key into the machine's software now. <b>It is shown only once</b>; if it is lost, remove the machine and add it again.</p>
          <pre className="code-box" style={{ userSelect: 'all', wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>{made.key}</pre>
          <div className="form-actions"><Button variant="light" onClick={() => navigator.clipboard?.writeText(made.key).then(() => toast('Key copied'))}>Copy</Button><Button onClick={() => setMade(null)}>Done</Button></div>
        </Modal>
      )}
      {del && <Confirm danger title="Remove this machine?" message={`${del.name} will no longer be able to send punches.`} confirmLabel="Remove" onConfirm={() => rm.mutate(del.id)} onClose={() => setDel(null)} />}
    </Card>
  )
}

// ---------------- the screen shown at the office ----------------
export function QrScreen() {
  const [img, setImg] = useState('')
  const [left, setLeft] = useState(30)
  const { data, error, refetch } = useQuery({ queryKey: ['att-qr'], queryFn: () => api('/attendance/qr'), refetchInterval: 20000, staleTime: 0, gcTime: 0 })
  useEffect(() => {
    if (!data?.token) return
    const link = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/?qr=${encodeURIComponent(data.token)}`
    QRCode.toDataURL(link, { width: 420, margin: 2 }).then(setImg).catch(() => setImg(''))
    setLeft(30)
  }, [data])
  useEffect(() => { const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000); return () => clearInterval(t) }, [])
  return (
    <>
      <PageHeader title="Office QR code" subtitle="Show this on a screen at the entrance. Employees scan it with their phone to check in or out." />
      <Card>
        <div className="qr-screen">
          {error ? <p className="form-error">{error.message}</p> : img ? <img src={img} alt="QR code to check in" width="360" height="360" /> : <Loading />}
          <p className="muted">The code changes every 30 seconds, so a photo of it will not work later.</p>
          <Button variant="light" icon="sparkle" onClick={() => refetch()}>New code ({left}s)</Button>
        </div>
      </Card>
    </>
  )
}

