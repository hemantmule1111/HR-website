import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { z } from 'zod';
import db from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { audit } from '../services/audit.js';
import { requireEmployee, fullName } from '../services/scope.js';
import { notifyUsers, notifyEmployee } from '../services/notify.js';
import { dateStr } from '../utils/validators.js';
import { today } from '../utils/dates.js';
import { uploadSub } from '../db/tenant.js';
import { guardUpload, sendSafe } from '../utils/fileGuard.js';

const isHr = (req) => req.user.permissions.has('employee.manage');
const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR || './uploads');
const hrUserIds = () => db('users')
  .join('role_permissions', 'role_permissions.role_id', 'users.role_id')
  .join('permissions', 'permissions.id', 'role_permissions.permission_id')
  .where({ 'permissions.key': 'employee.manage', 'users.is_active': true }).pluck('users.id');

// ====================== Help desk ======================
const CATEGORIES = ['hr', 'payroll', 'it', 'admin', 'grievance', 'other'];
const STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const ticketSchema = z.object({
  category: z.enum(CATEGORIES), subject: z.string().trim().min(3).max(150), description: z.string().trim().min(5).max(5000),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
});

const withNames = (q) => q.join('employees as e', 'e.id', 't.employee_id').leftJoin('users as u', 'u.id', 't.assigned_to')
  .select('t.*', 'e.first_name', 'e.last_name', 'e.emp_code', 'u.email as assigned_email');
const shapeTicket = (t) => ({ ...t, name: fullName(t) });

export async function listTickets(req, res) {
  const q = withNames(db('helpdesk_tickets as t')).orderBy('t.updated_at', 'desc').limit(300);
  if (req.query.scope === 'all') { if (!isHr(req)) throw new HttpError(403, 'Not permitted'); } else q.where('t.employee_id', requireEmployee(req.user));
  if (req.query.status) q.where('t.status', String(req.query.status));
  res.json((await q).map(shapeTicket));
}

export async function createTicket(req, res) {
  const d = ticketSchema.parse(req.body);
  const emp = await db('employees').where({ id: requireEmployee(req.user) }).first();
  const [id] = await db('helpdesk_tickets').insert({ ...d, employee_id: emp.id });
  await audit(req, 'helpdesk_ticket', id, 'create', null, { category: d.category });
  await notifyUsers((await hrUserIds()).filter((u) => u !== req.user.id), {
    type: 'helpdesk', title: `${d.category === 'grievance' ? 'Grievance' : 'New ticket'} from ${fullName(emp)}: ${d.subject}`, body: d.description.slice(0, 200), link: '/helpdesk',
  });
  res.status(201).json({ id });
}

async function loadTicket(req) {
  const t = await withNames(db('helpdesk_tickets as t')).where('t.id', req.params.id).first();
  if (!t) throw new HttpError(404, 'Ticket not found');
  if (!isHr(req) && t.employee_id !== req.user.employeeId) throw new HttpError(404, 'Ticket not found'); // never reveal that it exists
  return t;
}

export async function getTicket(req, res) {
  const t = await loadTicket(req);
  const c = db('helpdesk_comments as c').join('users as u', 'u.id', 'c.user_id').leftJoin('employees as e', 'e.id', 'u.employee_id')
    .where('c.ticket_id', t.id).select('c.*', 'u.email', 'e.first_name', 'e.last_name').orderBy('c.id');
  if (!isHr(req)) c.where('c.is_internal', false);
  res.json({ ...shapeTicket(t), comments: (await c).map((x) => ({ ...x, is_internal: !!x.is_internal, name: x.first_name ? fullName(x) : x.email })) });
}

