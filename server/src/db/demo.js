// Loads realistic demo data: `npm run demo`. Safe to run on an empty, migrated + seeded database only.
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import db from './index.js';
import { today, addDays, eachDate, dayOfWeek, currentMonth, monthRange } from '../utils/dates.js';
import { evaluate, localToTs } from '../services/attendance.js';
import { compute, saveSlips } from '../controllers/payroll.js';
import { standardBreakup } from '../services/payrollCalc.js';

const PASSWORD = 'Demo@12345';
let seedNum = 42;
const rnd = () => { seedNum = (seedNum * 16807) % 2147483647; return (seedNum - 1) / 2147483646; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

if ((await db('employees').count({ c: '*' }).first()).c > 0) {
  console.log('Employees already exist; demo data not loaded.');
  await db.destroy();
  process.exit(0);
}

const now = today();
const year = Number(now.slice(0, 4));
const roleId = async (name) => (await db('roles').where({ name }).first()).id;

for (const name of ['Engineering', 'Human Resources', 'Sales', 'Marketing', 'Finance', 'Operations']) await db('departments').insert({ name });
for (const [i, title] of ['Intern', 'Associate', 'Senior Associate', 'Team Lead', 'Manager', 'Director'].entries()) await db('designations').insert({ title, level: i + 1 });
await db('shifts').insert({ name: 'General (Mon–Fri)', weekly_offs: '0,6' });
for (const t of [
  { name: 'Casual Leave', code: 'CL', color: '#6366f1', annual_quota: 12, carry_forward_max: 0 },
  { name: 'Sick Leave', code: 'SL', color: '#ef4444', annual_quota: 8, carry_forward_max: 0 },
  { name: 'Earned Leave', code: 'EL', color: '#10b981', annual_quota: 15, carry_forward_max: 10, allow_half_day: false },
  { name: 'Loss of Pay', code: 'LOP', color: '#94a3b8', annual_quota: 0, is_paid: false },
]) await db('leave_types').insert(t);
for (const [md, name] of [['01-01', "New Year's Day"], ['01-26', 'Republic Day'], ['03-14', 'Holi'], ['08-15', 'Independence Day'], ['10-02', 'Gandhi Jayanti'], ['11-08', 'Diwali'], ['12-25', 'Christmas']]) {
  await db('holidays').insert({ date: `${year}-${md}`, name });
}

const dept = Object.fromEntries((await db('departments')).map((d) => [d.name, d.id]));
const desig = Object.fromEntries((await db('designations')).map((d) => [d.title, d.id]));
const shift = await db('shifts').first();

// [first, last, dept, designation, managerIndex, role, years of service, monthsFromNowForBirthday, salary basic]
const people = [
  ['Aarav', 'Mehta', 'Human Resources', 'Director', null, 'HR Admin', 5, 2, 90000],
  ['Priya', 'Nair', 'Engineering', 'Manager', 0, 'Reporting Manager', 4, 5, 85000],
  ['Rohan', 'Verma', 'Engineering', 'Team Lead', 1, 'Employee', 3, 0, 65000],
  ['Sneha', 'Iyer', 'Engineering', 'Senior Associate', 2, 'Employee', 2, 9, 52000],
  ['Karan', 'Singh', 'Engineering', 'Associate', 2, 'Employee', 1, 3, 38000],
  ['Meera', 'Das', 'Sales', 'Manager', 0, 'Reporting Manager', 4, 7, 80000],
  ['Vikram', 'Rao', 'Sales', 'Senior Associate', 5, 'Employee', 2, 1, 48000],
  ['Ananya', 'Gupta', 'Sales', 'Associate', 5, 'Employee', 1, 11, 36000],
  ['Ishaan', 'Kapoor', 'Marketing', 'Manager', 0, 'Reporting Manager', 3, 4, 72000],
  ['Diya', 'Sharma', 'Marketing', 'Associate', 8, 'Employee', 1, 6, 34000],
  ['Neha', 'Joshi', 'Finance', 'Manager', 0, 'Payroll Admin', 6, 8, 88000],
  ['Arjun', 'Patel', 'Finance', 'Associate', 10, 'Employee', 2, 10, 40000],
  ['Tara', 'Menon', 'Operations', 'Associate', 0, 'Employee', 0, 1, 30000],
  ['Kabir', 'Khan', 'Engineering', 'Intern', 2, 'Employee', 0, 2, 18000],
];
const ids = [];
const empRows = [];
for (const [i, p] of people.entries()) {
  const [first, last, d, g, mgr, role, yrs, bm, basic] = p;
  const join = yrs === 0 ? addDays(now, -(10 + i * 3)) : addDays(now, -(yrs * 365 + 40 + i * 17));
  const dob = new Date(`${year - 28 - (i % 9)}-01-01T00:00:00Z`);
  dob.setUTCMonth(Number(now.slice(5, 7)) - 1 + (bm % 2 === 0 ? 0 : 0));
  dob.setUTCDate(Math.min(28, Number(now.slice(8, 10)) + bm * 2));
  const [id] = await db('employees').insert({
    emp_code: `EMP${String(i + 1).padStart(4, '0')}`, first_name: first, last_name: last,
    email: `${first.toLowerCase()}.${last.toLowerCase()}@demo.com`, phone: `98${String(10000000 + i * 137).slice(0, 8)}`,
    dob: dob.toISOString().slice(0, 10), gender: ['Priya', 'Sneha', 'Meera', 'Ananya', 'Diya', 'Neha', 'Tara'].includes(first) ? 'female' : 'male',
    department_id: dept[d], designation_id: desig[g], manager_id: mgr === null ? null : ids[mgr], shift_id: shift.id,
    join_date: join, employment_type: g === 'Intern' ? 'intern' : 'full_time', work_location: i % 3 === 0 ? 'Mumbai HQ' : 'Bengaluru',
    status: yrs === 0 ? 'probation' : 'active', probation_end: yrs === 0 ? addDays(now, 60) : null,
    bank_name: 'HDFC Bank', bank_account: String(5010000000 + i * 913), ifsc: 'HDFC0000123', pan: `ABCDE${1000 + i}F`,
  });
  ids.push(id);
  empRows.push({ id, join, first, role, basic });
  await db('employment_history').insert({ employee_id: id, event: 'joining', effective_date: join, approved_by: 1 });
  await db('users').insert({
    employee_id: id, email: `${first.toLowerCase()}.${last.toLowerCase()}@demo.com`,
    password_hash: await bcrypt.hash(PASSWORD, 10), role_id: await roleId(role),
  });
  await db('salary_structures').insert({
    employee_id: id, ...standardBreakup(basic * 1.6), effective_from: join, note: 'Initial structure',
  });
}
await db('departments').where({ id: dept['Human Resources'] }).update({ head_employee_id: ids[0] });
await db('employment_history').insert({
  employee_id: ids[3], event: 'promotion', from_value: JSON.stringify({ designation_id: desig.Associate }), to_value: JSON.stringify({ designation_id: desig['Senior Associate'] }),
  effective_date: addDays(now, -120), note: 'Annual review', approved_by: 1,
});

// Attendance for the last 60 days.
const sh = await db('shifts').first();
const start = addDays(now, -60);
for (const e of empRows) {
  for (const date of eachDate(start < e.join ? e.join : start, now)) {
    if ([0, 6].includes(dayOfWeek(date))) continue;
    if (rnd() < 0.04 && date !== now) continue; // an occasional absence
    const inMin = 9 * 60 + 5 + Math.floor(rnd() * 50); // 09:05–09:55
    const outMin = 17 * 60 + 45 + Math.floor(rnd() * 70);
    const hh = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const check_in = localToTs(date, hh(inMin));
    if (date === now) {
      if (rnd() < 0.85) await db('attendance').insert({ employee_id: e.id, date, check_in, source: 'web', ...evaluate(sh, check_in, null) });
      continue;
    }
    const half = rnd() < 0.04;
    const check_out = localToTs(date, hh(half ? inMin + 200 : outMin));
    await db('attendance').insert({ employee_id: e.id, date, check_in, check_out, source: 'web', ...evaluate(sh, check_in, check_out) });
  }
}

// Leave: some approved in the past, some pending.
const types = Object.fromEntries((await db('leave_types')).map((t) => [t.code, t]));
const workday = (n) => { let d = addDays(now, n); while ([0, 6].includes(dayOfWeek(d))) d = addDays(d, 1); return d; };
const leaves = [
  [3, 'CL', -20, -19, 'approved', 'Family function'], [4, 'SL', -12, -12, 'approved', 'Fever'],
  [6, 'EL', -30, -26, 'approved', 'Vacation'], [7, 'CL', 5, 6, 'pending', 'Personal work'],
  [9, 'SL', 2, 2, 'pending', 'Medical appointment'], [2, 'EL', 12, 16, 'pending', 'Trip to Goa'],
  [11, 'CL', -45, -45, 'approved', 'Bank work'],
];
for (const [ei, code, a, b, status, reason] of leaves) {
  const e = empRows[ei];
  const from = workday(a);
  let to = workday(b);
  if (to < from) to = from;
  const days = eachDate(from, to).filter((d) => ![0, 6].includes(dayOfWeek(d))).length;
  await db('leave_requests').insert({ employee_id: e.id, leave_type_id: types[code].id, from_date: from, to_date: to, days, reason, status, approver_id: status === 'approved' ? 1 : null, decided_at: status === 'approved' ? addDays(now, a) : null });
  const accrued = Number(types[code].annual_quota);
  const bal = await db('leave_balances').where({ employee_id: e.id, leave_type_id: types[code].id, year }).first();
  if (status === 'approved' && from.startsWith(String(year))) {
    if (bal) await db('leave_balances').where({ id: bal.id }).update({ used: Number(bal.used) + days });
    else await db('leave_balances').insert({ employee_id: e.id, leave_type_id: types[code].id, year, opening: 0, accrued, used: days });
  }
}
await db('attendance_regularizations').insert({ employee_id: empRows[4].id, date: workday(-3), requested_in: '09:30', requested_out: '18:30', reason: 'Forgot to punch in; was on a client call' });

await db('announcements').insert([
  { title: 'Welcome to the new HR portal', body: 'Apply for leave, regularize attendance and download payslips here. Reach out to HR if anything looks off.', pinned: true, created_by: 1 },
  { title: 'Quarterly town hall this Friday', body: 'Join us at 4 PM in the main hall for company updates and Q&A. Snacks provided.', pinned: false, created_by: 1 },
  { title: 'Health insurance enrolment window', body: 'Review and update your dependants before the end of the month.', pinned: false, created_by: 1 },
]);

// Last month's payroll, approved.
const d = new Date(`${currentMonth()}-01T00:00:00Z`);
d.setUTCMonth(d.getUTCMonth() - 1);
const month = d.toISOString().slice(0, 7);
const [runId] = await db('payroll_runs').insert({ month, status: 'paid', created_by: 1, approved_by: 1 });
const slips = await compute({ id: runId, month });
await saveSlips(db, slips);
void monthRange; void pick;

console.log(`Demo data loaded. Demo logins (password ${PASSWORD}):`);
for (const e of empRows) {
  const p = people[ids.indexOf(e.id)];
  console.log(`  ${p[5].padEnd(18)} ${p[0].toLowerCase()}.${p[1].toLowerCase()}@demo.com`);
}
await db.destroy();
