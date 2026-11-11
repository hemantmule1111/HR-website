import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import db from '../db/index.js';
import { runAs, TENANT_TABLES, tenantMigrationFiles, MIGRATIONS_DIR } from '../db/tenant.js';
import { seedRoles } from '../db/seeds/01_roles_permissions.js';
import { HttpError } from '../utils/http.js';
import { today } from '../utils/dates.js';
import { mailHtml, queueMail } from './mailer.js';

const RESERVED = new Set(['platform', 'api', 'login', 'admin', 'candidate-test', 'documentation', 'www']);
export const CODE_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

// ---- finding a company (short cache: these rows rarely change, and every request needs one) ----
const cache = new Map();
const TTL = 5000;
export const forgetCompanies = () => cache.clear();
async function cached(key, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}
export const companyByCode = (code) => cached(`code:${String(code).toLowerCase()}`, () => db('companies').where({ code: String(code).toLowerCase() }).first());
export const companyById = (id) => cached(`id:${id}`, () => db('companies').where({ id: Number(id) }).first());
// A company can have its own web address (hr.acme.com): the address the browser used finds the company.
export const companyByDomain = (host) => cached(`dom:${String(host).toLowerCase()}`, () => db('companies').where({ domain: String(host).toLowerCase() }).first());
// When only one company exists, requests that name none belong to it (keeps single-company installs working).
export const soleCompany = () => cached('sole', async () => {
  const rows = await db('companies').limit(2);
  return rows.length === 1 ? rows[0] : null;
});

// The platform owner's activity log: who did what, to which company.
export async function logPlatform(req, action, company = null, detail = null) {
  try {
    await db('platform_log').insert({
      admin_id: req.platformAdmin?.id ?? null, admin_email: req.platformAdmin?.email ?? null, action, company_id: company?.id ?? null,
      company_code: company?.code ?? null, detail: detail ? String(detail).slice(0, 500) : null, ip: req.ip || null,
    });
  } catch (e) { console.warn('platform log failed:', e.message); }
}

// Throws when the company may not be used right now.
export function assertUsable(c) {
  if (c.status !== 'active') throw new HttpError(403, 'This company account is suspended. Please contact support.');
  if (c.valid_until && String(c.valid_until).slice(0, 10) < today()) throw new HttpError(403, 'This company subscription has ended. Please contact support.');
}

// Once a day, in the last 7 days of a subscription, email the company admin and the platform owner. Triggered by normal use of the site.
const reminded = new Set();
export function maybeRemindExpiry(c) {
  if (!c.valid_until) return;
  const end = String(c.valid_until).slice(0, 10);
  const days = Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / 86400000);
  const key = `${c.id}:${today()}`;
  if (days > 7 || days < 0 || reminded.has(key)) return;
  reminded.add(key);
  const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
  (async () => {
    const admins = await runAs(c.prefix, async () => {
      const role = await db('roles').where({ name: 'Super Admin' }).first();
      return role ? db('users').where({ role_id: role.id, is_active: true }).pluck('email') : [];
    }, c);
    for (const to of admins) queueMail(to, `Your WorkPilot subscription ends ${when}`, mailHtml(c.name, `Your subscription ends ${when}`, [`The WorkPilot subscription for ${c.name} ends on ${end}. After that date nobody in your company can sign in until it is renewed. Your data is kept.`, 'Please contact your WorkPilot provider to renew.']));
    for (const to of await db('platform_admins').pluck('email')) queueMail(to, `${c.name} subscription ends ${when}`, mailHtml('WorkPilot platform', `${c.name} ends ${when}`, [`Company ${c.name} (code ${c.code}) is valid until ${end}.`]));
  })().catch((e) => console.warn('expiry reminder failed:', e.message));
}

// ---- creating a company ----
function indianHolidays() {
  const src = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/seed-holidays.js'), 'utf8');
  const tDecl = src.match(/const T = [^;]+;/)[0];
  const hDecl = src.match(/const HOLIDAYS = \{[\s\S]*?\n\};/)[0];
  const H = new Function(`${tDecl}\n${hDecl}\nreturn HOLIDAYS;`)();
  return Object.entries(H).flatMap(([y, list]) => list.map(([md, name]) => ({ date: `${y}-${md}`, name })));
}