export async function addComment(req, res) {
  const t = await loadTicket(req);
  const { body, internal } = z.object({ body: z.string().trim().min(1).max(5000), internal: z.boolean().optional() }).parse(req.body);
  if (internal && !isHr(req)) throw new HttpError(403, 'Only HR can add internal notes');
  if (t.status === 'closed') throw new HttpError(400, 'This ticket is closed. Open it again to reply.');
  const [id] = await db('helpdesk_comments').insert({ ticket_id: t.id, user_id: req.user.id, body, is_internal: !!internal });
  await db('helpdesk_tickets').where({ id: t.id }).update({ updated_at: db.fn.now(), ...(t.status === 'resolved' && !isHr(req) ? { status: 'open', resolved_at: null } : {}) });
  if (!internal) {
    if (isHr(req) && t.employee_id !== req.user.employeeId) await notifyEmployee(t.employee_id, { type: 'helpdesk', title: `Reply on your ticket: ${t.subject}`, body: body.slice(0, 200), link: '/helpdesk' });
    else if (!isHr(req)) await notifyUsers((await hrUserIds()).filter((u) => u !== req.user.id), { type: 'helpdesk', title: `${fullName(t)} replied on: ${t.subject}`, body: body.slice(0, 200), link: '/helpdesk' });
  }
  res.status(201).json({ id });
}

// HR sets status / priority / who handles it. The person who raised it may only close it or open it again.
export async function updateTicket(req, res) {
  const t = await loadTicket(req);
  const d = z.object({ status: z.enum(STATUSES).optional(), priority: z.enum(['low', 'normal', 'high']).optional(), assigned_to: z.number().int().nullable().optional() }).parse(req.body);
  if (!isHr(req)) {
    if (d.priority !== undefined || d.assigned_to !== undefined) throw new HttpError(403, 'Not permitted');
    if (d.status && !['closed', 'open'].includes(d.status)) throw new HttpError(403, 'You can close your ticket or open it again');
  }
  if (d.assigned_to) {
    const ok = (await hrUserIds()).includes(d.assigned_to);
    if (!ok) throw new HttpError(400, 'Choose someone from the HR team');
  }
  const patch = { ...d, updated_at: db.fn.now() };
  if (d.status) patch.resolved_at = ['resolved', 'closed'].includes(d.status) ? db.fn.now() : null;
  await db('helpdesk_tickets').where({ id: t.id }).update(patch);
  await audit(req, 'helpdesk_ticket', t.id, 'update', { status: t.status, priority: t.priority }, d);
  if (isHr(req) && d.status && d.status !== t.status && t.employee_id !== req.user.employeeId) {
    await notifyEmployee(t.employee_id, { type: 'helpdesk', title: `Your ticket "${t.subject}" is now ${d.status.replace('_', ' ')}`, link: '/helpdesk' });
  }
  res.json({ ok: true });
}

