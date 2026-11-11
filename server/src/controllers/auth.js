import bcrypt from 'bcryptjs';
import { featuresOf } from '../services/features.js';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { z } from 'zod';
import db from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { audit } from '../services/audit.js';
import { ts, parseTs } from '../utils/dates.js';
import { BASE_PATH } from '../utils/basePath.js';
import { requireStrongPassword } from '../utils/password.js';
import { mailResetLink, mailPasswordChanged } from '../services/mailer.js';

const MAX_FAILS = 5;
const LOCK_MIN = 15;
const ACCESS_TTL = '15m';
const REFRESH_DAYS = 7;

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1), company: z.string().optional() });
const pwSchema = z.object({ currentPassword: z.string(), newPassword: z.string().min(10).max(128) });

// cid = the company the user belongs to; every later request is answered from that company's data only.
const accessToken = (user, cid) => jwt.sign({ sub: user.id, cid }, process.env.JWT_SECRET, { expiresIn: ACCESS_TTL });
// The refresh token embeds a stamp derived from the password hash, so changing the password revokes it.
const stamp = (user) => crypto.createHash('sha256').update(user.password_hash).digest('hex').slice(0, 16);
const refreshToken = (user, cid) =>
  jwt.sign({ sub: user.id, v: stamp(user), cid }, process.env.JWT_SECRET, { expiresIn: `${REFRESH_DAYS}d` });

const cookieOpts = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
  path: `${BASE_PATH}/api/v1/auth`,
  maxAge: REFRESH_DAYS * 86400 * 1000,
};
const clearOpts = { ...cookieOpts, maxAge: undefined };

export async function login(req, res) {
  const { email, password } = loginSchema.parse(req.body);
  if (!req.company) throw new HttpError(400, 'Enter your company code');
  const user = await db('users').where({ email }).first();
  if (user?.locked_until && parseTs(user.locked_until) > new Date()) {
    throw new HttpError(423, 'Account temporarily locked. Try again later.');
  }
  const ok = user && user.is_active && (await bcrypt.compare(password, user.password_hash));
  if (!ok) {
    if (user) {
      const fails = user.failed_logins + 1;
      await db('users')
        .where({ id: user.id })
        .update(
          fails >= MAX_FAILS
            ? { failed_logins: 0, locked_until: ts(new Date(Date.now() + LOCK_MIN * 60000)) }
            : { failed_logins: fails },
        );
    }
    throw new HttpError(401, 'Invalid email or password');
  }
  if (user.totp_enabled) { // password was right: the second step comes next. No session is issued yet.
    const challenge = jwt.sign({ sub: user.id, cid: req.company.id, tf: 1 }, process.env.JWT_SECRET, { expiresIn: '5m' });
    return res.json({ twoFactor: true, challenge });
  }
  return issueSession(req, res, user);
}

// Signs the person in: refresh cookie + access token. Used after the password (and, when on, the two-step code).
export async function issueSession(req, res, user) {
  await db('users').where({ id: user.id }).update({ failed_logins: 0, locked_until: null, last_login_at: ts() });
  db('companies').where({ id: req.company.id }).update({ last_login_at: ts() }).catch(() => {}); // lets the platform owner see when a company was last used
  res.cookie('refresh', refreshToken(user, req.company.id), cookieOpts);
  req.user = { id: user.id };
  await audit(req, 'user', user.id, 'login');
  res.json({ accessToken: accessToken(user, req.company.id) });
}

export async function refresh(req, res) {
  const token = req.cookies?.refresh;
  if (!token) throw new HttpError(401, 'No session');
  let p;
  try {
    p = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw new HttpError(401, 'Session expired');
  }
  if (!req.company || p.cid !== req.company.id || p.rp || p.tf) throw new HttpError(401, 'Session expired');
  const user = await db('users').where({ id: p.sub, is_active: true }).first();
  if (!user || stamp(user) !== p.v) throw new HttpError(401, 'Session expired');
  res.json({ accessToken: accessToken(user, req.company.id) });
}

export function logout(_req, res) {
  res.clearCookie('refresh', clearOpts);
  res.status(204).end();
}

