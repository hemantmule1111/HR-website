import db from '../db/index.js';
import { visibleIds, fullName } from '../services/scope.js';
import { dayStatuses } from '../services/attendance.js';
import { ensureBalance, available } from '../services/leave.js';
import { today, addDays, eachDate } from '../utils/dates.js';

const count = async (q) => Number((await q.count({ c: '*' }).first()).c);

function nextOccurrence(dateStr, now) {
  const [, m, d] = String(dateStr).slice(0, 10).split('-');
  const year = Number(now.slice(0, 4));
  let occ = `${year}-${m}-${d}`;
  if (occ < now) occ = `${year + 1}-${m}-${d}`;
  return occ;
}

export async function summary(req, res) {
  const now = today();
  const out = { today: now, announcements: await db('announcements').orderBy('pinned', 'desc').orderBy('id', 'desc').limit(4) };
  const emp = req.user.employeeId ? await db('employees').where({ id: req.user.employeeId }).first() : null;

  if (emp) {
    const [day] = await dayStatuses(emp, now, now);
    const year = Number(now.slice(0, 4));
    const types = await db('leave_types').where({ status: 'active' }).orderBy('id');
    const balances = [];
    for (const t of types) {
      const b = await ensureBalance(emp, t, year);
      balances.push({ name: t.name, code: t.code, color: t.color, available: available(b), total: Number(b.opening) + Number(b.accrued), used: Number(b.used), unlimited: Number(t.annual_quota) === 0 });
    }
    out.me = {
      name: fullName(emp),
      day: { status: day.status, check_in: day.record?.check_in || null, check_out: day.record?.check_out || null, holiday: day.holiday },
      balances,
      pending_requests: await count(db('leave_requests').where({ employee_id: emp.id, status: 'pending' })),
    };
  }

  out.upcoming_holidays = await db('holidays').where('date', '>=', now).orderBy('date').limit(5);

  // Approvals waiting on this user.
  const ids = await visibleIds(req.user, 'leave.manage');
  let pendingLeave = 0;
  let pendingReg = 0;
  if (req.user.permissions.has('leave.approve')) {
    pendingLeave = await count(db('leave_requests').where('status', 'pending').whereNot('employee_id', emp?.id || 0).modify((q) => ids && q.whereIn('employee_id', ids)));
  }
  if (req.user.permissions.has('attendance.view_team') || req.user.permissions.has('attendance.manage')) {
    const rids = await visibleIds(req.user, 'attendance.manage');
    pendingReg = await count(db('attendance_regularizations').where('status', 'pending').whereNot('employee_id', emp?.id || 0).modify((q) => rids && q.whereIn('employee_id', rids)));
  }
  let pendingOt = 0;
  if (req.user.permissions.has('attendance.view_team') || req.user.permissions.has('attendance.manage')) {
    const oids = await visibleIds(req.user, 'attendance.manage');
    pendingOt = await count(db('overtime_requests').where('status', 'pending').whereNot('employee_id', emp?.id || 0).modify((q) => oids && q.whereIn('employee_id', oids)));
  }
  out.approvals = { leave: pendingLeave, regularization: pendingReg, overtime: pendingOt, total: pendingLeave + pendingReg + pendingOt };

  if (req.user.permissions.has('employee.view_all')) {
    const employees = await db('employees as e').leftJoin('departments as d', 'd.id', 'e.department_id').select('e.*', 'd.name as department');
    const active = employees.filter((e) => e.status !== 'exited');
    const present = await count(db('attendance').where({ date: now }).whereNotNull('check_in'));
    const onLeave = await count(db('leave_requests').where({ status: 'approved' }).where('from_date', '<=', now).where('to_date', '>=', now));

    const byDept = {};
    for (const e of active) byDept[e.department || 'Unassigned'] = (byDept[e.department || 'Unassigned'] || 0) + 1;

    const months = [];
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(`${now.slice(0, 7)}-01T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() - i);
      months.push(d.toISOString().slice(0, 7));
    }
    const trend = months.map((m) => ({
      month: m,
      joined: employees.filter((e) => String(e.join_date).startsWith(m)).length,
      exited: employees.filter((e) => e.exit_date && String(e.exit_date).startsWith(m)).length,
    }));

    const from = addDays(now, -13);
    const perDay = await db('attendance').whereBetween('date', [from, now]).whereNotNull('check_in').groupBy('date').select('date').count({ c: '*' });
    const map = new Map(perDay.map((r) => [String(r.date).slice(0, 10), Number(r.c)]));
    const attendanceTrend = eachDate(from, now).map((date) => ({ date, present: map.get(date) || 0 }));

    const horizon = addDays(now, 30);
    const events = [];
    for (const e of active) {
      if (e.dob) {
        const date = nextOccurrence(e.dob, now);
        if (date <= horizon) events.push({ type: 'birthday', date, name: fullName(e), department: e.department });
      }
      const jd = String(e.join_date).slice(0, 10);
      if (jd < `${now.slice(0, 4)}-01-01`) {
        const date = nextOccurrence(jd, now);
        if (date <= horizon) events.push({ type: 'anniversary', date, name: fullName(e), years: Number(date.slice(0, 4)) - Number(jd.slice(0, 4)) });
      }
    }
    events.sort((a, b) => a.date.localeCompare(b.date));

    const year = Number(now.slice(0, 4));
    const leaveByType = await db('leave_balances as b')
      .join('leave_types as t', 't.id', 'b.leave_type_id')
      .where('b.year', year)
      .groupBy('t.name', 't.color')
      .select('t.name', 't.color')
      .sum({ used: 'b.used' });

    out.company = {
      total: active.length,
      present,
      on_leave: onLeave,
      probation: active.filter((e) => e.status === 'probation').length,
      departments: Object.entries(byDept).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
      trend,
      attendance_trend: attendanceTrend,
      events: events.slice(0, 8),
      leave_by_type: leaveByType.map((r) => ({ name: r.name, color: r.color, used: Number(r.used || 0) })),
      new_joiners: active.filter((e) => String(e.join_date).slice(0, 10) >= addDays(now, -30)).length,
    };
  }
  res.json(out);
}
