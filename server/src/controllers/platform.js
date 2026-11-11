import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import db from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { ts, parseTs } from '../utils/dates.js';
import { dateStr } from '../utils/validators.js';
import { runAs } from '../db/tenant.js';
import { requireStrongPassword } from '../utils/password.js';
import { sendMail, mailHtml } from '../services/mailer.js';
import { newSecret, verifyTotp, otpauthUrl, newRecoveryCodes, useRecoveryCode, encryptText, decryptText } from '../utils/totp.js';
import fs from 'node:fs';
import path from 'node:path';
import { provisionCompany, upgradeCompany, companyStats, resetCompanyAdmin, forgetCompanies, CODE_RE, logPlatform, dropCompanyTables } from '../services/tenants.js';
import { FEATURES, featuresOf } from '../services/features.js';
import { exportOneCompany } from './exportData.js';
import { TENANT_TABLES, tenantMigrationFiles } from '../db/tenant.js';

// ---- the platform owner's own sign-in (separate from every company's users) ----
const sign = (a) => jwt.sign({ pa: a.id }, process.env.JWT_SECRET, { expiresIn: '8h' });

// The platform owner must use two-step sign-in. Until it is set up, only the setup calls work.
const ALLOWED_WHILE_NO_2FA = new Set(['/platform/me', '/platform/2fa', '/platform/2fa/setup', '/platform/2fa/enable']);
const row2fa = async (id) => (await db('platform_2fa').where({ admin_id: id }).first()) || { admin_id: id, enabled: 0, secret: null, recovery_codes: null, last_step: 0 };

export async function requirePlatform(req, _res, next) {
  let a;
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    const p = jwt.verify(token, process.env.JWT_SECRET);
    if (p.tf) throw new Error('challenge'); // the half-finished sign-in is not a session
    a = p.pa && (await db('platform_admins').where({ id: p.pa }).first());
    if (!a) throw new Error('no');
  } catch {
    return next(new HttpError(401, 'Platform sign-in required'));
  }
  req.platformAdmin = a;
  req.platform2fa = await row2fa(a.id);
  if (!req.platform2fa.enabled && !ALLOWED_WHILE_NO_2FA.has(req.path)) {
    const e = new HttpError(403, 'Set up two-step sign-in first.');
    e.code = 'TWO_FACTOR_SETUP_REQUIRED';
    return next(e);
  }
  next();
}

export async function login(req, res) {
  const { email, password } = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
  const a = await db('platform_admins').where({ email: email.toLowerCase() }).first();
  if (a?.locked_until && parseTs(a.locked_until) > new Date()) throw new HttpError(423, 'Account temporarily locked. Try again later.');
  if (!a || !(await bcrypt.compare(password, a.password_hash))) {
    if (a) await db('platform_admins').where({ id: a.id }).update(a.failed_logins + 1 >= 5 ? { failed_logins: 0, locked_until: ts(new Date(Date.now() + 15 * 60000)) } : { failed_logins: a.failed_logins + 1 });
    throw new HttpError(401, 'Invalid email or password');
  }
  await db('platform_admins').where({ id: a.id }).update({ failed_logins: 0, locked_until: null });
  await logPlatform({ ip: req.ip, platformAdmin: a }, 'sign_in', null, 'Password accepted');
  const t = await row2fa(a.id);
  if (t.enabled) return res.json({ twoFactor: true, challenge: jwt.sign({ pa: a.id, tf: 1 }, process.env.JWT_SECRET, { expiresIn: '5m' }) });
  res.json({ token: sign(a), name: a.name, email: a.email, setupRequired: true });
}

