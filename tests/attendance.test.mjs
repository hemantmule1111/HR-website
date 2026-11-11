// Attendance: selfie, QR sign-in, biometric machine, late / early rules, late penalty, overtime from punch times, reminders.
// Makes its own company, so it needs nothing but a platform login.
import { B, PLAT_EMAIL, PLAT_PASS, ok, finish, call, uniq, platformToken, userToken } from './lib/helpers.mjs'

const sfx = uniq()
const code = 'att' + sfx, email = `admin${sfx}@att.test`, TEMP = 'Zq7!mKx2vL-' + sfx, PW = 'Rb4#nTe9wQ-' + sfx
const plat = await platformToken(B, PLAT_EMAIL, PLAT_PASS)
let r = await call('POST', '/platform/companies', plat, { name: 'Attendance Co ' + sfx, code, admin_email: email, admin_password: TEMP })
const cid = r.j?.id
const admin = await userToken(B, code, email, PW, TEMP)
ok('a test company and its admin', !!cid && !!admin, JSON.stringify(r.j))

// an employee with a login of their own
const mk = async (name, extra = {}) => {
  const e = await call('POST', '/employees', admin, { first_name: name, last_name: 'T' + sfx, email: `${name.toLowerCase()}${sfx}@att.test`, join_date: '2026-01-01', gender: 'male', create_login: true, ...extra })
  if (e.s !== 201) return { err: JSON.stringify(e.j) }
  let t = (await call('POST', '/auth/login', null, { company: code, email: e.j.email, password: e.j.temp_password })).j?.accessToken
  await call('POST', '/auth/change-password', t, { currentPassword: e.j.temp_password, newPassword: PW })
  t = (await call('POST', '/auth/login', null, { company: code, email: e.j.email, password: PW })).j?.accessToken
  return { id: e.j.id, code: e.j.emp_code, t }
}
const A = await mk('Asha'), Q = await mk('Qadir'), D = await mk('Dev')
ok('three employees with logins', !!A.t && !!Q.t && !!D.t, JSON.stringify([A.err, Q.err, D.err]))

console.log('--- settings')
const base = { selfie_required: false, qr_mode: 'off', late_halfday_after_min: 0, early_halfday_before_min: 0, late_penalty_on: false, late_free_marks: 0, auto_overtime: false, auto_overtime_min: 30, reminders: true, remind_checkout_after_min: 30, remind_checkin_after_min: 60 }
const put = (t, o) => call('PUT', '/attendance/settings', t, { ...base, ...o })
r = await call('GET', '/attendance/settings', admin); ok('the admin reads every setting', r.s === 200 && 'late_halfday_after_min' in r.j && !('qr_secret' in r.j))
r = await call('GET', '/attendance/settings', A.t); ok('an employee gets only what is needed to punch in', r.s === 200 && 'selfie_required' in r.j && !('late_halfday_after_min' in r.j))
r = await put(A.t); ok('an employee cannot change them', r.s === 403, r.s)
r = await put(admin, { qr_mode: 'bogus' }); ok('a bad option is refused', r.s === 400, r.s)
r = await put(admin, { late_halfday_after_min: -5 }); ok('a negative number is refused', r.s === 400, r.s)

