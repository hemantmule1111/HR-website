import db from '../db/index.js';
import { mailNotification } from './mailer.js';

// Things people must act on or know about are also emailed (not birthdays, anniversaries or announcements, which would be noise).
const EMAILED = new Set(['leave', 'regularization', 'overtime', 'payroll', 'employment', 'helpdesk', 'attendance_reminder']);

async function email(userIds, payload) {
  if (!userIds.length || !EMAILED.has(payload.type)) return;
  const emails = await db('users').whereIn('id', userIds).where({ is_active: true }).pluck('email');
  for (const to of emails) mailNotification(to, payload);
}

export async function notifyUsers(userIds, { type, title, body = null, link = null }) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  await db('notifications').insert(ids.map((user_id) => ({ user_id, type, title, body, link })));
  await email(ids, { type, title, body, link });
}

export async function notifyEmployee(employeeId, payload) {
  const ids = await db('users').where({ employee_id: employeeId, is_active: true }).pluck('id');
  return notifyUsers(ids, payload);
}

// The employee's manager; if there is none, everyone holding the fallback permission (HR).
export async function notifyApprovers(employee, payload, fallbackPerm = 'leave.manage') {
  if (employee.manager_id) return notifyEmployee(employee.manager_id, payload);
  const ids = await db('users')
    .join('role_permissions', 'role_permissions.role_id', 'users.role_id')
    .join('permissions', 'permissions.id', 'role_permissions.permission_id')
    .where({ 'permissions.key': fallbackPerm, 'users.is_active': true })
    .pluck('users.id');
  return notifyUsers(ids, payload);
}
