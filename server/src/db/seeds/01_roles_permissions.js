import bcrypt from 'bcryptjs';

export const PERMISSIONS = [
  'user.manage', 'org.view', 'org.manage',
  'employee.view', 'employee.view_all', 'employee.manage', 'employee.view_sensitive',
  'attendance.view_team', 'attendance.view_all', 'attendance.manage',
  'leave.apply', 'leave.approve', 'leave.view_all', 'leave.manage',
  'payroll.manage', 'payroll.view_all',
  'announcement.manage', 'report.view', 'audit.view',
];

const ESS = ['org.view', 'leave.apply'];

export const ROLES = {
  'Super Admin': PERMISSIONS,
  'HR Admin': [...ESS, 'org.manage', 'employee.view', 'employee.view_all', 'employee.manage', 'employee.view_sensitive',
    'attendance.view_all', 'attendance.manage', 'leave.view_all', 'leave.manage', 'leave.approve',
    'announcement.manage', 'report.view', 'user.manage'],
  'Payroll Admin': [...ESS, 'employee.view', 'employee.view_all', 'employee.view_sensitive', 'attendance.view_all',
    'payroll.manage', 'payroll.view_all', 'report.view'],
  'Reporting Manager': [...ESS, 'employee.view', 'attendance.view_team', 'leave.approve'],
  Employee: ESS,
  Management: [...ESS, 'employee.view', 'employee.view_all', 'attendance.view_all', 'leave.view_all', 'report.view'],
  Auditor: [...ESS, 'employee.view', 'employee.view_all', 'attendance.view_all', 'leave.view_all', 'report.view', 'audit.view'],
};

// Permissions and roles for one company (every company gets its own copy).
export async function seedRoles(knex) {
  for (const key of PERMISSIONS) {
    await knex('permissions').insert({ key }).onConflict('key').ignore();
  }
  const perms = await knex('permissions').select('id', 'key');
  const permId = Object.fromEntries(perms.map((p) => [p.key, p.id]));

  for (const [name, keys] of Object.entries(ROLES)) {
    await knex('roles').insert({ name }).onConflict('name').ignore();
    const { id } = await knex('roles').where({ name }).first();
    await knex('role_permissions').where({ role_id: id }).del();
    for (const k of keys) await knex('role_permissions').insert({ role_id: id, permission_id: permId[k] });
  }

}

export async function seed(knex) {
  await seedRoles(knex);
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  const exists = email && (await knex('users').where({ email }).first());
  if (email && password && !exists) {
    const role = await knex('roles').where({ name: 'Super Admin' }).first();
    await knex('users').insert({ email, password_hash: await bcrypt.hash(password, 12), role_id: role.id });
  }
}