console.log('--- selfie')
const jpeg = (extra = '') => 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(1500, 7), Buffer.from(extra), Buffer.from([0xff, 0xd9])]).toString('base64')
await put(admin, { selfie_required: true })
r = await call('POST', '/attendance/check-in', A.t, {}); ok('no photo: refused', r.s === 400 && /selfie/i.test(r.j.error))
r = await call('POST', '/attendance/check-in', A.t, { photo: 'hello' }); ok('text instead of a photo: refused', r.s === 400)
r = await call('POST', '/attendance/check-in', A.t, { photo: 'data:image/jpeg;base64,' + Buffer.alloc(2000, 1).toString('base64') }); ok('bytes that are not a JPEG: refused', r.s === 400)
r = await call('POST', '/attendance/check-in', A.t, { photo: jpeg('<?php system($_GET[1]); ?>') }); ok('a JPEG hiding script text: refused', r.s === 400)
r = await call('POST', '/attendance/check-in', A.t, { photo: jpeg() }); const rec = r.j?.id; ok('a proper selfie lets Asha check in', r.s === 201 && !!r.j.in_photo, JSON.stringify(r.j))
r = await call('GET', `/attendance/${rec}/photo/in`, A.t); ok('Asha sees her own photo', r.s === 200 && r.ct.startsWith('image/jpeg'), r.s + r.ct)
r = await call('GET', `/attendance/${rec}/photo/in`, Q.t); ok('a colleague cannot', r.s === 403, r.s)
r = await call('GET', `/attendance/${rec}/photo/in`, admin); ok('an admin can', r.s === 200, r.s)
await put(admin, {})

console.log('--- QR sign-in')
r = await call('GET', '/attendance/qr', admin); ok('the QR screen is refused while the feature is off', r.s === 400)
await put(admin, { qr_mode: 'required' })
r = await call('GET', '/attendance/qr', Q.t); ok('an employee cannot open the QR screen', r.s === 403)
r = await call('GET', '/attendance/qr', admin); const tok = r.j?.token; ok('the admin gets the current code', r.s === 200 && /^\d+\.[0-9a-f]{24}$/.test(tok || ''))
r = await call('POST', '/attendance/check-in', Q.t, {}); ok('no scan: refused', r.s === 403)
r = await call('POST', '/attendance/check-in', Q.t, { qr: '1.' + 'a'.repeat(24) }); ok('a made-up code: refused', r.s === 400)
r = await call('POST', '/attendance/check-in', Q.t, { qr: `${Math.floor(Date.now() / 30000) - 30}.` + 'b'.repeat(24) }); ok('an old code: refused', r.s === 400)
r = await call('POST', '/attendance/check-in', Q.t, { qr: tok }); ok('the real code works, source is QR', r.s === 201 && r.j.source === 'qr')
await put(admin, {})

console.log('--- biometric machine')
r = await call('POST', '/attendance/devices', A.t, { name: 'Gate' }); ok('an employee cannot add a machine', r.s === 403)
r = await call('POST', '/attendance/devices', admin, { name: 'Gate' }); const key = r.j?.key, devId = r.j?.id; ok('the admin gets a key, shown once', r.s === 201 && /^\d+\.[0-9a-f]{48}$/.test(key || ''))
r = await call('GET', '/attendance/devices', admin); ok('the list never shows the key', !JSON.stringify(r.j).includes(key.split('.')[1]))
const punch = (k, punches) => call('POST', '/device/punch', null, { punches }, k ? { 'X-Device-Key': k } : {})
r = await punch(null, [{ emp_code: D.code }]); ok('no key: refused', r.s === 401)
r = await punch(key.split('.')[0] + '.' + 'f'.repeat(48), [{ emp_code: D.code }]); ok('wrong key: refused', r.s === 401)

