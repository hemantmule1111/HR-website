import { z } from 'zod';
import db from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { audit } from '../services/audit.js';
import { visibleIds, assertAccess, requireEmployee, fullName } from '../services/scope.js';
import { notifyApprovers, notifyEmployee } from '../services/notify.js';
import { shiftFor, evaluate, dayStatuses, localToTs } from '../services/attendance.js';
import { ts, today, monthRange, currentMonth, isMonth, isDate } from '../utils/dates.js';
import { dateStr, timeStr } from '../utils/validators.js';
import { verifyPunch } from '../services/geo.js';
import { getRules, punchSource, saveSelfie } from '../services/attendanceRules.js';
import { autoOvertime } from './overtime.js';

const getEmployee = async (id) => {
  const e = await db('employees').where({ id }).first();
  if (!e) throw new HttpError(404, 'Employee not found');
  return e;
};

export async function checkIn(req, res) {
  const emp = await getEmployee(requireEmployee(req.user));
  const date = today();
  const existing = await db('attendance').where({ employee_id: emp.id, date }).first();
  if (existing?.check_in) throw new HttpError(400, 'You have already checked in today');
  const rules = await getRules();
  const source = await punchSource(rules, req.body); // a QR code from the office screen, when the company asks for one
  const where = await verifyPunch(req.body, 'in'); // refuses the punch when the location check is on and you are not at the office
  const in_photo = saveSelfie(req.body?.photo, rules.selfie_required);
  const now = ts();
  const calc = evaluate(await shiftFor(emp), now, null, rules);
  await db('attendance').insert({ employee_id: emp.id, date, check_in: now, source, status: calc.status, late_minutes: calc.late_minutes, in_photo, ...where });
  res.status(201).json(await db('attendance').where({ employee_id: emp.id, date }).first());
}

export async function checkOut(req, res) {
  const emp = await getEmployee(requireEmployee(req.user));
  const date = today();
  const rec = await db('attendance').where({ employee_id: emp.id, date }).first();
  if (!rec?.check_in) throw new HttpError(400, 'Check in first');
  if (rec.check_out) throw new HttpError(400, 'You have already checked out today');
  const rules = await getRules();
  await punchSource(rules, req.body);
  const where = await verifyPunch(req.body, 'out');
  const out_photo = saveSelfie(req.body?.photo, false);
  const now = ts();
  const calc = evaluate(await shiftFor(emp), rec.check_in, now, rules);
  await db('attendance').where({ id: rec.id }).update({ check_out: now, ...calc, ...where, out_photo, updated_at: db.fn.now() });
  await autoOvertime(emp, date);
  res.json(await db('attendance').where({ id: rec.id }).first());
}

export async function todayStatus(req, res) {
  const emp = await getEmployee(requireEmployee(req.user));
  const [day] = await dayStatuses(emp, today(), today());
  res.json({ ...day, shift: await shiftFor(emp) });
}

export async function calendar(req, res) {
  const month = req.query.month || currentMonth();
  if (!isMonth(month)) throw new HttpError(400, 'Invalid month');
  const empId = Number(req.query.employeeId || req.user.employeeId);
  if (!empId) throw new HttpError(400, 'No employee selected');
  await assertAccess(req.user, empId, 'attendance.view_all');
  const emp = await getEmployee(empId);
  const { from, to } = monthRange(month);
  const days = await dayStatuses(emp, from, to);
  const summary = { present: 0, half_day: 0, absent: 0, leave: 0, late: 0, worked_minutes: 0 };
  for (const d of days) {
    if (d.status === 'present') summary.present += 1;
    if (d.status === 'half_day') summary.half_day += 1;
    if (d.status === 'absent') summary.absent += 1;
    if (d.status === 'leave' || d.status === 'half_leave') summary.leave += d.status === 'leave' ? 1 : 0.5;
    if (d.record?.late_minutes) summary.late += 1;
    summary.worked_minutes += d.record?.worked_minutes || 0;
  }
  res.json({ employee: { id: emp.id, name: fullName(emp), emp_code: emp.emp_code }, month, summary, days });
}

