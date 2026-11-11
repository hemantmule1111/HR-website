import { z } from 'zod';
import db from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { audit } from '../services/audit.js';
import { visibleIds, assertAccess, requireEmployee, fullName } from '../services/scope.js';
import { notifyApprovers, notifyEmployee } from '../services/notify.js';
import { countDays, ensureBalance, available } from '../services/leave.js';
import { ts, today, monthRange, currentMonth, isMonth } from '../utils/dates.js';
import { dateStr } from '../utils/validators.js';

const getEmployee = async (id) => {
  const e = await db('employees').where({ id }).first();
  if (!e) throw new HttpError(404, 'Employee not found');
  return e;
};

export async function balances(req, res) {
  const empId = Number(req.query.employeeId || req.user.employeeId);
  if (!empId) throw new HttpError(400, 'No employee selected');
  await assertAccess(req.user, empId, 'leave.view_all');
  const emp = await getEmployee(empId);
  const year = Number(req.query.year) || Number(today().slice(0, 4));
  const types = await db('leave_types').where({ status: 'active' }).orderBy('id');
  const out = [];
  for (const t of types) {
    const b = await ensureBalance(emp, t, year);
    out.push({ leave_type_id: t.id, name: t.name, code: t.code, color: t.color, is_paid: !!t.is_paid, year,
      opening: Number(b.opening), accrued: Number(b.accrued), used: Number(b.used), available: available(b), unlimited: Number(t.annual_quota) === 0 });
  }
  res.json(out);
}

const requestSchema = z.object({
  leave_type_id: z.coerce.number().int(),
  from_date: dateStr,
  to_date: dateStr,
  day_part: z.enum(['full', 'first_half', 'second_half']).default('full'),
  reason: z.string().min(3).max(255),
});

export async function apply(req, res) {
  const d = requestSchema.parse(req.body);
  const emp = await getEmployee(requireEmployee(req.user));
  const type = await db('leave_types').where({ id: d.leave_type_id, status: 'active' }).first();
  if (!type) throw new HttpError(400, 'Unknown leave type');
  if (d.from_date < String(emp.join_date).slice(0, 10)) throw new HttpError(400, 'Leave cannot start before your joining date');
  if (d.from_date.slice(0, 4) !== d.to_date.slice(0, 4)) throw new HttpError(400, 'Split requests that cross a year boundary');

  const days = await countDays(emp, type, d.from_date, d.to_date, d.day_part);
  const overlap = await db('leave_requests')
    .where({ employee_id: emp.id }).whereIn('status', ['pending', 'approved'])
    .where('from_date', '<=', d.to_date).where('to_date', '>=', d.from_date).first();
  if (overlap) {
    // Two half-days on the same date (first + second half) are allowed.
    const bothHalf = overlap.day_part !== 'full' && d.day_part !== 'full' && overlap.day_part !== d.day_part && overlap.from_date === d.from_date;
    if (!bothHalf) throw new HttpError(409, 'You already have leave on some of these dates');
  }
  if (Number(type.annual_quota) > 0) {
    const bal = await ensureBalance(emp, type, Number(d.from_date.slice(0, 4)));
    const pending = await db('leave_requests').where({ employee_id: emp.id, leave_type_id: type.id, status: 'pending' }).sum({ s: 'days' }).first();
    if (available(bal) - Number(pending.s || 0) < days) throw new HttpError(400, `Insufficient ${type.name} balance`);
  }
  const [id] = await db('leave_requests').insert({ ...d, employee_id: emp.id, days });
  await audit(req, 'leave_request', id, 'create', null, { ...d, days });
  await notifyApprovers(emp, {
    type: 'leave', title: `${fullName(emp)} applied for ${days} day(s) of ${type.name}`, body: `${d.from_date} to ${d.to_date}: ${d.reason}`, link: '/approvals',
  });
  res.status(201).json({ id, days });
}

export async function list(req, res) {
  const scope = req.query.scope || 'mine';
  const q = db('leave_requests as l')
    .join('employees as e', 'e.id', 'l.employee_id')
    .join('leave_types as t', 't.id', 'l.leave_type_id')
    .select('l.*', 'e.first_name', 'e.last_name', 'e.emp_code', 't.name as type_name', 't.code', 't.color')
    .orderBy('l.id', 'desc')
    .limit(300);
  if (req.query.status) q.where('l.status', req.query.status);
  if (scope === 'mine') q.where('l.employee_id', requireEmployee(req.user));
  else {
    const ids = await visibleIds(req.user, scope === 'all' ? 'leave.view_all' : 'leave.manage');
    if (scope === 'team' && !req.user.permissions.has('leave.approve')) throw new HttpError(403, 'Not permitted');
    if (ids) q.whereIn('l.employee_id', ids);
    if (scope === 'team') q.whereNot('l.employee_id', req.user.employeeId || 0);
  }
  res.json((await q).map((r) => ({ ...r, name: fullName(r) })));
}

