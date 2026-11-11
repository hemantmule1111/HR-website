import db from '../db/index.js';
import { getRules } from './attendanceRules.js';
import { TZ, localParts, parseTs, toMinutes, eachDate, dayOfWeek, today } from '../utils/dates.js';

export const DEFAULT_SHIFT = { start_time: '09:30', end_time: '18:30', grace_minutes: 15, half_day_minutes: 240, weekly_offs: '0' };

export async function shiftFor(employee) {
  const shift = employee.shift_id ? await db('shifts').where({ id: employee.shift_id }).first() : null;
  return shift || DEFAULT_SHIFT;
}

export const weekoffSet = (shift) => new Set(String(shift.weekly_offs || '').split(',').filter(Boolean).map(Number));

// Derive late minutes, worked minutes and status from punches.
// `rules` (attendance_settings) can turn a very late arrival or an early leaving into a half day.
export function evaluate(shift, checkIn, checkOut, rules = {}) {
  const inMin = localParts(parseTs(checkIn)).minutes;
  const start = toMinutes(shift.start_time);
  const late = inMin > start + shift.grace_minutes ? inMin - start : 0;
  let worked = 0;
  let early = 0;
  let status = 'present';
  if (checkOut) {
    worked = Math.max(0, Math.round((parseTs(checkOut) - parseTs(checkIn)) / 60000));
    if (worked < shift.half_day_minutes) status = 'half_day';
    const end = toMinutes(shift.end_time);
    const outMin = localParts(parseTs(checkOut)).minutes;
    if (end > start && outMin < end) early = end - outMin;
  }
  if (rules.late_halfday_after_min > 0 && late >= rules.late_halfday_after_min) status = 'half_day';
  if (checkOut && rules.early_halfday_before_min > 0 && early >= rules.early_halfday_before_min) status = 'half_day';
  return { late_minutes: late, worked_minutes: worked, status, early_minutes: early };
}

// Convert a company-local date + HH:MM to a UTC timestamp string.
export function localToTs(date, hhmm) {
  const guess = new Date(`${date}T${hhmm}:00Z`);
  const p = localParts(guess);
  const asLocal = new Date(`${p.date}T${p.time}:00Z`);
  const offset = asLocal - guess; // tz offset at that moment
  return new Date(guess - offset).toISOString().slice(0, 19).replace('T', ' ');
}

export async function holidayMap(from, to) {
  const rows = await db('holidays').whereBetween('date', [from, to]);
  return new Map(rows.map((h) => [String(h.date).slice(0, 10), h]));
}

/**
 * Day-by-day status for one employee. `paid` is the fraction of the day that counts as paid.
 * status: present | half_day | absent | leave | half_leave | holiday | weekoff | pending | upcoming | na
 */
export async function dayStatuses(employee, from, to) {
  const shift = await shiftFor(employee);
  const rules = await getRules();
  const offs = weekoffSet(shift);
  const [records, leaves, holidays] = await Promise.all([
    db('attendance').where({ employee_id: employee.id }).whereBetween('date', [from, to]),
    db('leave_requests')
      .join('leave_types', 'leave_types.id', 'leave_requests.leave_type_id')
      .where({ 'leave_requests.employee_id': employee.id, 'leave_requests.status': 'approved' })
      .where('from_date', '<=', to)
      .where('to_date', '>=', from)
      .select('leave_requests.*', 'leave_types.name as type_name', 'leave_types.code', 'leave_types.is_paid', 'leave_types.color'),
    holidayMap(from, to),
  ]);
  const rec = new Map(records.map((r) => [String(r.date).slice(0, 10), r]));
  const now = today();
  const join = String(employee.join_date).slice(0, 10);
  const exit = employee.exit_date ? String(employee.exit_date).slice(0, 10) : null;

  const days = eachDate(from, to).map((date) => {
    const record = rec.get(date) || null;
    const leave = leaves.find((l) => String(l.from_date).slice(0, 10) <= date && String(l.to_date).slice(0, 10) >= date) || null;
    const holiday = holidays.get(date);
    const base = { date, record, leave, holiday: holiday?.name || null };
    if (date < join || (exit && date > exit)) return { ...base, status: 'na', paid: 0 };
    if (leave && !holiday && !offs.has(dayOfWeek(date))) {
      const half = leave.day_part !== 'full';
      const leavePaid = leave.is_paid ? 1 : 0;
      if (!half) return { ...base, status: 'leave', paid: leavePaid };
      const worked = record && record.status !== 'absent' ? 0.5 : 0;
      return { ...base, status: 'half_leave', paid: leavePaid * 0.5 + worked };
    }
    if (holiday && !holiday.is_optional) return { ...base, status: 'holiday', paid: 1 };
    if (offs.has(dayOfWeek(date))) return { ...base, status: 'weekoff', paid: 1 };
    if (record && record.check_in) {
      return { ...base, status: record.status, paid: record.status === 'half_day' ? 0.5 : 1 };
    }
    if (date > now) return { ...base, status: 'upcoming', paid: 0 };
    if (date === now) return { ...base, status: 'pending', paid: 0 };
    return { ...base, status: 'absent', paid: 0 };
  });
  // After the free late marks of the month, each further late arrival costs half a day's pay.
  if (rules.late_penalty_on) {
    let n = 0;
    for (const d of days) {
      if (d.record?.late_minutes > 0 && (d.status === 'present' || d.status === 'half_day')) {
        n += 1;
        if (n > rules.late_free_marks && d.status === 'present') { d.paid = 0.5; d.late_penalty = true; }
      }
    }
  }
  return days;
}

export { TZ };