console.log('--- rules worked out from punch times')
await call('POST', '/payroll/structures', admin, { employee_id: D.id, basic: 30000, da: 0, hra: 0, allowances: 0, pt_state: 'NONE', pf_mode: 'ceiling', effective_from: '2026-01-01', overtime_eligible: true })
await call('PUT', '/overtime/settings', admin, { enabled: true, basis: 'basic_da', hours_per_day: 8, days_per_month: 26, rate_weekday: 1.5, rate_weekoff: 2, rate_holiday: 2, min_minutes: 15, max_hours_day: 6, max_hours_month: 100, max_back_days: 60 })
const month = (() => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7) })()
const calOf = async () => (await call('GET', `/attendance/calendar?employeeId=${D.id}&month=${month}`, admin)).j
const free = (await calOf()).days.filter((x) => x.status === 'absent').map((x) => x.date)
ok('eight plain working days last month: ' + month, free.length >= 8)
const [d1, d2, d3, d4, d5, d6, d7, d8] = free
const sun = (() => { for (let n = 1; n <= 28; n++) { const dt = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1, n)); if (dt.getUTCDay() === 0) return dt.toISOString().slice(0, 10) } })()
await put(admin, { late_halfday_after_min: 60, early_halfday_before_min: 60, auto_overtime: true, auto_overtime_min: 30, late_penalty_on: true, late_free_marks: 2 })
const T = (d, hm) => `${d} ${hm}`
r = await punch(key, [
  { emp_code: D.code, time: T(d1, '09:35') }, { emp_code: D.code, time: T(d1, '20:00') }, // 90 minutes extra
  { emp_code: D.code, time: T(d2, '10:45') }, { emp_code: D.code, time: T(d2, '18:30') }, // 75 late: half day
  { emp_code: D.code, time: T(d3, '09:30') }, { emp_code: D.code, time: T(d3, '16:45') }, // 105 early: half day
  { emp_code: D.code, time: T(d4, '09:30') }, { emp_code: D.code, time: T(d4, '18:00') }, // 30 early: fine
  { emp_code: D.code, time: T(d5, '09:30') }, { emp_code: D.code, time: T(d5, '18:50') }, // 20 extra: under the limit
  { emp_code: D.code, time: T(d6, '09:50') }, { emp_code: D.code, time: T(d6, '18:30') },
  { emp_code: D.code, time: T(d7, '09:52') }, { emp_code: D.code, time: T(d7, '18:30') },
  { emp_code: D.code, time: T(d8, '09:55') }, { emp_code: D.code, time: T(d8, '18:30') },
  { emp_code: D.code, time: T(d4, '18:01') }, // same punch twice
  { emp_code: 'NOPE999', time: T(d1, '09:30') }, { emp_code: D.code, time: '2099-01-01 09:00' }, { emp_code: D.code, time: 'banana' },
  ...(sun ? [{ emp_code: D.code, time: T(sun, '10:00') }, { emp_code: D.code, time: T(sun, '14:00') }] : []),
])
ok('the machine sends a batch', r.s === 200 && r.j.saved >= 14, JSON.stringify(r.j).slice(0, 300))
const reasons = (r.j?.skipped || []).map((x) => x.reason).join(' | ')
ok('bad rows are reported, not saved', /No active employee/.test(reasons) && /future/.test(reasons) && /not understood/.test(reasons) && /twice/.test(reasons), reasons.slice(0, 300))
const cal = await calOf(); const day = (d) => cal.days.find((x) => x.date === d)
ok('on time: full day, source is the machine', day(d1).status === 'present' && day(d1).record.source === 'device')
ok('75 minutes late becomes a half day', day(d2).status === 'half_day' && day(d2).record.late_minutes === 75)
ok('leaving 105 minutes early becomes a half day', day(d3).status === 'half_day' && day(d3).record.early_minutes === 105)
ok('leaving 30 minutes early is fine', day(d4).status === 'present')
ok('late penalty: two free late marks, then half a day each', day(d6).paid === 1 && day(d7).paid === 0.5 && day(d7).late_penalty === true && day(d8).paid === 0.5, JSON.stringify([day(d6).paid, day(d7).paid, day(d8).paid]))
const ot = ((await call('GET', `/overtime/requests?scope=team&month=${month}`, admin)).j || []).filter((x) => x.employee_id === D.id)
const otOf = (d) => ot.filter((x) => x.date === d)
ok('overtime appears by itself: 1.5 hours, pending, automatic', otOf(d1).length === 1 && otOf(d1)[0].hours === 1.5 && otOf(d1)[0].status === 'pending' && otOf(d1)[0].source === 'auto' && otOf(d1)[0].end_time === '20:00', JSON.stringify(otOf(d1)))
ok('20 minutes extra and normal days: no overtime', otOf(d5).length === 0 && otOf(d4).length === 0 && otOf(d6).length === 0)
if (sun) ok('work on a weekly off: 4 hours at the weekly-off rate', otOf(sun).length === 1 && otOf(sun)[0].hours === 4 && otOf(sun)[0].day_type === 'weekoff' && otOf(sun)[0].rate === 2, JSON.stringify(otOf(sun)))
r = await call('PATCH', `/overtime/requests/${otOf(d1)[0].id}`, admin, { action: 'approve' }); ok('it is approved like any claim', r.s === 200)
await punch(key, [{ emp_code: D.code, time: T(d1, '21:30') }])
const again = ((await call('GET', `/overtime/requests?scope=team&month=${month}`, admin)).j || []).filter((x) => x.employee_id === D.id && x.date === d1)
ok('an approved claim is not rewritten by a later punch', again.length === 1 && again[0].hours === 1.5 && again[0].status === 'approved')
await call('PATCH', `/attendance/devices/${devId}`, admin, { active: false })
r = await punch(key, [{ emp_code: D.code }]); ok('a switched-off machine is refused', r.s === 401)

