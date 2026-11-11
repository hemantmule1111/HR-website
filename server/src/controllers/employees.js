import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { uploadSub } from '../db/tenant.js';
import { guardUpload, sendSafe } from '../utils/fileGuard.js';
import { mailWelcome } from '../services/mailer.js';
import { z } from 'zod';
import db from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { audit } from '../services/audit.js';
import { visibleIds, assertAccess, fullName } from '../services/scope.js';
import { dateStr, optional } from '../utils/validators.js';
import { today } from '../utils/dates.js';
import { notifyEmployee } from '../services/notify.js';

const SENSITIVE = ['bank_name', 'bank_account', 'ifsc', 'pan', 'aadhaar'];
const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR || './uploads');

const baseFields = {
  first_name: z.string().min(1).max(80),
  last_name: z.string().max(80).optional().default(''),
  email: z.string().email().max(150),
  phone: optional(z.string().max(30)),
  dob: optional(dateStr),
  gender: optional(z.enum(['male', 'female', 'other'])),
  address: optional(z.string().max(255)),
  emergency_name: optional(z.string().max(100)),
  emergency_phone: optional(z.string().max(30)),
  department_id: optional(z.coerce.number().int()),
  designation_id: optional(z.coerce.number().int()),
  manager_id: optional(z.coerce.number().int()),
  shift_id: optional(z.coerce.number().int()),
  join_date: dateStr,
  employment_type: z.enum(['full_time', 'part_time', 'contract', 'intern']).default('full_time'),
  work_location: optional(z.string().max(100)),
  status: z.enum(['probation', 'active', 'notice', 'exited']).default('active'),
  probation_end: optional(dateStr),
  exit_date: optional(dateStr),
  bank_name: optional(z.string().max(100)),
  bank_account: optional(z.string().max(40)),
  ifsc: optional(z.string().max(20)),
  pan: optional(z.string().max(20)),
  aadhaar: optional(z.string().max(20)),
  uan: optional(z.string().max(20)), // EPF Universal Account Number
  esic_no: optional(z.string().max(20)), // ESIC insurance number
};
const createSchema = z.object({
  ...baseFields,
  create_login: z.boolean().optional(),
  role_id: z.coerce.number().int().optional(),
});
// An update changes only the fields that were sent. (The defaults used for a new employee must not be applied here, or a small edit would reset the name, status and type.)
const updateSchema = z.object({
  ...baseFields,
  last_name: z.string().max(80).optional(),
  employment_type: z.enum(['full_time', 'part_time', 'contract', 'intern']).optional(),
  status: z.enum(['probation', 'active', 'notice', 'exited']).optional(),
}).partial();
// Self-service: employees may edit only their own personal and bank/identity details.
const selfSchema = z.object(baseFields).pick({
  phone: true, dob: true, gender: true, address: true, emergency_name: true, emergency_phone: true,
  bank_name: true, bank_account: true, ifsc: true, pan: true, aadhaar: true, uan: true, esic_no: true,
}).partial();

function present(req, emp) {
  const out = { ...emp, name: fullName(emp) };
  const canSee = req.user.permissions.has('employee.view_sensitive') || emp.id === req.user.employeeId;
  if (!canSee) for (const k of SENSITIVE) delete out[k];
  return out;
}

function select() {
  return db('employees as e')
    .leftJoin('departments as d', 'd.id', 'e.department_id')
    .leftJoin('designations as g', 'g.id', 'e.designation_id')
    .leftJoin('employees as m', 'm.id', 'e.manager_id')
    .select('e.*', 'd.name as department', 'g.title as designation', 'm.first_name as mgr_first', 'm.last_name as mgr_last');
}
const shape = (req, row) => {
  const { mgr_first, mgr_last, ...emp } = row;
  return { ...present(req, emp), manager_name: mgr_first ? `${mgr_first} ${mgr_last || ''}`.trim() : null };
};

async function nextCode() {
  const last = await db('employees').max({ m: 'id' }).first();
  return `EMP${String((last?.m || 0) + 1).padStart(4, '0')}`;
}

async function assertNoCycle(empId, managerId) {
  let cur = managerId;
  const seen = new Set();
  while (cur) {
    if (Number(cur) === Number(empId)) throw new HttpError(400, 'A manager cannot report to their own subordinate');
    if (seen.has(cur)) break;
    seen.add(cur);
    cur = (await db('employees').where({ id: cur }).first('manager_id'))?.manager_id;
  }
}

