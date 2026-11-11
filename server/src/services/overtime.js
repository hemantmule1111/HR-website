import db from '../db/index.js';
import { dayOfWeek } from '../utils/dates.js';
import { shiftFor, weekoffSet, holidayMap } from './attendance.js';

const r2 = (n) => Math.round(n * 100) / 100;

export async function getPolicy() {
  const p = await db('overtime_settings').where({ id: 1 }).first();
  return {
    ...p,
    enabled: !!p.enabled,
    hours_per_day: Number(p.hours_per_day), days_per_month: Number(p.days_per_month),
    rate_weekday: Number(p.rate_weekday), rate_weekoff: Number(p.rate_weekoff), rate_holiday: Number(p.rate_holiday),
    max_hours_day: Number(p.max_hours_day), max_hours_month: Number(p.max_hours_month),
  };
}

// weekday | weekoff | holiday, from the employee's shift and the company holiday list.
export async function dayTypeFor(employee, date) {
  if ((await holidayMap(date, date)).has(date)) return 'holiday';
  if (weekoffSet(await shiftFor(employee)).has(dayOfWeek(date))) return 'weekoff';
  return 'weekday';
}

export const multiplier = (policy, dayType) => ({ weekday: policy.rate_weekday, weekoff: policy.rate_weekoff, holiday: policy.rate_holiday }[dayType] ?? policy.rate_weekday);

// Ordinary pay for one hour, from a full-month salary structure and the company's overtime basis.
// off = standard categories switched off on the Master sheet; custom = [{ amount }] earnings the company added.
export function hourlyRate(s, policy, off = new Set(), custom = []) {
  const v = (k) => (off.has(k) ? 0 : Number(s[k] || 0));
  const basic = v('basic');
  const base = policy.basis === 'basic' ? basic
    : policy.basis === 'gross' ? basic + v('da') + v('hra') + v('allowances') + v('conveyance') + v('travelling_allowance') + v('medical') + v('other_allowance') + custom.reduce((n, c) => n + Number(c.amount || 0), 0)
      : basic + v('da');
  const perHour = (policy.days_per_month || 26) * (policy.hours_per_day || 8);
  return perHour > 0 ? base / perHour : 0;
}

export const otPay = (hours, rate, perHour) => r2(Number(hours) * Number(rate) * perHour);

// Approved overtime in a month for one employee: { hours, pay }.
export async function approvedFor(employeeId, from, to, perHour) {
  const rows = await db('overtime_requests').where({ employee_id: employeeId, status: 'approved' }).whereBetween('date', [from, to]);
  return { hours: r2(rows.reduce((n, r) => n + Number(r.hours), 0)), pay: r2(rows.reduce((n, r) => n + otPay(r.hours, r.rate, perHour), 0)) };
}