// Second step: the code from the authenticator app (or a recovery code).
export async function verify(req, res) {
  const { challenge, code } = z.object({ challenge: z.string().min(10), code: z.string().min(6).max(20) }).parse(req.body);
  let p; try { p = jwt.verify(challenge, process.env.JWT_SECRET); } catch { p = null; }
  const a = p?.tf && p.pa && (await db('platform_admins').where({ id: p.pa }).first());
  if (!a) throw new HttpError(401, 'That sign-in has expired. Please start again.');
  if (a.locked_until && parseTs(a.locked_until) > new Date()) throw new HttpError(423, 'Account temporarily locked. Try again later.');
  const t = await row2fa(a.id);
  const clean = code.replace(/\s+/g, '');
  let ok = false; const patch = {};
  if (/^\d{6}$/.test(clean)) { const step = verifyTotp(decryptText(t.secret), clean, t.last_step); if (step) { ok = true; patch.last_step = step; } }
  else { const left = useRecoveryCode(t.recovery_codes, clean); if (left) { ok = true; patch.recovery_codes = JSON.stringify(left); } }
  if (!ok) {
    await db('platform_admins').where({ id: a.id }).update(a.failed_logins + 1 >= 5 ? { failed_logins: 0, locked_until: ts(new Date(Date.now() + 15 * 60000)) } : { failed_logins: a.failed_logins + 1 });
    throw new HttpError(401, 'That code is not correct. Try the newest code from your app, or use a recovery code.');
  }
  await db('platform_2fa').where({ admin_id: a.id }).update(patch);
  res.json({ token: sign(a), name: a.name, email: a.email });
}

export async function twoFactorStatus(req, res) {
  const t = req.platform2fa;
  res.json({ enabled: !!t.enabled, required: true, recovery_left: t.enabled ? JSON.parse(t.recovery_codes || '[]').length : 0 });
}
export async function twoFactorSetup(req, res) {
  if (req.platform2fa.enabled) throw new HttpError(400, 'Two-step sign-in is already on');
  const secret = newSecret();
  const enc = encryptText(secret);
  if (await db('platform_2fa').where({ admin_id: req.platformAdmin.id }).first()) await db('platform_2fa').where({ admin_id: req.platformAdmin.id }).update({ secret: enc, last_step: 0 });
  else await db('platform_2fa').insert({ admin_id: req.platformAdmin.id, secret: enc });
  res.json({ secret, otpauth: otpauthUrl('WorkPilot Platform', req.platformAdmin.email, secret) });
}
export async function twoFactorEnable(req, res) {
  const { code } = z.object({ code: z.string().min(6).max(20) }).parse(req.body);
  const t = req.platform2fa;
  if (t.enabled) throw new HttpError(400, 'Two-step sign-in is already on');
  if (!t.secret) throw new HttpError(400, 'Start the setup first');
  const step = verifyTotp(decryptText(t.secret), code, 0);
  if (!step) throw new HttpError(400, 'That code is not correct. Check the time on your phone and try the next code.');
  const { codes, hashes } = newRecoveryCodes();
  await db('platform_2fa').where({ admin_id: req.platformAdmin.id }).update({ enabled: true, last_step: step, recovery_codes: JSON.stringify(hashes) });
  res.json({ recovery_codes: codes });
}
export async function twoFactorRecovery(req, res) {
  const { code } = z.object({ code: z.string().min(6).max(20) }).parse(req.body);
  const t = req.platform2fa;
  const step = t.enabled && verifyTotp(decryptText(t.secret), code, t.last_step);
  if (!step) throw new HttpError(400, 'That code is not correct');
  const { codes, hashes } = newRecoveryCodes();
  await db('platform_2fa').where({ admin_id: req.platformAdmin.id }).update({ last_step: step, recovery_codes: JSON.stringify(hashes) });
  res.json({ recovery_codes: codes });
}

export const me = (req, res) => res.json({ id: req.platformAdmin.id, name: req.platformAdmin.name, email: req.platformAdmin.email });

