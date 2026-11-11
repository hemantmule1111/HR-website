import { z } from 'zod';
import db from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { audit } from '../services/audit.js';
import { visibleIds, assertAccess, requireEmployee, fullName } from '../services/scope.js';
import { notifyApprovers, notifyEmployee } from '../services/notify.js';
import { ts, today, addDays, monthRange, isMonth, currentMonth, toMinutes, localParts, parseTs } from '../utils/dates.js';
import { shiftFor } from '../services/attendance.js';
import { getRules, hhmm } from '../services/attendanceRules.js';
import { dateStr, timeStr } from '../utils/validators.js';
import { getPolicy, dayTypeFor, multiplier, hourlyRate, otPay } from '../services/overtime.js';
import { currentStructure } from './payroll.js';

const r2 = (n) => Math.round(n * 100) / 100;
const getEmployee = async (id) => {
  const e = await db('employees').where({ id }).first();
  if (!e) throw new HttpError(404, 'Employee not found');
  return e;
};

// Full-month ordinary pay per hour for an employee on a given date (0 when there is no salary structure).
async function perHourFor(employeeId, date, policy) {
  const s = await currentStructure(employeeId, date);
  if (!s) return { s: null, perHour: 0 };
  const comps = await db('salary_components');
  const off = new Set(comps.filter((c) => c.is_standard && !c.active).map((c) => c.code));
  const live = new Set(comps.filter((c) => !c.is_standard && c.active && c.kind === 'earning').map((c) => c.id));
  const items = (await db('salary_structure_items').where({ structure_id: s.id })).filter((i) => live.has(i.component_id));
  return { s, perHour: hourlyRate(s, policy, off, items) };
}

// A month whose payroll is already approved or paid is closed to overtime changes.
const monthClosed = async (date) => !!(await db('payroll_runs').where({ month: String(date).slice(0, 7) }).whereNot({ status: 'draft' }).first());

// ---- Master sheet settings ----
const settingsSchema = z.object({
  enabled: z.boolean(),
  basis: z.enum(['basic', 'basic_da', 'gross']),
  hours_per_day: z.coerce.number().min(1).max(24),
  days_per_month: z.coerce.number().min(1).max(31),
  rate_weekday: z.coerce.number().min(1).max(5),
  rate_weekoff: z.coerce.number().min(1).max(5),
  rate_holiday: z.coerce.number().min(1).max(5),
  min_minutes: z.coerce.number().int().min(0).max(480),
  max_hours_day: z.coerce.number().min(0.5).max(24),
  max_hours_month: z.coerce.number().min(1).max(300),
  max_back_days: z.coerce.number().int().min(0).max(60),
});

// Overtime made from the punch times: work beyond the shift end (or any work on a weekly off or holiday) becomes a pending claim.
// A person who already made their own claim for the day is left alone. The manager still approves it.
export async function autoOvertime(emp, date) {
  const rules = await getRules();
  const policy = await getPolicy();
  if (!rules.auto_overtime || !policy.enabled) return;
  const rec = await db('attendance').where({ employee_id: emp.id, date }).first();
  if (!rec?.check_in || !rec.check_out) return;
  const { s } = await perHourFor(emp.id, date, policy);
  if (!s || !s.overtime_eligible || (await monthClosed(date)) || date < String(emp.join_date).slice(0, 10)) return;
  const live = await db('overtime_requests').where({ employee_id: emp.id, date }).whereIn('status', ['pending', 'approved']);
  if (live.some((r) => r.source !== 'auto' || r.status === 'approved')) return;
  await db('overtime_requests').where({ employee_id: emp.id, date, source: 'auto', status: 'pending' }).del();
  const dayType = await dayTypeFor(emp, date);
  const shift = await shiftFor(emp);
  const inMin = localParts(parseTs(rec.check_in)).minutes;
  const outMin = localParts(parseTs(rec.check_out)).minutes;
  const startMin = dayType === 'weekday' ? Math.max(toMinutes(shift.end_time), inMin) : inMin;
  let mins = outMin - startMin;
  const monthUsed = (await db('overtime_requests').where({ employee_id: emp.id }).whereIn('status', ['pending', 'approved']).whereBetween('date', [date.slice(0, 7) + '-01', date.slice(0, 7) + '-31'])).reduce((n, r) => n + Number(r.hours), 0);
  mins = Math.min(mins, Math.round(policy.max_hours_day * 60), Math.round((policy.max_hours_month - monthUsed) * 60));
  if (mins < Math.max(rules.auto_overtime_min, policy.min_minutes, 1)) return;
  const hours = r2(mins / 60);
  await db('overtime_requests').insert({
    employee_id: emp.id, date, start_time: hhmm(startMin), end_time: hhmm(startMin + mins), hours, day_type: dayType, rate: multiplier(policy, dayType),
    reason: 'Worked beyond shift end (worked out from the punch times)', source: 'auto',
  });
  await notifyApprovers(emp, { type: 'overtime', title: `${fullName(emp)} has ${hours} hour(s) of overtime from the punch times`, body: `${date}: please check and approve`, link: '/approvals' }, 'attendance.manage');
}