export async function list(req, res) {
  const ids = await visibleIds(req.user, 'employee.view_all');
  const { search, department_id, status, docs, page = 1, limit = 20 } = req.query;
  const realDoc = (w) => w.from('employee_documents as d').whereRaw('d.employee_id = e.id').whereNot('d.type', 'Profile Photo');
  const q = select().modify((b) => {
    if (ids) b.whereIn('e.id', ids);
    if (department_id) b.where('e.department_id', department_id);
    if (status) b.where('e.status', status);
    if (docs === 'pending') b.whereExists((w) => realDoc(w).whereNull('d.verified_at'));
    if (docs === 'approved') b.whereExists((w) => realDoc(w).whereNotNull('d.verified_at')).whereNotExists((w) => realDoc(w).whereNull('d.verified_at'));
    if (search) {
      const s = `%${search}%`;
      b.where((w) => w.where('e.first_name', 'like', s).orWhere('e.last_name', 'like', s).orWhere('e.emp_code', 'like', s).orWhere('e.email', 'like', s));
    }
  });
  const total = (await q.clone().clearSelect().count({ c: 'e.id' }).first()).c;
  const take = Math.min(Number(limit) || 20, 100);
  const rows = await q.orderBy('e.id').limit(take).offset((Math.max(Number(page), 1) - 1) * take);
  // Document counts for the table (profile photos are not counted).
  const counts = rows.length ? await db('employee_documents').whereIn('employee_id', rows.map((r) => r.id)).whereNot('type', 'Profile Photo')
    .groupBy('employee_id').select('employee_id').count({ total: 'id' }).count({ approved: 'verified_at' }) : [];
  const byEmp = Object.fromEntries(counts.map((c) => [c.employee_id, c]));
  res.json({
    total: Number(total), page: Number(page), limit: take,
    items: rows.map((r) => {
      const c = byEmp[r.id];
      return { ...shape(req, r), docs_approved: Number(c?.approved || 0), docs_pending: Number(c?.total || 0) - Number(c?.approved || 0) };
    }),
  });
}

export async function get(req, res) {
  await assertAccess(req.user, req.params.id, 'employee.view_all');
  const row = await select().where('e.id', req.params.id).first();
  if (!row) throw new HttpError(404, 'Employee not found');
  res.json(shape(req, row));
}

export async function mine(req, res) {
  if (!req.user.employeeId) throw new HttpError(404, 'No employee record linked to your account');
  req.params.id = req.user.employeeId;
  return get(req, res);
}

export async function tree(_req, res) {
  const rows = await select().where('e.status', '!=', 'exited');
  res.json(rows.map((r) => ({
    id: r.id, name: fullName(r), emp_code: r.emp_code, designation: r.designation, department: r.department, manager_id: r.manager_id,
  })));
}

export async function create(req, res) {
  const { create_login, role_id, ...data } = createSchema.parse(req.body);
  if (req.company?.max_employees > 0) { // the plan this company bought
    const n = Number((await db('employees').whereNot({ status: 'exited' }).count({ c: '*' }).first()).c);
    if (n >= req.company.max_employees) throw new HttpError(403, `Your plan allows ${req.company.max_employees} employees. Please contact support to add more.`);
  }
  if (data.manager_id) await assertNoCycle(0, data.manager_id);
  let tempPassword = null;
  const emp_code = await nextCode();
  const created = await db.transaction(async (trx) => {
    const [id] = await trx('employees').insert({ ...data, emp_code });
    await trx('employment_history').insert({
      employee_id: id, event: 'joining', to_value: JSON.stringify({ department_id: data.department_id, designation_id: data.designation_id }),
      effective_date: data.join_date, approved_by: req.user.id,
    });
    if (create_login) {
      const role = role_id || (await trx('roles').where({ name: 'Employee' }).first()).id;
      tempPassword = crypto.randomBytes(6).toString('base64url');
      await trx('users').insert({ employee_id: id, email: data.email, password_hash: await bcrypt.hash(tempPassword, 12), role_id: role, must_change_password: true });
    }
    return id;
  });
  if (tempPassword) mailWelcome(data.email, data.first_name, tempPassword); // sent only after the employee was really saved
  await audit(req, 'employee', created, 'create', null, { ...data, aadhaar: undefined, pan: undefined, bank_account: undefined });
  const row = await select().where('e.id', created).first();
  res.status(201).json({ ...shape(req, row), temp_password: tempPassword });
}

