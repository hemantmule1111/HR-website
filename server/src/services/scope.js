import db from '../db/index.js';
import { HttpError } from '../utils/http.js';

// Everyone below `empId` in the reporting tree (not including empId).
export async function teamIds(empId) {
  const all = await db('employees').select('id', 'manager_id');
  const children = new Map();
  for (const e of all) {
    if (e.manager_id) children.set(e.manager_id, [...(children.get(e.manager_id) || []), e.id]);
  }
  const out = [];
  const queue = [...(children.get(Number(empId)) || [])];
  while (queue.length) {
    const cur = queue.shift();
    out.push(cur);
    queue.push(...(children.get(cur) || []));
  }
  return out;
}

// null = unrestricted; otherwise the list of employee ids the user may see (self + reporting tree).
export async function visibleIds(user, globalPerm) {
  if (globalPerm && user.permissions.has(globalPerm)) return null;
  if (!user.employeeId) return [];
  return [user.employeeId, ...(await teamIds(user.employeeId))];
}

export async function assertAccess(user, employeeId, globalPerm) {
  const ids = await visibleIds(user, globalPerm);
  if (ids && !ids.includes(Number(employeeId))) throw new HttpError(403, 'Not permitted');
}

export function requireEmployee(user) {
  if (!user.employeeId) throw new HttpError(400, 'Your account is not linked to an employee record');
  return user.employeeId;
}

export const fullName = (e) => `${e.first_name} ${e.last_name || ''}`.trim();