// On a company's own web address the sign-in page needs no company code: this tells it which company the address belongs to.
export function hostCompany(req, res) {
  const c = req.company;
  res.json(c?.domain && c.domain === String(req.hostname).toLowerCase() ? { code: c.code, name: c.name } : {});
}

export async function me(req, res) {
  const role = await db('roles').where({ id: req.user.roleId }).first();
  const emp = req.user.employeeId ? await db('employees').where({ id: req.user.employeeId }).first() : null;
  res.json({
    id: req.user.id,
    name: emp ? `${emp.first_name} ${emp.last_name || ''}`.trim() : null,
    email: req.user.email,
    employeeId: req.user.employeeId,
    role: role.name,
    mustChangePassword: !!req.user.mustChange,
    twoFactor: { enabled: !!req.user.twoFactorOn, required: !!req.user.needsTwoFactor },
    mustSetupTwoFactor: !!req.user.mustSetup2fa,
    company: { id: req.company.id, code: req.company.code, name: req.company.name },
    features: featuresOf(req.company),
    permissions: [...req.user.permissions],
  });
}

export async function changePassword(req, res) {
  const { currentPassword, newPassword } = pwSchema.parse(req.body);
  const user = await db('users').where({ id: req.user.id }).first();
  if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
    throw new HttpError(400, 'Current password is incorrect');
  }
  requireStrongPassword(newPassword, user.email);
  if (newPassword === currentPassword) throw new HttpError(400, 'Choose a different password from the current one');
  await db('users').where({ id: user.id }).update({ password_hash: await bcrypt.hash(newPassword, 12), must_change_password: false });
  await audit(req, 'user', user.id, 'change_password');
  mailPasswordChanged(user.email);
  res.clearCookie('refresh', clearOpts);
  res.status(204).end();
}

// Forgot password: emails a link that works for 1 hour. The answer is always the same, so nobody can find out which emails have accounts.
const forgotMine = new Map(); // at most 3 emails an hour to one address
export async function forgotPassword(req, res) {
  const { email } = z.object({ email: z.string().trim().toLowerCase().email(), company: z.string().optional() }).parse(req.body);
  if (!req.company) throw new HttpError(400, 'Enter your company code');
  const key = `${req.company.id}:${email}`;
  const f = forgotMine.get(key);
  const recent = f && Date.now() - f.at < 3600000 ? f.n : 0;
  const user = recent < 3 ? await db('users').where({ email, is_active: true }).first() : null;
  if (user) {
    forgotMine.set(key, { n: recent + 1, at: recent ? f.at : Date.now() });
    // The link carries a stamp of the current password, so it stops working the moment the password changes (one use only).
    const token = jwt.sign({ sub: user.id, v: stamp(user), cid: req.company.id, rp: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' });
    mailResetLink(user.email, token);
    req.user = { id: user.id };
    await audit(req, 'user', user.id, 'forgot_password');
  }
  res.json({ ok: true, message: 'If an account with that email exists, we have sent a link to reset the password. It works for 1 hour.' });
}

export async function resetPassword(req, res) {
  const { token, password } = z.object({ token: z.string().min(10).max(2000), password: z.string().min(10).max(128), company: z.string().optional() }).parse(req.body);
  let p;
  try { p = jwt.verify(token, process.env.JWT_SECRET); } catch { p = null; }
  if (!p?.rp || !req.company || p.cid !== req.company.id) throw new HttpError(400, 'This reset link is not valid or has expired. Please ask for a new one.');
  const user = await db('users').where({ id: p.sub, is_active: true }).first();
  if (!user || stamp(user) !== p.v) throw new HttpError(400, 'This reset link has already been used or has expired. Please ask for a new one.');
  requireStrongPassword(password, user.email);
  await db('users').where({ id: user.id }).update({ password_hash: await bcrypt.hash(password, 12), failed_logins: 0, locked_until: null, must_change_password: false });
  req.user = { id: user.id };
  await audit(req, 'user', user.id, 'reset_password_by_link');
  mailPasswordChanged(user.email);
  res.clearCookie('refresh', clearOpts);
  res.status(204).end();
}
