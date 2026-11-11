import db from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { eachDate, dayOfWeek } from '../utils/dates.js';
import { shiftFor, weekoffSet, holidayMap } from './attendance.js';

// Number of leave days in the range, excluding weekly-offs/holidays unless the leave type counts them.
export async function countDays(employee, type, from, to, dayPart) {
  if (to < from) throw new HttpError(400, 'End date is before start date');
  if (dayPart !== 'full') {
    if (!type.allow_half_day) throw new HttpError(400, `${type.name} does not allow half days`);
    if (from !== to) throw new HttpError(400, 'Half day applies to a single date');
  }
  const offs = weekoffSet(await shiftFor(employee));
  const holidays = await holidayMap(from, to);
  let days = 0;
  for (const d of eachDate(from, to)) {
    const nonWorking = offs.has(dayOfWeek(d)) || (holidays.get(d) && !holidays.get(d).is_optional);
    if (!nonWorking || type.count_weekoffs) days += 1;
  }
  if (days === 0) throw new HttpError(400, 'Selected dates contain no working days');
  return dayPart === 'full' ? days : 0.5;
}

const available = (b) => Number(b.opening) + Number(b.accrued) - Number(b.used);
export { available };

// Balance row for a year; created on demand with pro-rata quota for new joiners and capped carry-forward.
export async function ensureBalance(employee, type, year, trx = db) {
  const found = await trx('leave_balances').where({ employee_id: employee.id, leave_type_id: type.id, year }).first();
  if (found) return found;

  let accrued = Number(type.annual_quota);
  const joinYear = Number(String(employee.join_date).slice(0, 4));
  if (joinYear === year) {
    const joinMonth = Number(String(employee.join_date).slice(5, 7));
    accrued = Math.round((accrued * (13 - joinMonth)) / 12 * 2) / 2;
  }
  let opening = 0;
  const prev = await trx('leave_balances')
    .where({ employee_id: employee.id, leave_type_id: type.id, year: year - 1 })
    .first();
  if (prev) opening = Math.max(0, Math.min(available(prev), Number(type.carry_forward_max)));

  const row = { employee_id: employee.id, leave_type_id: type.id, year, opening, accrued, used: 0 };
  const [rowId] = await trx('leave_balances').insert(row);
  return { id: rowId, ...row };
}