export async function changePassword(req, res) {
  const { currentPassword, newPassword } = z.object({ currentPassword: z.string(), newPassword: z.string().min(10).max(128) }).parse(req.body);
  if (!(await bcrypt.compare(currentPassword, req.platformAdmin.password_hash))) throw new HttpError(400, 'Current password is incorrect');
  requireStrongPassword(newPassword, req.platformAdmin.email);
  await db('platform_admins').where({ id: req.platformAdmin.id }).update({ password_hash: await bcrypt.hash(newPassword, 12) });
  res.status(204).end();
}

// ---- companies ----
const shape = (c, stats) => ({
  id: c.id, code: c.code, name: c.name, status: c.status, max_employees: c.max_employees, valid_until: c.valid_until ? String(c.valid_until).slice(0, 10) : null,
  notes: c.notes, created_at: c.created_at, schema_version: c.schema_version, plan: c.plan || null, domain: c.domain || null, features: featuresOf(c), last_login_at: c.last_login_at || null, ...stats,
});

export async function listCompanies(_req, res) {
  const rows = await db('companies').orderBy('id');
  const out = [];
  for (const c of rows) {
    const stats = await companyStats(c);
    const admin_email = await runAs(c.prefix, async () => {
      try {
        const role = await db('roles').where({ name: 'Super Admin' }).first();
        return (await db('users').where({ role_id: role.id }).orderBy('id').first())?.email ?? null;
      } catch { return null; }
    });
    out.push(shape(c, { ...stats, admin_email }));
  }
  res.json(out);
}

const featuresSchema = z.object(Object.fromEntries(Object.keys(FEATURES).map((k) => [k, z.boolean()]))).partial();
const domainSchema = z.string().trim().toLowerCase().max(150).regex(/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/, 'Enter a web address such as hr.acme.com').nullable().or(z.literal('').transform(() => null));
const createSchema = z.object({
  name: z.string().trim().min(2).max(150),
  code: z.string().trim().toLowerCase().min(3).max(40),
  admin_email: z.string().trim().toLowerCase().email().max(150),
  admin_password: z.string().min(10).max(128),
  max_employees: z.coerce.number().int().min(0).max(100000).default(0),
  valid_until: dateStr.nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  plan: z.string().trim().max(40).nullable().optional(),
  features: featuresSchema.optional(),
  domain: domainSchema.optional(),
});

export async function createCompany(req, res) {
  const d = createSchema.parse(req.body);
  requireStrongPassword(d.admin_password, d.admin_email);
  const { plan, features, domain, ...base } = d;
  if (domain && (await db('companies').where({ domain }).first())) throw new HttpError(409, 'That web address is already used by another company');
  const r = await provisionCompany(base);
  await db('companies').where({ id: r.id }).update({ plan: plan || null, features: features ? JSON.stringify(features) : null, domain: domain || null });
  await logPlatform(req, 'company_create', { id: r.id, code: r.code }, `${d.name}${plan ? `, plan ${plan}` : ''}`);
  res.status(201).json(r);
}

export async function updateCompany(req, res) {
  const c = await db('companies').where({ id: req.params.id }).first();
  if (!c) throw new HttpError(404, 'Company not found');
  const d = z.object({
    name: z.string().trim().min(2).max(150), code: z.string().trim().toLowerCase(), status: z.enum(['active', 'suspended']),
    max_employees: z.coerce.number().int().min(0).max(100000), valid_until: dateStr.nullable(), notes: z.string().max(1000).nullable(),
    plan: z.string().trim().max(40).nullable(), features: featuresSchema, domain: domainSchema,
  }).partial().parse(req.body);
  if (d.domain && (await db('companies').where({ domain: d.domain }).whereNot({ id: c.id }).first())) throw new HttpError(409, 'That web address is already used by another company');
  if (d.code && d.code !== c.code) {
    if (!CODE_RE.test(d.code)) throw new HttpError(400, 'Company code: 3 to 40 letters, numbers or hyphens');
    if (await db('companies').where({ code: d.code }).whereNot({ id: c.id }).first()) throw new HttpError(409, 'That company code is already taken');
  }
  const { features, ...rest } = d;
  const patch = { ...rest, ...(features ? { features: JSON.stringify({ ...featuresOf(c), ...features }) } : {}), updated_at: db.fn.now() };
  await db('companies').where({ id: c.id }).update(patch);
  forgetCompanies();
  const what = Object.keys(d).map((k) => (k === 'features' ? `features ${JSON.stringify(features)}` : k === 'status' ? `status ${d.status}` : k)).join(', ');
  await logPlatform(req, d.status ? (d.status === 'suspended' ? 'company_suspend' : 'company_activate') : 'company_update', c, what);
  res.json({ ok: true });
}