export async function update(req, res) {
  const data = updateSchema.parse(req.body);
  const before = await db('employees').where({ id: req.params.id }).first();
  if (!before) throw new HttpError(404, 'Employee not found');
  if (data.manager_id) await assertNoCycle(before.id, data.manager_id);
  await db('employees').where({ id: before.id }).update({ ...data, updated_at: db.fn.now() });
  if (data.email && data.email !== before.email) await db('users').where({ employee_id: before.id }).update({ email: data.email });
  const after = await db('employees').where({ id: before.id }).first();
  const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !SENSITIVE.includes(k)));
  const changedSensitive = SENSITIVE.filter((k) => data[k] !== undefined && data[k] !== before[k]);
  await audit(req, 'employee', before.id, 'update', strip(before), { ...strip(after), changed_sensitive: changedSensitive });
  const row = await select().where('e.id', before.id).first();
  res.json(shape(req, row));
}

export async function updateMe(req, res) {
  if (!req.user.employeeId) throw new HttpError(404, 'No employee record linked to your account');
  req.params.id = req.user.employeeId;
  req.body = selfSchema.parse(req.body);
  return update(req, res);
}

// ---- Documents ----
// One-file document types: a new upload replaces the old file, until HR has verified it.
const SINGLE_DOC_TYPES = ['PAN Card', 'Aadhar Card', 'Driving Licence', 'Passport', 'Signature'];
const LOCKED_MSG = 'This document has been verified by HR and can no longer be changed. Ask HR if it needs correcting.';
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _f, cb) => {
      const dir = path.join(UPLOAD_ROOT, uploadSub(), 'employees', String(req.params.id));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_r, _f, cb) => cb(null, crypto.randomUUID()), // no extension yet: guardUpload gives it one from the file's real type
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
});
// Only PDF, JPG and PNG, and only if the file really is one (see utils/fileGuard.js).
export const uploadMiddleware = [upload.single('file'), guardUpload(['pdf', 'jpg', 'png'])];

// HR (employee.manage) can manage anyone's documents; everyone else only their own.
async function docAccess(req, employeeId) {
  if (req.user.permissions.has('employee.manage') || employeeId === req.user.employeeId) return;
  throw new HttpError(403, 'Not permitted');
}

export async function listDocs(req, res) {
  await docAccess(req, Number(req.params.id));
  const rows = await db('employee_documents').where({ employee_id: req.params.id }).orderBy('id', 'desc');
  res.json(rows.map(({ file_path, ...d }) => d));
}

export async function addDoc(req, res) {
  await docAccess(req, Number(req.params.id));
  if (!req.file) throw new HttpError(400, 'File is required');
  const meta = z.object({ type: z.string().min(1).max(50), expires_on: optional(dateStr) }).parse(req.body);
  if (meta.type === 'Profile Photo') {
    if (!['image/jpeg', 'image/png'].includes(req.file.mimetype)) {
      fs.rm(req.file.path, { force: true }, () => {});
      throw new HttpError(400, 'Profile photo must be a JPG or PNG image');
    }
    // A profile photo replaces the previous one.
    const old = await db('employee_documents').where({ employee_id: req.params.id, type: 'Profile Photo' });
    for (const o of old) fs.rm(path.resolve(UPLOAD_ROOT, o.file_path), { force: true }, () => {});
    if (old.length) await db('employee_documents').whereIn('id', old.map((o) => o.id)).del();
  }
  if (SINGLE_DOC_TYPES.includes(meta.type)) {
    const existing = await db('employee_documents').where({ employee_id: req.params.id, type: meta.type });
    if (!req.user.permissions.has('employee.manage') && existing.some((d) => d.verified_at)) {
      fs.rm(req.file.path, { force: true }, () => {});
      throw new HttpError(403, LOCKED_MSG);
    }
    const old = existing.filter((d) => !d.verified_at); // replaced by the new file
    for (const o of old) fs.rm(path.resolve(UPLOAD_ROOT, o.file_path), { force: true }, () => {});
    if (old.length) await db('employee_documents').whereIn('id', old.map((o) => o.id)).del();
  }
  const [id] = await db('employee_documents').insert({
    employee_id: req.params.id, type: meta.type, expires_on: meta.expires_on ?? null, original_name: req.file.originalname,
    file_path: path.relative(UPLOAD_ROOT, req.file.path), mime: req.file.mimetype, size: req.file.size, uploaded_by: req.user.id,
  });
  await audit(req, 'employee_document', id, 'upload', null, { employee_id: req.params.id, type: meta.type });
  res.status(201).json({ id });
}

