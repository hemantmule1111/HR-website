import jwt from 'jsonwebtoken';
import db from '../db/index.js';
import { HttpError, wrap } from '../utils/http.js';

export const authenticate = wrap(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Authentication required');
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }
  if (!req.company || payload.cid !== req.company.id || payload.rp || payload.tf) throw new HttpError(401, 'Invalid or expired token'); // a password-reset link is never a sign-in
  const user = await db('users').where({ id: payload.sub, is_active: true }).first();
  if (!user) throw new HttpError(401, 'Account disabled');
  const keys = await db('role_permissions')
    .join('permissions', 'permissions.id', 'role_permissions.permission_id')
    .where('role_permissions.role_id', user.role_id)
    .pluck('permissions.key');
  req.user = {
    id: user.id,
    email: user.email,
    employeeId: user.employee_id,
    roleId: user.role_id,
    mustChange: !!user.must_change_password,
    twoFactorOn: !!user.totp_enabled,
    needsTwoFactor: ADMIN_PERMISSIONS.every((k) => keys.includes(k)), // Super Admins must use two-step sign-in
    mustSetup2fa: ADMIN_PERMISSIONS.every((k) => keys.includes(k)) && !user.totp_enabled,
    permissions: new Set(keys),
  };
  next();
});

// Until a temporary password has been replaced, the only things allowed are: who am I, change the password, sign out.
const ALLOWED_WHILE_TEMP = new Set(['/auth/me', '/auth/change-password', '/auth/logout']);
const ALLOWED_WHILE_NO_2FA = new Set([...ALLOWED_WHILE_TEMP, '/auth/2fa', '/auth/2fa/setup', '/auth/2fa/enable']);
export const passwordGate = (req, _res, next) => {
  if (req.user?.mustChange && !ALLOWED_WHILE_TEMP.has(req.path)) {
    const e = new HttpError(403, 'Please choose your own password first. Your administrator gave you a temporary one.');
    e.code = 'PASSWORD_CHANGE_REQUIRED';
    return next(e);
  }
  if (req.user?.mustSetup2fa && !ALLOWED_WHILE_NO_2FA.has(req.path)) {
    const e = new HttpError(403, 'Administrators must set up two-step sign-in before continuing.');
    e.code = 'TWO_FACTOR_SETUP_REQUIRED';
    return next(e);
  }
  next();
};

// The salary master can only be changed by the admin (Super Admin): the one role that holds all of these.
export const ADMIN_PERMISSIONS = ['user.manage', 'payroll.manage', 'org.manage'];
export const requireAdmin = (req, _res, next) => {
  if (ADMIN_PERMISSIONS.every((k) => req.user.permissions.has(k))) return next();
  next(new HttpError(403, 'Only the admin can change the salary master'));
};

export const requirePermission = (...keys) => (req, _res, next) => {
  if (keys.some((k) => req.user.permissions.has(k))) return next();
  next(new HttpError(403, 'Not permitted'));
};