export async function getSettings(_req, res) { res.json(await getPolicy()); }

export async function updateSettings(req, res) {
  const d = settingsSchema.parse(req.body);
  const before = await getPolicy();
  await db('overtime_settings').where({ id: 1 }).update({ ...d, updated_at: db.fn.now() });
  await audit(req, 'overtime_settings', 1, 'update', before, d);
  res.json(await getPolicy());
}

// ---- Requests ----
const reqSchema = z.object({ date: dateStr, start_time: timeStr, end_time: timeStr, reason: z.string().trim().min(3).max(255) });

export async function createRequest(req, res) {
  const d = reqSchema.parse(req.body);
  const emp = await getEmployee(requireEmployee(req.user));
  const policy = await getPolicy();
  if (!policy.enabled) throw new HttpError(400, 'Overtime is switched off for this company');
  const { s } = await perHourFor(emp.id, d.date, policy);
  if (s && !s.overtime_eligible) throw new HttpError(403, 'Your salary structure is not eligible for overtime');
  if (d.date > today()) throw new HttpError(400, 'Overtime can only be claimed once the work is done');
  if (d.date < addDays(today(), -policy.max_back_days)) throw new HttpError(400, `Overtime must be claimed within ${policy.max_back_days} day(s) of the work`);
  if (d.date < String(emp.join_date).slice(0, 10)) throw new HttpError(400, 'Date is before your joining date');
  if (toMinutes(d.end_time) <= toMinutes(d.start_time)) throw new HttpError(400, 'End time must be after start time');
  const hours = r2((toMinutes(d.end_time) - toMinutes(d.start_time)) / 60);
  if (hours * 60 < policy.min_minutes) throw new HttpError(400, `Overtime must be at least ${policy.min_minutes} minutes`);
  if (await monthClosed(d.date)) throw new HttpError(400, 'Payroll for that month is already approved, so overtime can no longer be added');

  const live = await db('overtime_requests').where({ employee_id: emp.id }).whereIn('status', ['pending', 'approved']);
  const sameDay = live.filter((r) => String(r.date).slice(0, 10) === d.date);
  if (sameDay.some((r) => toMinutes(d.start_time) < toMinutes(r.end_time) && toMinutes(d.end_time) > toMinutes(r.start_time))) throw new HttpError(409, 'This overlaps an overtime request you already made for that day');
  const dayTotal = sameDay.reduce((n, r) => n + Number(r.hours), 0) + hours;
  if (dayTotal > policy.max_hours_day) throw new HttpError(400, `Overtime is limited to ${policy.max_hours_day} hour(s) a day`);
  const monthTotal = live.filter((r) => String(r.date).slice(0, 7) === d.date.slice(0, 7)).reduce((n, r) => n + Number(r.hours), 0) + hours;
  if (monthTotal > policy.max_hours_month) throw new HttpError(400, `Overtime is limited to ${policy.max_hours_month} hour(s) a month`);

  const day_type = await dayTypeFor(emp, d.date);
  const [id] = await db('overtime_requests').insert({ ...d, employee_id: emp.id, hours, day_type, rate: multiplier(policy, day_type) });
  await audit(req, 'overtime', id, 'create', null, { ...d, hours });
  await notifyApprovers(emp, { type: 'overtime', title: `${fullName(emp)} requested ${hours} hour(s) of overtime`, body: `${d.date}: ${d.reason}`, link: '/approvals' }, 'attendance.manage');
  res.status(201).json({ id, hours, day_type });
}

