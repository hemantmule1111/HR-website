import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import db from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { audit } from '../services/audit.js';
import { ts } from '../utils/dates.js';
import { ADMIN_PERMISSIONS } from '../middleware/auth.js';
import { newSecret, verifyTotp, otpauthUrl, newRecoveryCodes, useRecoveryCode, encryptText, decryptText } from '../utils/totp.js';
import { issueSession } from './auth.js';

const MAX_FAILS = 5;
const LOCK_MIN = 15;
const required = (req) => ADMIN_PERMISSIONS.every((k) => req.user.permissions.has(k)); // Super Admins must use it
const codeSchema = z.object({ code: z.string().min(6).max(20) });

async function me(req) { return db('users').where({ id: req.user.id }).first(); }

export async function status(req, res) {
  const u = await me(req);
  res.json({ enabled: !!u.totp_enabled, required: required(req), recovery_left: u.totp_enabled ? JSON.parse(u.recovery_codes || '[]').length : 0 });
}

// Step 1: a new secret to scan or type into the authenticator app. It is not active until a first code is confirmed.
export async function setup(req, res) {
  const u = await me(req);
  if (u.totp_enabled) throw new HttpError(400, 'Two-step sign-in is already on');
  const secret = newSecret();
  await db('users').where({ id: u.id }).update({ totp_secret: encryptText(secret), totp_last_step: 0 });
  res.json({ secret, otpauth: otpauthUrl(`WorkPilot (${req.company.code})`, u.email, secret) });
}

// Step 2: the app's first code proves it works. Recovery codes are shown once.
export async function enable(req, res) {
  const { code } = codeSchema.parse(req.body);
  const u = await me(req);
  if (u.totp_enabled) throw new HttpError(400, 'Two-step sign-in is already on');
  if (!u.totp_secret) throw new HttpError(400, 'Start the setup first');
  const step = verifyTotp(decryptText(u.totp_secret), code, 0);
  if (!step) throw new HttpError(400, 'That code is not correct. Check the time on your phone and try the next code.');
  const { codes, hashes } = newRecoveryCodes();
  await db('users').where({ id: u.id }).update({ totp_enabled: true, totp_last_step: step, recovery_codes: JSON.stringify(hashes) });
  await audit(req, 'user', u.id, 'two_factor_enable');
  res.json({ recovery_codes: codes });
}

// Needs the password and a current code. Super Admins cannot switch it off.
export async function disable(req, res) {
  const { password, code } = z.object({ password: z.string().min(1), code: z.string().min(6).max(20) }).parse(req.body);
  if (required(req)) throw new HttpError(400, 'Two-step sign-in is required for administrators and cannot be switched off.');
  const u = await me(req);
  if (!u.totp_enabled) throw new HttpError(400, 'Two-step sign-in is not on');
  if (!(await bcrypt.compare(password, u.password_hash))) throw new HttpError(400, 'Password is incorrect');
  if (!verifyTotp(decryptText(u.totp_secret), code, u.totp_last_step)) throw new HttpError(400, 'That code is not correct');
  await db('users').where({ id: u.id }).update({ totp_enabled: false, totp_secret: null, recovery_codes: null, totp_last_step: 0 });
  await audit(req, 'user', u.id, 'two_factor_disable');
  res.status(204).end();
}

export async function regenerate(req, res) {
  const { code } = codeSchema.parse(req.body);
  const u = await me(req);
  if (!u.totp_enabled) throw new HttpError(400, 'Two-step sign-in is not on');
  const step = verifyTotp(decryptText(u.totp_secret), code, u.totp_last_step);
  if (!step) throw new HttpError(400, 'That code is not correct');
  const { codes, hashes } = newRecoveryCodes();
  await db('users').where({ id: u.id }).update({ totp_last_step: step, recovery_codes: JSON.stringify(hashes) });
  await audit(req, 'user', u.id, 'two_factor_new_recovery_codes');
  res.json({ recovery_codes: codes });
}

// The second step of signing in (public: the person has proved the password and holds a short-lived challenge).
export async function verifyLogin(req, res) {
  const { challenge, code } = z.object({ challenge: z.string().min(10), code: z.string().min(6).max(20), company: z.string().optional() }).parse(req.body);
  let p; try { p = jwt.verify(challenge, process.env.JWT_SECRET); } catch { p = null; }
  if (!p?.tf || !req.company || p.cid !== req.company.id) throw new HttpError(401, 'That sign-in has expired. Please start again.');
  const u = await db('users').where({ id: p.sub, is_active: true }).first();
  if (!u || !u.totp_enabled) throw new HttpError(401, 'That sign-in has expired. Please start again.');
  const { parseTs } = await import('../utils/dates.js');
  if (u.locked_until && parseTs(u.locked_until) > new Date()) throw new HttpError(423, 'Account temporarily locked. Try again later.');
  const clean = code.replace(/\s+/g, '');
  const patch = {};
  let okCode = false;
  if (/^\d{6}$/.test(clean)) {
    const step = verifyTotp(decryptText(u.totp_secret), clean, u.totp_last_step);
    if (step) { okCode = true; patch.totp_last_step = step; }
  } else {
    const left = useRecoveryCode(u.recovery_codes, clean);
    if (left) { okCode = true; patch.recovery_codes = JSON.stringify(left); }
  }
  if (!okCode) {
    const fails = u.failed_logins + 1;
    await db('users').where({ id: u.id }).update(fails >= MAX_FAILS ? { failed_logins: 0, locked_until: ts(new Date(Date.now() + LOCK_MIN * 60000)) } : { failed_logins: fails });
    throw new HttpError(401, 'That code is not correct. Try the newest code from your app, or use a recovery code.');
  }
  await db('users').where({ id: u.id }).update(patch);
  return issueSession(req, res, u);
}

// An administrator (user.manage) removes a colleague's two-step setup, for example after a lost phone. They set it up again at next sign-in if it is required.
export async function resetFor(req, res) {
  const u = await db('users').where({ id: req.params.id }).first();
  if (!u) throw new HttpError(404, 'User not found');
  await db('users').where({ id: u.id }).update({ totp_enabled: false, totp_secret: null, recovery_codes: null, totp_last_step: 0 });
  await audit(req, 'user', u.id, 'two_factor_reset');
  res.status(204).end();
}