export async function decide(req, res) {
  const { action, note } = z.object({ action: z.enum(['approve', 'reject', 'cancel']), note: z.string().max(255).optional() }).parse(req.body);
  const lr = await db('leave_requests').where({ id: req.params.id }).first();
  if (!lr) throw new HttpError(404, 'Request not found');
  const emp = await getEmployee(lr.employee_id);
  const type = await db('leave_types').where({ id: lr.leave_type_id }).first();
  const year = Number(String(lr.from_date).slice(0, 4));
  const from = String(lr.from_date).slice(0, 10);

  if (action === 'cancel') {
    if (lr.employee_id !== req.user.employeeId && !req.user.permissions.has('leave.manage')) throw new HttpError(403, 'Not permitted');
    if (!['pending', 'approved'].includes(lr.status)) throw new HttpError(400, 'Request cannot be cancelled');
    if (lr.status === 'approved' && from < today() && !req.user.permissions.has('leave.manage')) throw new HttpError(400, 'Past leave cannot be cancelled');
    await db.transaction(async (trx) => {
      if (lr.status === 'approved') {
        const b = await ensureBalance(emp, type, year, trx);
        await trx('leave_balances').where({ id: b.id }).update({ used: Math.max(0, Number(b.used) - Number(lr.days)) });
      }
      await trx('leave_requests').where({ id: lr.id }).update({ status: 'cancelled', decided_at: ts(), updated_at: trx.fn.now() });
    });
    await audit(req, 'leave_request', lr.id, 'cancel', { status: lr.status }, { status: 'cancelled' });
    if (lr.employee_id !== req.user.employeeId) {
      await notifyEmployee(emp.id, { type: 'leave', title: `Your ${type.name} request was cancelled by HR`, body: note, link: '/leave' });
    }
    return res.json({ ok: true });
  }

  if (lr.status !== 'pending') throw new HttpError(400, 'Already decided');
  if (lr.employee_id === req.user.employeeId) throw new HttpError(403, 'You cannot approve your own request');
  if (!req.user.permissions.has('leave.approve')) throw new HttpError(403, 'Not permitted');
  await assertAccess(req.user, lr.employee_id, 'leave.manage');

  await db.transaction(async (trx) => {
    if (action === 'approve') {
      const b = await ensureBalance(emp, type, year, trx);
      // Types with a zero quota (e.g. loss of pay) are unlimited but still tracked.
      if (Number(type.annual_quota) > 0 && available(b) < Number(lr.days)) {
        throw new HttpError(400, 'Employee no longer has enough balance');
      }
      await trx('leave_balances').where({ id: b.id }).update({ used: Number(b.used) + Number(lr.days) });
    }
    await trx('leave_requests').where({ id: lr.id }).update({
      status: action === 'approve' ? 'approved' : 'rejected', approver_id: req.user.id, decision_note: note ?? null, decided_at: ts(), updated_at: trx.fn.now(),
    });
  });
  await audit(req, 'leave_request', lr.id, action, { status: 'pending' }, { status: action });
  await notifyEmployee(emp.id, {
    type: 'leave', title: `Your ${type.name} request (${from}) was ${action === 'approve' ? 'approved' : 'rejected'}`, body: note, link: '/leave',
  });
  res.json({ ok: true });
}

// Approved leave in a month for everyone the user may see (team calendar).
export async function calendar(req, res) {
  const month = req.query.month || currentMonth();
  if (!isMonth(month)) throw new HttpError(400, 'Invalid month');
  const { from, to } = monthRange(month);
  const ids = await visibleIds(req.user, 'leave.view_all');
  const rows = await db('leave_requests as l')
    .join('employees as e', 'e.id', 'l.employee_id')
    .join('leave_types as t', 't.id', 'l.leave_type_id')
    .where('l.status', 'approved').where('l.from_date', '<=', to).where('l.to_date', '>=', from)
    .modify((q) => ids && q.whereIn('l.employee_id', ids))
    .select('l.id', 'l.employee_id', 'l.from_date', 'l.to_date', 'l.day_part', 'e.first_name', 'e.last_name', 't.name as type_name', 't.color');
  res.json({ month, items: rows.map((r) => ({ ...r, name: fullName(r) })) });
}