export async function resetAdmin(req, res) {
  const c = await db('companies').where({ id: req.params.id }).first();
  if (!c) throw new HttpError(404, 'Company not found');
  const d = z.object({ email: z.string().trim().toLowerCase().email().optional(), password: z.string().min(10).max(128) }).parse(req.body);
  requireStrongPassword(d.password, d.email);
  const out = await resetCompanyAdmin(c, d);
  await logPlatform(req, 'admin_reset', c, `Admin login ${out.email}`);
  res.json(out);
}

// Lets the platform owner check that email works.
export async function testEmail(req, res) {
  const { to } = z.object({ to: z.string().trim().email() }).parse(req.body);
  res.json(await sendMail(to, 'WorkPilot test email', mailHtml('WorkPilot', 'Email is working', ['This is a test email from your WorkPilot site.', 'If you can read this, password resets, welcome emails and notifications will reach people.'])));
}

export async function upgradeAll(_req, res) {
  const out = [];
  for (const c of await db('companies').orderBy('id')) {
    try { out.push({ code: c.code, ...(await upgradeCompany(c)) }); } catch (e) { out.push({ code: c.code, error: e.message }); }
  }
  res.json(out);
}

// ---- the platform owner's dashboard, activity log, health check and safe delete ----
export const featureList = (_req, res) => res.json(Object.entries(FEATURES).map(([key, label]) => ({ key, label })));