// ====================== Policies ======================
const policyUpload = multer({
  storage: multer.diskStorage({
    destination: (_r, _f, cb) => { const d = path.join(UPLOAD_ROOT, uploadSub(), 'policies'); fs.mkdirSync(d, { recursive: true }); cb(null, d); },
    filename: (_r, _f, cb) => cb(null, crypto.randomUUID()),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});
export const policyUploadMiddleware = [policyUpload.single('file'), guardUpload(['pdf', 'docx'])];
const removeFile = (p) => p && fs.rm(path.resolve(UPLOAD_ROOT, p), { force: true }, () => {});
const bool = (v, d) => (v === undefined ? d : v === true || v === 'true' || v === '1' || v === 1);

export async function listPolicies(req, res) {
  const empId = req.user.employeeId;
  const rows = await db('policies').orderBy('title');
  const mine = empId ? await db('policy_acks').where({ employee_id: empId }) : [];
  res.json(rows.filter((p) => isHr(req) || p.active).map(({ file_path, ...p }) => {
    const ack = mine.find((a) => a.policy_id === p.id);
    return { ...p, requires_ack: !!p.requires_ack, active: !!p.active, acknowledged: !!ack && ack.version === p.version, acknowledged_at: ack && ack.version === p.version ? ack.acknowledged_at : null, pending: !!p.active && !!p.requires_ack && !(ack && ack.version === p.version) };
  }));
}

export async function createPolicy(req, res) {
  if (!req.file) throw new HttpError(400, 'Choose the policy file (PDF or Word)');
  const d = z.object({ title: z.string().trim().min(3).max(150), description: z.string().max(1000).optional() }).parse(req.body);
  const [id] = await db('policies').insert({
    title: d.title, description: d.description || null, requires_ack: bool(req.body.requires_ack, true), file_path: path.relative(UPLOAD_ROOT, req.file.path),
    original_name: Buffer.from(req.file.originalname, 'latin1').toString('utf8').slice(0, 250), mime: req.file.mimetype, size: req.file.size, created_by: req.user.id,
  });
  await audit(req, 'policy', id, 'create', null, { title: d.title });
  const ids = await db('users').where({ is_active: true }).whereNotNull('employee_id').pluck('id');
  await notifyUsers(ids.filter((u) => u !== req.user.id), { type: 'policy', title: `New policy: ${d.title}`, body: 'Please read it and acknowledge.', link: '/policies' });
  res.status(201).json({ id });
}

// Edit the details, or send a new file (which raises the version so people acknowledge again).
export async function updatePolicy(req, res) {
  const p = await db('policies').where({ id: req.params.id }).first();
  if (!p) throw new HttpError(404, 'Policy not found');
  const d = z.object({ title: z.string().trim().min(3).max(150).optional(), description: z.string().max(1000).nullable().optional() }).parse(req.body);
  const patch = { ...d, updated_at: db.fn.now() };
  if (req.body.requires_ack !== undefined) patch.requires_ack = bool(req.body.requires_ack, true);
  if (req.body.active !== undefined) patch.active = bool(req.body.active, true);
  if (req.file) {
    Object.assign(patch, { file_path: path.relative(UPLOAD_ROOT, req.file.path), original_name: Buffer.from(req.file.originalname, 'latin1').toString('utf8').slice(0, 250), mime: req.file.mimetype, size: req.file.size, version: p.version + 1 });
    removeFile(p.file_path);
  }
  await db('policies').where({ id: p.id }).update(patch);
  await audit(req, 'policy', p.id, req.file ? 'new_version' : 'update', null, { version: patch.version || p.version });
  if (req.file) {
    const ids = await db('users').where({ is_active: true }).whereNotNull('employee_id').pluck('id');
    await notifyUsers(ids.filter((u) => u !== req.user.id), { type: 'policy', title: `Policy updated: ${patch.title || p.title}`, body: 'A new version needs your acknowledgement.', link: '/policies' });
  }
  res.json({ ok: true, version: patch.version || p.version });
}

export async function deletePolicy(req, res) {
  const p = await db('policies').where({ id: req.params.id }).first();
  if (!p) throw new HttpError(404, 'Policy not found');
  await db('policies').where({ id: p.id }).del();
  removeFile(p.file_path);
  await audit(req, 'policy', p.id, 'delete', { title: p.title });
  res.status(204).end();
}

export async function downloadPolicy(req, res) {
  const p = await db('policies').where({ id: req.params.id }).first();
  if (!p || (!p.active && !isHr(req))) throw new HttpError(404, 'Policy not found');
  const full = path.resolve(UPLOAD_ROOT, p.file_path);
  if (!full.startsWith(UPLOAD_ROOT) || !fs.existsSync(full)) throw new HttpError(404, 'File missing');
  sendSafe(res, full, p.original_name);
}

export async function acknowledgePolicy(req, res) {
  const empId = requireEmployee(req.user);
  const p = await db('policies').where({ id: req.params.id, active: true }).first();
  if (!p) throw new HttpError(404, 'Policy not found');
  const have = await db('policy_acks').where({ policy_id: p.id, employee_id: empId }).first();
  if (have) await db('policy_acks').where({ policy_id: p.id, employee_id: empId }).update({ version: p.version, acknowledged_at: db.fn.now(), ip: req.ip });
  else await db('policy_acks').insert({ policy_id: p.id, employee_id: empId, version: p.version, ip: req.ip });
  await audit(req, 'policy', p.id, 'acknowledge', null, { version: p.version });
  res.json({ ok: true });
}

// Who has read it and who has not (HR).
export async function policyAcks(req, res) {
  const p = await db('policies').where({ id: req.params.id }).first();
  if (!p) throw new HttpError(404, 'Policy not found');
  const emps = await db('employees').whereNot({ status: 'exited' }).select('id', 'first_name', 'last_name', 'emp_code').orderBy('first_name');
  const acks = await db('policy_acks').where({ policy_id: p.id });
  const rows = emps.map((e) => { const a = acks.find((x) => x.employee_id === e.id); return { id: e.id, name: fullName(e), emp_code: e.emp_code, acknowledged: !!a && a.version === p.version, acknowledged_at: a && a.version === p.version ? a.acknowledged_at : null }; });
  res.json({ policy: { id: p.id, title: p.title, version: p.version }, done: rows.filter((r) => r.acknowledged).length, total: rows.length, rows });
}

// ====================== Assets ======================
const assetSchema = z.object({
  tag: z.string().trim().min(2).max(40), name: z.string().trim().min(2).max(120), category: z.enum(['laptop', 'phone', 'id_card', 'access_card', 'accessory', 'other']),
  serial_no: z.string().trim().max(80).optional().nullable(), purchase_date: dateStr.optional().nullable(), value: z.coerce.number().min(0).optional().nullable(),
  status: z.enum(['available', 'repair', 'retired']).optional(), notes: z.string().max(1000).optional().nullable(),
});

export async function listAssets(req, res) {
  const q = db('assets as a').leftJoin('asset_assignments as s', function j() { this.on('s.asset_id', 'a.id').andOnNull('s.returned_on'); })
    .leftJoin('employees as e', 'e.id', 's.employee_id').select('a.*', 's.employee_id as holder_id', 's.issued_on', 'e.first_name', 'e.last_name', 'e.emp_code').orderBy('a.tag').limit(500);
  if (req.query.status) q.where('a.status', String(req.query.status));
  if (req.query.category) q.where('a.category', String(req.query.category));
  if (req.query.q) q.where((w) => w.where('a.tag', 'like', `%${req.query.q}%`).orWhere('a.name', 'like', `%${req.query.q}%`).orWhere('a.serial_no', 'like', `%${req.query.q}%`));
  res.json((await q).map((a) => ({ ...a, holder: a.holder_id ? fullName(a) : null })));
}

export async function createAsset(req, res) {
  const d = assetSchema.parse(req.body);
  if (await db('assets').where({ tag: d.tag }).first()) throw new HttpError(409, 'An asset with this tag already exists');
  const [id] = await db('assets').insert({ ...d, status: d.status || 'available' });
  await audit(req, 'asset', id, 'create', null, d);
  res.status(201).json({ id });
}

export async function updateAsset(req, res) {
  const a = await db('assets').where({ id: req.params.id }).first();
  if (!a) throw new HttpError(404, 'Asset not found');
  const d = assetSchema.partial().parse(req.body);
  if (d.tag && d.tag !== a.tag && (await db('assets').where({ tag: d.tag }).first())) throw new HttpError(409, 'An asset with this tag already exists');
  if (d.status && a.status === 'assigned') throw new HttpError(400, 'Take the asset back from the employee before changing its status');
  await db('assets').where({ id: a.id }).update({ ...d, updated_at: db.fn.now() });
  await audit(req, 'asset', a.id, 'update', a, d);
  res.json({ ok: true });
}

export async function deleteAsset(req, res) {
  const a = await db('assets').where({ id: req.params.id }).first();
  if (!a) throw new HttpError(404, 'Asset not found');
  if (await db('asset_assignments').where({ asset_id: a.id }).first()) throw new HttpError(409, 'This asset has been issued before, so its history is kept. Mark it as retired instead.');
  await db('assets').where({ id: a.id }).del();
  await audit(req, 'asset', a.id, 'delete', a);
  res.status(204).end();
}

export async function assetHistory(req, res) {
  const a = await db('assets').where({ id: req.params.id }).first();
  if (!a) throw new HttpError(404, 'Asset not found');
  const rows = await db('asset_assignments as s').join('employees as e', 'e.id', 's.employee_id').where('s.asset_id', a.id).select('s.*', 'e.first_name', 'e.last_name', 'e.emp_code').orderBy('s.id', 'desc');
  res.json({ asset: a, history: rows.map((r) => ({ ...r, name: fullName(r) })) });
}

export async function assignAsset(req, res) {
  const a = await db('assets').where({ id: req.params.id }).first();
  if (!a) throw new HttpError(404, 'Asset not found');
  const d = z.object({ employee_id: z.coerce.number().int(), issued_on: dateStr.default(today()), condition: z.string().max(120).optional(), notes: z.string().max(255).optional() }).parse(req.body);
  if (a.status !== 'available') throw new HttpError(409, a.status === 'assigned' ? 'This asset is already issued. Take it back first.' : `This asset is ${a.status} and cannot be issued`);
  const emp = await db('employees').where({ id: d.employee_id }).first();
  if (!emp || emp.status === 'exited') throw new HttpError(400, 'Choose a current employee');
  await db.transaction(async (trx) => {
    await trx('asset_assignments').insert({ asset_id: a.id, employee_id: emp.id, issued_on: d.issued_on, condition_out: d.condition || null, issued_by: req.user.id, notes: d.notes || null });
    await trx('assets').where({ id: a.id }).update({ status: 'assigned', updated_at: trx.fn.now() });
  });
  await audit(req, 'asset', a.id, 'assign', null, { employee_id: emp.id });
  await notifyEmployee(emp.id, { type: 'employment', title: `${a.name} (${a.tag}) was issued to you`, link: '/profile?tab=assets' });
  res.status(201).json({ ok: true });
}

export async function returnAsset(req, res) {
  const a = await db('assets').where({ id: req.params.id }).first();
  if (!a) throw new HttpError(404, 'Asset not found');
  const d = z.object({ returned_on: dateStr.default(today()), condition: z.string().max(120).optional(), notes: z.string().max(255).optional(), status: z.enum(['available', 'repair', 'retired']).default('available') }).parse(req.body);
  const open = await db('asset_assignments').where({ asset_id: a.id }).whereNull('returned_on').first();
  if (!open) throw new HttpError(400, 'This asset is not issued to anyone');
  await db.transaction(async (trx) => {
    await trx('asset_assignments').where({ id: open.id }).update({ returned_on: d.returned_on, condition_in: d.condition || null, returned_by: req.user.id, notes: d.notes || open.notes, updated_at: trx.fn.now() });
    await trx('assets').where({ id: a.id }).update({ status: d.status, updated_at: trx.fn.now() });
  });
  await audit(req, 'asset', a.id, 'return', null, { employee_id: open.employee_id });
  res.json({ ok: true });
}

// What one employee holds now and has held before: HR, or the employee themself.
export async function employeeAssets(req, res) {
  const empId = Number(req.params.id);
  if (!isHr(req) && empId !== req.user.employeeId) throw new HttpError(403, 'Not permitted');
  const rows = await db('asset_assignments as s').join('assets as a', 'a.id', 's.asset_id').where('s.employee_id', empId)
    .select('s.*', 'a.tag', 'a.name', 'a.category', 'a.serial_no').orderBy('s.id', 'desc');
  res.json({ holding: rows.filter((r) => !r.returned_on), history: rows.filter((r) => r.returned_on) });
}
