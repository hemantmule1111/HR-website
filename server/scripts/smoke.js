// End-to-end API smoke test. Start the server (npm run dev) on a database with demo data, then: npm run smoke
const BASE = process.env.API || 'http://localhost:4000/api/v1';
let failed = 0;

async function login(email, password = 'Demo@12345') {
  const res = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, company: process.env.COMPANY || 'default' }) });
  const body = await res.json();
  return { token: body.accessToken, status: res.status };
}
const call = async (token, method, path, body) => {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
};
function check(name, cond, extra = '') {
  if (!cond) failed += 1;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  ${extra}`}`);
}

const hr = (await login('aarav.mehta@demo.com')).token;
const mgr = (await login('priya.nair@demo.com')).token;
const emp = (await login('karan.singh@demo.com')).token;
const pay = (await login('neha.joshi@demo.com')).token;
check('bad password rejected', (await login('karan.singh@demo.com', 'nope')).status === 401);
check('no token rejected', (await call('x', 'GET', '/employees')).status === 401);

// Scoping
const hrList = await call(hr, 'GET', '/employees?limit=100');
const mgrList = await call(mgr, 'GET', '/employees?limit=100');
check('HR sees all employees', hrList.data.total === 14, JSON.stringify(hrList.data).slice(0, 120));
check('manager sees only own team (self + reports)', mgrList.data.total > 1 && mgrList.data.total < 14, `total=${mgrList.data.total}`);
check('employee cannot list employees', (await call(emp, 'GET', '/employees')).status === 403);
check('employee cannot read another profile', (await call(emp, 'GET', '/employees/1')).status === 403);
const me = await call(emp, 'GET', '/employees/me');
check('employee sees own profile incl. sensitive', me.status === 200 && !!me.data.bank_account);
const asMgr = await call(mgr, 'GET', '/employees/1');
check('manager outside tree is blocked', asMgr.status === 403);
const mgrMe = await call(mgr, 'GET', '/employees/me');
const teamMember = mgrList.data.items.find((e) => e.id !== mgrMe.data.id);
check('manager does not see team salary/bank data', teamMember && teamMember.bank_account === undefined);

// Attendance
const today = await call(emp, 'GET', '/attendance/today');
console.log('      today status:', today.data.status);
const cal = await call(emp, 'GET', '/attendance/calendar');
check('attendance calendar', cal.status === 200 && cal.data.days.length >= 28, JSON.stringify(cal.data).slice(0, 100));
if (today.data.status === 'pending') {
  const ci = await call(emp, 'POST', '/attendance/check-in');
  check('check-in', ci.status === 201, JSON.stringify(ci.data));
  check('double check-in blocked', (await call(emp, 'POST', '/attendance/check-in')).status === 400);
  const co = await call(emp, 'POST', '/attendance/check-out');
  check('check-out', co.status === 200, JSON.stringify(co.data));
}
const team = await call(mgr, 'GET', '/attendance/team');
check('manager team attendance', team.status === 200 && team.data.rows.length > 0);

// Regularization: Karan has one pending request; his manager (Rohan) approves, not Priya (not direct but in tree)
const regs = await call(mgr, 'GET', '/attendance/regularizations?scope=team&status=pending');
check('manager sees pending regularization in tree', regs.status === 200 && regs.data.length >= 1, JSON.stringify(regs.data).slice(0, 100));
if (regs.data.length) {
  const own = await call(emp, 'PATCH', `/attendance/regularizations/${regs.data[0].id}`, { action: 'approve' });
  check('employee cannot approve', own.status === 403);
  const ok = await call(mgr, 'PATCH', `/attendance/regularizations/${regs.data[0].id}`, { action: 'approve' });
  check('manager approves regularization', ok.status === 200, JSON.stringify(ok.data));
}

