import db from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { csv } from '../utils/validators.js';
import { fullName } from '../services/scope.js';
import { dayStatuses } from '../services/attendance.js';
import { monthRange, currentMonth, isMonth, today } from '../utils/dates.js';

function send(req, res, name, columns, rows) {
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
    return res.send(csv(rows, columns));
  }
  return res.json({ name, columns, rows });
}

export async function headcount(req, res) {
  const emps = await db('employees as e').leftJoin('departments as d', 'd.id', 'e.department_id').select('e.status', 'd.name as department');
  const map = new Map();
  for (const e of emps) {
    const key = e.department || 'Unassigned';
    const row = map.get(key) || { department: key, probation: 0, active: 0, notice: 0, exited: 0, total: 0 };
    row[e.status] += 1;
    if (e.status !== 'exited') row.total += 1;
    map.set(key, row);
  }
  const columns = ['department', 'probation', 'active', 'notice', 'exited', 'total'].map((k) => ({ key: k, label: k[0].toUpperCase() + k.slice(1) }));
  send(req, res, 'headcount', columns, [...map.values()].sort((a, b) => b.total - a.total));
}

export async function attendanceMonthly(req, res) {
  const month = req.query.month || currentMonth();
  if (!isMonth(month)) throw new HttpError(400, 'Invalid month');
  const { from, to } = monthRange(month);
  const emps = await db('employees as e').leftJoin('departments as d', 'd.id', 'e.department_id')
    .where('e.status', '!=', 'exited').select('e.*', 'd.name as department').orderBy('e.first_name');
  const rows = [];
  for (const e of emps) {
    const days = await dayStatuses(e, from, to);
    const c = (s) => days.filter((d) => d.status === s).length;
    rows.push({
      emp_code: e.emp_code, name: fullName(e), department: e.department || '',
      present: c('present'), half_day: c('half_day'), absent: c('absent'),
      leave: c('leave') + c('half_leave') * 0.5, late: days.filter((d) => d.record?.late_minutes > 0).length,
      hours: Math.round(days.reduce((s, d) => s + (d.record?.worked_minutes || 0), 0) / 6) / 10,
    });
  }
  const columns = [['emp_code', 'Code'], ['name', 'Employee'], ['department', 'Department'], ['present', 'Present'], ['half_day', 'Half days'], ['absent', 'Absent'], ['leave', 'Leave'], ['late', 'Late arrivals'], ['hours', 'Hours worked']].map(([key, label]) => ({ key, label }));
  send(req, res, `attendance-${month}`, columns, rows);
}

export async function leaveUtilization(req, res) {
  const year = Number(req.query.year) || Number(today().slice(0, 4));
  const types = await db('leave_types').orderBy('id');
  const bal = await db('leave_balances').where({ year });
  const emps = await db('employees as e').leftJoin('departments as d', 'd.id', 'e.department_id').where('e.status', '!=', 'exited')
    .select('e.*', 'd.name as department').orderBy('e.first_name');
  const rows = emps.map((e) => {
    const row = { emp_code: e.emp_code, name: fullName(e), department: e.department || '' };
    let total = 0;
    for (const t of types) {
      const b = bal.find((x) => x.employee_id === e.id && x.leave_type_id === t.id);
      row[`t${t.id}`] = b ? Number(b.used) : 0;
      total += row[`t${t.id}`];
    }
    row.total = total;
    return row;
  });
  const columns = [{ key: 'emp_code', label: 'Code' }, { key: 'name', label: 'Employee' }, { key: 'department', label: 'Department' },
    ...types.map((t) => ({ key: `t${t.id}`, label: `${t.name} used` })), { key: 'total', label: 'Total used' }];
  send(req, res, `leave-${year}`, columns, rows);
}