export async function downloadDoc(req, res) {
  const doc = await db('employee_documents').where({ id: req.params.docId, employee_id: req.params.id }).first();
  if (!doc) throw new HttpError(404, 'Document not found');
  await docAccess(req, doc.employee_id);
  const full = path.resolve(UPLOAD_ROOT, doc.file_path);
  if (!full.startsWith(UPLOAD_ROOT) || !fs.existsSync(full)) throw new HttpError(404, 'File missing');
  await audit(req, 'employee_document', doc.id, 'download');
  sendSafe(res, full, doc.original_name);
}

export async function verifyDoc(req, res) {
  const doc = await db('employee_documents').where({ id: req.params.docId, employee_id: req.params.id }).first();
  if (!doc) throw new HttpError(404, 'Document not found');
  await db('employee_documents').where({ id: doc.id }).update({ verified_by: req.user.id, verified_at: db.fn.now() });
  await audit(req, 'employee_document', doc.id, 'verify');
  res.status(204).end();
}

export async function deleteDoc(req, res) {
  const doc = await db('employee_documents').where({ id: req.params.docId, employee_id: req.params.id }).first();
  if (!doc) throw new HttpError(404, 'Document not found');
  // HR can remove any document. An employee can remove their own until HR has verified it.
  const own = Number(doc.employee_id) === req.user.employeeId;
  if (!req.user.permissions.has('employee.manage') && !(own && !doc.verified_at)) throw new HttpError(403, own ? LOCKED_MSG : 'Not permitted');
  await db('employee_documents').where({ id: doc.id }).del();
  fs.rm(path.resolve(UPLOAD_ROOT, doc.file_path), { force: true }, () => {});
  await audit(req, 'employee_document', doc.id, 'delete', { type: doc.type, name: doc.original_name });
  res.status(204).end();
}

// ---- Employment history ----
export async function history(req, res) {
  await assertAccess(req.user, req.params.id, 'employee.view_all');
  const rows = await db('employment_history').where({ employee_id: req.params.id }).orderBy('effective_date', 'desc').orderBy('id', 'desc');
  res.json(rows.map((r) => ({
    ...r,
    from_value: typeof r.from_value === 'string' ? JSON.parse(r.from_value) : r.from_value,
    to_value: typeof r.to_value === 'string' ? JSON.parse(r.to_value) : r.to_value,
  })));
}

const eventSchema = z.object({
  event: z.enum(['confirmation', 'promotion', 'transfer', 'exit']),
  effective_date: dateStr.default(() => today()),
  department_id: optional(z.coerce.number().int()),
  designation_id: optional(z.coerce.number().int()),
  manager_id: optional(z.coerce.number().int()),
  note: optional(z.string().max(255)),
});

export async function addEvent(req, res) {
  const d = eventSchema.parse(req.body);
  const emp = await db('employees').where({ id: req.params.id }).first();
  if (!emp) throw new HttpError(404, 'Employee not found');
  const changes = {};
  if (d.event === 'confirmation') changes.status = 'active';
  if (d.event === 'exit') Object.assign(changes, { status: 'exited', exit_date: d.effective_date });
  if (d.event === 'promotion' && d.designation_id) changes.designation_id = d.designation_id;
  if (d.event === 'transfer') {
    if (d.department_id) changes.department_id = d.department_id;
    if (d.manager_id) { await assertNoCycle(emp.id, d.manager_id); changes.manager_id = d.manager_id; }
  }
  if (!Object.keys(changes).length) throw new HttpError(400, 'Nothing to change for this event');
  const from = Object.fromEntries(Object.keys(changes).map((k) => [k, emp[k]]));
  await db.transaction(async (trx) => {
    await trx('employees').where({ id: emp.id }).update({ ...changes, updated_at: trx.fn.now() });
    await trx('employment_history').insert({
      employee_id: emp.id, event: d.event, from_value: JSON.stringify(from), to_value: JSON.stringify(changes),
      effective_date: d.effective_date, note: d.note ?? null, approved_by: req.user.id,
    });
    if (d.event === 'exit') await trx('users').where({ employee_id: emp.id }).update({ is_active: false });
  });
  await audit(req, 'employee', emp.id, d.event, from, changes);
  await notifyEmployee(emp.id, { type: 'employment', title: `Your record was updated: ${d.event}`, link: '/profile' });
  res.status(201).json({ ok: true });
}