const dirSize = (dir) => {
  let n = 0;
  try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size; } } catch { /* no folder yet */ }
  return n;
};
const UPLOADS = path.resolve(process.env.UPLOAD_DIR || './uploads');
const storageOf = (c) => dirSize(path.join(UPLOADS, c.prefix.replace(/_$/, '')));
const daysTo = (d) => (d ? Math.floor((Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`) - Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)) / 86400000) : null);

export async function exportCompany(req, res) {
  const c = await db('companies').where({ id: req.params.id }).first();
  if (c) await logPlatform(req, 'company_export', c, req.query.files === '1' ? 'with uploaded files' : 'data only');
  return exportOneCompany(req, res);
}

export async function overview(_req, res) {
  const rows = await db('companies').orderBy('id');
  const list = [];
  for (const c of rows) {
    const s = await companyStats(c);
    list.push({
      id: c.id, code: c.code, name: c.name, plan: c.plan || null, status: c.status, employees: s.employees, users: s.users, max_employees: c.max_employees,
      valid_until: c.valid_until ? String(c.valid_until).slice(0, 10) : null, days_left: daysTo(c.valid_until), last_login_at: c.last_login_at || null, storage_bytes: storageOf(c), created_at: c.created_at,
    });
  }
  const now = Date.now();
  const quiet = (c) => !c.last_login_at || now - parseTs(c.last_login_at).getTime() > 30 * 86400000;
  res.json({
    totals: {
      companies: list.length, active: list.filter((c) => c.status === 'active' && (c.days_left === null || c.days_left >= 0)).length,
      suspended: list.filter((c) => c.status !== 'active').length, expired: list.filter((c) => c.days_left !== null && c.days_left < 0).length,
      expiring_30: list.filter((c) => c.days_left !== null && c.days_left >= 0 && c.days_left <= 30).length, quiet_30: list.filter(quiet).length,
      employees: list.reduce((n, c) => n + (c.employees || 0), 0), storage_bytes: list.reduce((n, c) => n + c.storage_bytes, 0),
    },
    companies: list,
  });
}

export async function activityLog(req, res) {
  const q = db('platform_log').orderBy('id', 'desc').limit(Math.min(Number(req.query.limit) || 200, 500));
  if (req.query.company) q.where({ company_id: Number(req.query.company) });
  res.json(await q);
}

// Is this company healthy? Counts and settings only: no names, pay or documents of its people.
export async function companyHealth(req, res) {
  const c = await db('companies').where({ id: req.params.id }).first();
  if (!c) throw new HttpError(404, 'Company not found');
  const expected = tenantMigrationFiles().length;
  const out = { code: c.code, name: c.name, status: c.status, plan: c.plan || null, domain: c.domain || null, features: featuresOf(c), schema: { applied: c.schema_version, expected, up_to_date: c.schema_version >= expected }, last_login_at: c.last_login_at || null, storage_bytes: storageOf(c) };
  try {
    Object.assign(out, await runAs(c.prefix, async () => {
      const n = async (q) => Number((await q.count({ c: '*' }).first()).c);
      const missing = [];
      for (const t of TENANT_TABLES) if (!(await db.schema.hasTable(t))) missing.push(t);
      const role = await db('roles').where({ name: 'Super Admin' }).first();
      const admins = role ? await db('users').where({ role_id: role.id, is_active: true }) : [];
      const month = new Date().toISOString().slice(0, 7);
      return {
        tables_missing: missing,
        employees: await n(db('employees').whereNot({ status: 'exited' })), users: await n(db('users').where({ is_active: true })),
        users_signed_in_30_days: await n(db('users').where('last_login_at', '>=', ts(new Date(Date.now() - 30 * 86400000)))),
        admins: admins.length, admins_with_two_step: admins.filter((a) => a.totp_enabled).length,
        locked_users: await n(db('users').where('locked_until', '>', ts())),
        payroll_runs: await n(db('payroll_runs')), last_payroll_month: (await db('payroll_runs').orderBy('month', 'desc').first())?.month || null,
        attendance_punches_this_month: await n(db('attendance').where('date', '>=', `${month}-01`)),
      };
    }, c));
  } catch (e) { out.error = 'This company\'s tables are not ready. Press "Update databases".'; }
  res.json(out);
}

// Deleting a whole company: the company must be suspended, its data must have been exported in the last day, and the owner types
// the company code and their password. The first company (the original tables) is never deleted here.
export async function deleteCompany(req, res) {
  const c = await db('companies').where({ id: req.params.id }).first();
  if (!c) throw new HttpError(404, 'Company not found');
  const d = z.object({ confirm_code: z.string(), password: z.string() }).parse(req.body);
  if (!c.prefix) throw new HttpError(400, 'The first company uses the original tables and cannot be deleted here.');
  if (c.status !== 'suspended') throw new HttpError(400, 'Suspend the company first, so nobody is working in it while it is deleted.');
  if (d.confirm_code.trim().toLowerCase() !== c.code) throw new HttpError(400, `Type the company code (${c.code}) exactly to confirm.`);
  if (!(await bcrypt.compare(d.password, req.platformAdmin.password_hash))) throw new HttpError(400, 'Your password is not correct');
  const since = ts(new Date(Date.now() - 24 * 3600000));
  if (!(await db('platform_log').where({ company_id: c.id, action: 'company_export' }).where('created_at', '>=', since).first())) {
    throw new HttpError(400, 'Download an export of this company first (Export, with files). The delete is only allowed within a day of an export, so the data can be restored if it was a mistake.');
  }
  await dropCompanyTables(c.prefix);
  fs.rmSync(path.join(UPLOADS, c.prefix.replace(/_$/, '')), { recursive: true, force: true });
  await db('companies').where({ id: c.id }).del();
  forgetCompanies();
  await logPlatform(req, 'company_delete', c, `${c.name} (${c.code}) deleted with all its data`);
  res.json({ ok: true });
}