// Leave
const bal = await call(emp, 'GET', '/leave/balances');
check('leave balances', bal.status === 200 && bal.data.length === 4);
const cl = bal.data.find((b) => b.code === 'CL');
const types = await call(emp, 'GET', '/leave-types');
const clId = types.data.find((t) => t.code === 'CL').id;
const nextMonday = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7) + 21); return d.toISOString().slice(0, 10); })();
const ap = await call(emp, 'POST', '/leave/requests', { leave_type_id: clId, from_date: nextMonday, to_date: nextMonday, reason: 'Smoke test' });
check('apply leave', ap.status === 201 && ap.data.days === 1, JSON.stringify(ap.data));
check('overlap blocked', (await call(emp, 'POST', '/leave/requests', { leave_type_id: clId, from_date: nextMonday, to_date: nextMonday, reason: 'Again' })).status === 409);
check('over-balance blocked', (await call(emp, 'POST', '/leave/requests', { leave_type_id: clId, from_date: `${nextMonday.slice(0, 4)}-12-01`, to_date: `${nextMonday.slice(0, 4)}-12-31`, reason: 'Too long' })).status === 400);
check('self-approval blocked', (await call(emp, 'PATCH', `/leave/requests/${ap.data.id}`, { action: 'approve' })).status === 403);
const approved = await call(mgr, 'PATCH', `/leave/requests/${ap.data.id}`, { action: 'approve' });
check('manager approves leave', approved.status === 200, JSON.stringify(approved.data));
const bal2 = await call(emp, 'GET', '/leave/balances');
check('balance deducted', bal2.data.find((b) => b.code === 'CL').available === cl.available - 1);
check('cancel restores balance', (await call(emp, 'PATCH', `/leave/requests/${ap.data.id}`, { action: 'cancel' })).status === 200
  && (await call(emp, 'GET', '/leave/balances')).data.find((b) => b.code === 'CL').available === cl.available);
const notes = await call(emp, 'GET', '/notifications');
check('employee notified of decision', notes.data.unread > 0);

// HR things
check('HR dashboard has company stats', !!(await call(hr, 'GET', '/dashboard/summary')).data.company);
check('employee dashboard has no company stats', !(await call(emp, 'GET', '/dashboard/summary')).data.company);
check('employee cannot create department', (await call(emp, 'POST', '/departments', { name: 'X' })).status === 403);
const newEmp = await call(hr, 'POST', '/employees', { first_name: 'Test', last_name: 'User', email: `test${Date.now()}@demo.com`, join_date: '2026-01-05', create_login: true });
check('HR creates employee with login', newEmp.status === 201 && !!newEmp.data.temp_password, JSON.stringify(newEmp.data).slice(0, 150));
const cyc = await call(hr, 'PATCH', '/employees/1', { manager_id: 2 });
check('reporting cycle blocked', cyc.status === 400, JSON.stringify(cyc.data));
check('HR report csv', (await fetch(`${BASE}/reports/headcount?format=csv`, { headers: { Authorization: `Bearer ${hr}` } })).headers.get('content-type').includes('csv'));
check('attendance report', (await call(hr, 'GET', '/reports/attendance')).data.rows.length === 15);
check('audit log forbidden for HR', (await call(hr, 'GET', '/audit-logs')).status === 403);

// Payroll
check('employee cannot view payroll runs', (await call(emp, 'GET', '/payroll/runs')).status === 403);
const runs = await call(pay, 'GET', '/payroll/runs');
check('payroll admin lists runs', runs.status === 200 && runs.data.length >= 1);
const slips = await call(emp, 'GET', '/payroll/payslips');
check('employee sees own payslip', slips.status === 200 && slips.data.length >= 1);
if (slips.data.length) {
  const slip = await call(emp, 'GET', `/payroll/payslips/${slips.data[0].id}`);
  check('payslip detail', slip.status === 200 && slip.data.net > 0, JSON.stringify(slip.data).slice(0, 100));
  const other = await call(mgr, 'GET', `/payroll/payslips/${slips.data[0].id}`);
  check('others cannot read payslip', other.status === 403);
}

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