export async function dropCompanyTables(prefix) {
  await runAs(prefix, async () => { for (const t of [...TENANT_TABLES].reverse()) await db.schema.dropTableIfExists(t); });
}

export async function provisionCompany(d) {
  const code = String(d.code || '').toLowerCase();
  if (!CODE_RE.test(code) || RESERVED.has(code)) throw new HttpError(400, 'Company code: 3 to 40 letters, numbers or hyphens (for example acme-pvt)');
  if (await db('companies').where({ code }).first()) throw new HttpError(409, 'That company code is already taken');
  const [id] = await db('companies').insert({ code, name: d.name, prefix: '', status: 'active', max_employees: d.max_employees || 0, valid_until: d.valid_until || null, notes: d.notes || null });
  const prefix = `c${id}_`;
  await db('companies').where({ id }).update({ prefix });
  try {
    const hash = await bcrypt.hash(d.admin_password, 12);
    // One transaction: on SQLite this is far faster and a failure leaves nothing behind (MySQL commits each CREATE TABLE as it goes; the catch below tidies up).
    await runAs(prefix, () => db.transaction(async (trx) => {
      for (const f of tenantMigrationFiles()) await (await import(pathToFileURL(path.join(MIGRATIONS_DIR, f)).href)).up(trx);
      await seedRoles(trx);
      await trx('holidays').insert(indianHolidays());
      await trx('company_profile').where({ id: 1 }).update({ name: d.name });
      const role = await trx('roles').where({ name: 'Super Admin' }).first();
      await trx('users').insert({ email: d.admin_email, password_hash: hash, role_id: role.id, must_change_password: true });
    }));
    await db('companies').where({ id }).update({ schema_version: tenantMigrationFiles().length });
  } catch (e) {
    await dropCompanyTables(prefix).catch(() => {});
    await db('companies').where({ id }).del();
    throw e;
  }
  forgetCompanies();
  return { id, code, prefix };
}

// ---- keeping every company's tables up to date ----
export async function upgradeCompany(c) {
  const files = tenantMigrationFiles();
  if (!c.prefix) { // the first company is upgraded by "npm run migrate"; here we only record where it is
    const done = (await db('knex_migrations').whereNot('name', 'like', '%_platform.js').count({ n: '*' }).first()).n;
    await db('companies').where({ id: c.id }).update({ schema_version: Number(done) });
    return { applied: 0 };
  }
  let applied = 0;
  await runAs(c.prefix, async () => {
    for (const f of files.slice(c.schema_version)) {
      await (await import(pathToFileURL(path.join(MIGRATIONS_DIR, f)).href)).up(db);
      applied += 1;
      await db('companies').where({ id: c.id }).update({ schema_version: c.schema_version + applied });
    }
  });
  forgetCompanies();
  return { applied };
}

export async function companyStats(c) {
  try {
    return await runAs(c.prefix, async () => {
      const n = async (q) => Number((await q.count({ c: '*' }).first()).c);
      return { employees: await n(db('employees').whereNot({ status: 'exited' })), users: await n(db('users').where({ is_active: true })) };
    });
  } catch {
    return { employees: null, users: null, error: 'Tables not ready. Press "Update databases".' };
  }
}

// The company's admin login: set a new password (and optionally a new email) when the owner has forgotten it.
export async function resetCompanyAdmin(c, { email, password }) {
  return runAs(c.prefix, async () => {
    const role = await db('roles').where({ name: 'Super Admin' }).first();
    const admin = await db('users').where({ role_id: role.id }).orderBy('id').first();
    const hash = await bcrypt.hash(password, 12);
    if (!admin) {
      if (!email) throw new HttpError(400, 'This company has no admin yet. Enter an admin email.');
      await db('users').insert({ email, password_hash: hash, role_id: role.id, must_change_password: true });
      return { email };
    }
    await db('users').where({ id: admin.id }).update({ password_hash: hash, failed_logins: 0, locked_until: null, must_change_password: true, totp_enabled: false, totp_secret: null, recovery_codes: null, totp_last_step: 0, ...(email ? { email } : {}) });
    return { email: email || admin.email };
  });
}