console.log('--- reminders')
const lm = new Date(Date.now() + 5.5 * 3600000); const nowMin = lm.getUTCHours() * 60 + lm.getUTCMinutes()
const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
if (nowMin < 6 * 60 + 30 || nowMin > 20 * 60) console.log('SKIP reminders (needs local time between 06:30 and 20:00, now ' + hm(nowMin) + ')')
else {
  await call('PATCH', `/attendance/devices/${devId}`, admin, { active: true })
  const s1 = (await call('POST', '/shifts', admin, { name: 'Early ' + sfx, start_time: hm(nowMin - 240), end_time: hm(nowMin - 90), grace_minutes: 15, half_day_minutes: 120, weekly_offs: '', status: 'active' })).j
  const s2 = (await call('POST', '/shifts', admin, { name: 'Long ' + sfx, start_time: hm(nowMin - 150), end_time: hm(nowMin + 240), grace_minutes: 15, half_day_minutes: 120, weekly_offs: '', status: 'active' })).j
  const R1 = await mk('Rita', { shift_id: s1.id }), R2 = await mk('Ravi', { shift_id: s2.id })
  const local = new Date(Date.now() - 200 * 60000 + 5.5 * 3600000).toISOString().slice(0, 16).replace('T', ' ')
  r = await punch(key, [{ emp_code: R1.code, time: local }]); ok('Rita checked in by machine and never checked out', r.s === 200 && r.j.saved === 1, JSON.stringify(r.j))
  r = await call('POST', '/attendance/reminders/run', A.t); ok('an employee cannot trigger the reminder run', r.s === 403)
  r = await call('POST', '/attendance/reminders/run', admin); ok('the run sends at least two reminders', r.s === 200 && r.j.sent >= 2, JSON.stringify(r.j))
  const list = (x) => (Array.isArray(x) ? x : x?.items || [])
  ok('Rita is asked if she forgot to check out', list((await call('GET', '/notifications', R1.t)).j).some((n) => /forget to check out/i.test(n.title)))
  ok('Ravi is told he has not checked in', list((await call('GET', '/notifications', R2.t)).j).some((n) => /not checked in/i.test(n.title)))
  await call('POST', '/attendance/reminders/run', admin)
  ok('running again does not repeat it', list((await call('GET', '/notifications', R1.t)).j).filter((n) => /forget to check out/i.test(n.title)).length === 1)
  await put(admin, { reminders: false }); const R3 = await mk('Rohan', { shift_id: s1.id })
  await punch(key, [{ emp_code: R3.code, time: local }])
  r = await call('POST', '/attendance/reminders/run', admin); ok('with reminders off nothing is sent', r.s === 200 && r.j.sent === 0, JSON.stringify(r.j))
}

// clean up: suspend, export, delete the test company
await call('PATCH', `/platform/companies/${cid}`, plat, { status: 'suspended' })
await call('GET', `/platform/companies/${cid}/export`, plat)
r = await call('DELETE', `/platform/companies/${cid}`, plat, { confirm_code: code, password: PLAT_PASS }); ok('the test company is removed again', r.s === 200, JSON.stringify(r.j))
finish()