// Who is where on a given day, for managers and HR.
export async function team(req, res) {
  const date = req.query.date || today();
  if (!isDate(date)) throw new HttpError(400, 'Invalid date');
  const ids = await visibleIds(req.user, 'attendance.view_all');
  const emps = await db('employees as e')
    .leftJoin('departments as d', 'd.id', 'e.department_id')
    .where('e.status', '!=', 'exited')
    .modify((q) => ids && q.whereIn('e.id', ids))
    .select('e.*', 'd.name as department')
    .orderBy('e.first_name');
  const rows = [];
  for (const e of emps) {
    const [day] = await dayStatuses(e, date, date);
    rows.push({
      id: e.id, name: fullName(e), emp_code: e.emp_code, department: e.department, status: day.status,
      check_in: day.record?.check_in || null, check_out: day.record?.check_out || null, late_minutes: day.record?.late_minutes || 0,
      leave: day.leave ? day.leave.type_name : null,
    });
  }
  res.json({ date, rows });
}

// ---- Regularization ----
const regSchema = z.object({ date: dateStr, requested_in: timeStr, requested_out: timeStr, reason: z.string().min(3).max(255) });

export async function createRegularization(req, res) {
  const d = regSchema.parse(req.body);
  const emp = await getEmployee(requireEmployee(req.user));
  if (d.date > today()) throw new HttpError(400, 'Cannot regularize a future date');
  if (d.requested_out <= d.requested_in) throw new HttpError(400, 'Check-out must be after check-in');
  const dup = await db('attendance_regularizations').where({ employee_id: emp.id, date: d.date, status: 'pending' }).first();
  if (dup) throw new HttpError(409, 'A request for this date is already pending');
  const [id] = await db('attendance_regularizations').insert({ ...d, employee_id: emp.id });
  await audit(req, 'regularization', id, 'create', null, d);
  await notifyApprovers(emp, {
    type: 'regularization', title: `${fullName(emp)} requested attendance regularization`, body: `${d.date}: ${d.reason}`, link: '/approvals',
  }, 'attendance.manage');
  res.status(201).json({ id });
}

export async function listRegularizations(req, res) {
  const scope = req.query.scope || 'mine';
  const q = db('attendance_regularizations as r')
    .join('employees as e', 'e.id', 'r.employee_id')
    .select('r.*', 'e.first_name', 'e.last_name', 'e.emp_code')
    .orderBy('r.id', 'desc')
    .limit(200);
  if (req.query.status) q.where('r.status', req.query.status);
  if (scope === 'mine') q.where('r.employee_id', requireEmployee(req.user));
  else {
    const ids = await visibleIds(req.user, 'attendance.manage');
    if (ids) q.whereIn('r.employee_id', ids);
    q.whereNot('r.employee_id', req.user.employeeId || 0);
  }
  res.json((await q).map((r) => ({ ...r, name: fullName(r) })));
}

export async function decideRegularization(req, res) {
  const { action, note } = z.object({ action: z.enum(['approve', 'reject']), note: z.string().max(255).optional() }).parse(req.body);
  const reg = await db('attendance_regularizations').where({ id: req.params.id }).first();
  if (!reg) throw new HttpError(404, 'Request not found');
  if (reg.status !== 'pending') throw new HttpError(400, 'Already decided');
  if (reg.employee_id === req.user.employeeId) throw new HttpError(403, 'You cannot approve your own request');
  await assertAccess(req.user, reg.employee_id, 'attendance.manage');
  const emp = await getEmployee(reg.employee_id);
  const date = String(reg.date).slice(0, 10);
  const shift = await shiftFor(emp); // looked up before the transaction: a transaction holds its own connection
  const rules = await getRules();

  await db.transaction(async (trx) => {
    await trx('attendance_regularizations').where({ id: reg.id }).update({
      status: action === 'approve' ? 'approved' : 'rejected', approver_id: req.user.id, decision_note: note ?? null, decided_at: ts(), updated_at: trx.fn.now(),
    });
    if (action === 'approve') {
      const check_in = localToTs(date, reg.requested_in);
      const check_out = localToTs(date, reg.requested_out);
      const calc = evaluate(shift, check_in, check_out, rules);
      const row = { check_in, check_out, source: 'regularized', ...calc };
      const existing = await trx('attendance').where({ employee_id: emp.id, date }).first();
      if (existing) await trx('attendance').where({ id: existing.id }).update({ ...row, updated_at: trx.fn.now() });
      else await trx('attendance').insert({ employee_id: emp.id, date, ...row });
    }
  });
  if (action === 'approve') await autoOvertime(emp, date);
  await audit(req, 'regularization', reg.id, action, { status: 'pending' }, { status: action });
  await notifyEmployee(emp.id, {
    type: 'regularization', title: `Your regularization for ${date} was ${action === 'approve' ? 'approved' : 'rejected'}`, body: note, link: '/attendance',
  });
  res.json({ ok: true });
}