export async function listRequests(req, res) {
  const scope = req.query.scope || 'mine';
  const q = db('overtime_requests as r').join('employees as e', 'e.id', 'r.employee_id')
    .select('r.*', 'e.first_name', 'e.last_name', 'e.emp_code').orderBy('r.date', 'desc').orderBy('r.id', 'desc').limit(300);
  if (req.query.status) q.where('r.status', req.query.status);
  if (isMonth(req.query.month)) { const { from, to } = monthRange(req.query.month); q.whereBetween('r.date', [from, to]); }
  if (scope === 'mine') q.where('r.employee_id', requireEmployee(req.user));
  else {
    if (!req.user.permissions.has('attendance.view_team') && !req.user.permissions.has('attendance.manage')) throw new HttpError(403, 'Not permitted');
    const ids = await visibleIds(req.user, 'attendance.manage');
    if (ids) q.whereIn('r.employee_id', ids);
    q.whereNot('r.employee_id', req.user.employeeId || 0);
  }
  const rows = await q;
  const policy = await getPolicy();
  const perHour = new Map(); // ordinary hourly pay per employee, looked up once
  const out = [];
  for (const r of rows) {
    const date = String(r.date).slice(0, 10);
    if (!perHour.has(r.employee_id)) perHour.set(r.employee_id, (await perHourFor(r.employee_id, date, policy)).perHour);
    const rate = r.status === 'approved' ? Number(r.rate) : multiplier(policy, r.day_type);
    out.push({ ...r, date, name: fullName(r), hours: Number(r.hours), rate, pay: otPay(r.hours, rate, perHour.get(r.employee_id)) });
  }
  res.json(out);
}

export async function decideRequest(req, res) {
  const { action, note } = z.object({ action: z.enum(['approve', 'reject', 'cancel']), note: z.string().max(255).optional() }).parse(req.body);
  const r = await db('overtime_requests').where({ id: req.params.id }).first();
  if (!r) throw new HttpError(404, 'Request not found');
  const date = String(r.date).slice(0, 10);
  if (action === 'cancel') {
    if (r.employee_id !== req.user.employeeId) throw new HttpError(403, 'Only the person who made the request can cancel it');
    if (!['pending', 'approved'].includes(r.status)) throw new HttpError(400, 'This request can no longer be cancelled');
    if (r.status === 'approved' && (await monthClosed(date))) throw new HttpError(400, 'Payroll for that month is already approved, so this can no longer be cancelled');
    await db('overtime_requests').where({ id: r.id }).update({ status: 'cancelled', updated_at: db.fn.now() });
    await audit(req, 'overtime', r.id, 'cancel', { status: r.status }, { status: 'cancelled' });
    return res.json({ ok: true });
  }
  if (!req.user.permissions.has('attendance.view_team') && !req.user.permissions.has('attendance.manage')) throw new HttpError(403, 'Not permitted');
  if (r.status !== 'pending') throw new HttpError(400, 'Already decided');
  if (r.employee_id === req.user.employeeId) throw new HttpError(403, 'You cannot approve your own request');
  await assertAccess(req.user, r.employee_id, 'attendance.manage');
  if (action === 'approve' && (await monthClosed(date))) throw new HttpError(400, 'Payroll for that month is already approved, so overtime can no longer be approved');
  const policy = await getPolicy();
  const patch = { status: action === 'approve' ? 'approved' : 'rejected', approver_id: req.user.id, decision_note: note ?? null, decided_at: ts(), updated_at: db.fn.now() };
  if (action === 'approve') patch.rate = multiplier(policy, r.day_type); // the rate in force today is the one paid
  await db('overtime_requests').where({ id: r.id }).update(patch);
  await audit(req, 'overtime', r.id, action, { status: 'pending' }, { status: patch.status });
  await notifyEmployee(r.employee_id, { type: 'overtime', title: `Your overtime for ${date} was ${action === 'approve' ? 'approved' : 'rejected'}`, body: note, link: '/overtime' });
  res.json({ ok: true });
}

// My month at a glance: hours, estimated pay and what is still allowed.
export async function summary(req, res) {
  const month = isMonth(req.query.month) ? req.query.month : currentMonth();
  const empId = Number(req.query.employeeId || requireEmployee(req.user));
  if (empId !== req.user.employeeId) await assertAccess(req.user, empId, 'payroll.view_all');
  const policy = await getPolicy();
  const { from, to } = monthRange(month);
  const { s, perHour } = await perHourFor(empId, to, policy);
  const rows = await db('overtime_requests').where({ employee_id: empId }).whereBetween('date', [from, to]);
  const sum = (st) => r2(rows.filter((r) => r.status === st).reduce((n, r) => n + Number(r.hours), 0));
  const approvedPay = r2(rows.filter((r) => r.status === 'approved').reduce((n, r) => n + otPay(r.hours, r.rate, perHour), 0));
  res.json({
    month, enabled: policy.enabled, eligible: policy.enabled && !!s && !!s.overtime_eligible, has_salary: !!s,
    hours_approved: sum('approved'), hours_pending: sum('pending'), pay_approved: approvedPay, per_hour: r2(perHour),
    hours_left: Math.max(0, r2(policy.max_hours_month - sum('approved') - sum('pending'))), max_hours_month: policy.max_hours_month,
  });
}
