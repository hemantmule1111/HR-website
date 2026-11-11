import { z } from 'zod';
import db from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { audit } from '../services/audit.js';
import { fullName } from '../services/scope.js';
import { notifyEmployee } from '../services/notify.js';
import { dateStr } from '../utils/validators.js';
import { today } from '../utils/dates.js';
import { currentStructure } from './payroll.js';

const isHr = (req) => req.user.permissions.has('employee.manage');
const PREFIX = { offer: 'OFR', appointment: 'APT', experience: 'EXP', relieving: 'REL', custom: 'LTR' };
export const PLACEHOLDERS = [
  ['employee_name', 'Full name'], ['first_name', 'First name'], ['employee_code', 'Employee code'], ['designation', 'Designation'], ['department', 'Department'],
  ['joining_date', 'Date of joining'], ['last_working_day', 'Last working day'], ['resignation_date', 'Resignation date'], ['work_location', 'Work location'],
  ['manager_name', 'Reporting manager'], ['employment_type', 'Employment type'], ['salary_monthly', 'Monthly gross salary'], ['salary_annual', 'Annual gross salary'],
  ['probation_months', 'Probation (months)'], ['notice_period', 'Notice period'], ['company_name', 'Company name'], ['company_address', 'Company address'], ['today', "Today's date"],
  ['signatory_name', 'Signatory name'], ['signatory_title', 'Signatory title'],
];

const longDate = (v) => (v ? new Date(`${String(v).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : null);
const rupees = (n) => `Rs. ${Math.round(n).toLocaleString('en-IN')}`;

// Everything a letter can mention, taken from the employee, their current salary and the company profile.
async function variables(employeeId, extra = {}) {
  const e = await db('employees as e').leftJoin('departments as d', 'd.id', 'e.department_id').leftJoin('designations as g', 'g.id', 'e.designation_id')
    .leftJoin('employees as m', 'm.id', 'e.manager_id').where('e.id', employeeId)
    .select('e.*', 'd.name as department', 'g.title as designation', 'm.first_name as m_first', 'm.last_name as m_last').first();
  if (!e) throw new HttpError(404, 'Employee not found');
  const co = (await db('company_profile').where({ id: 1 }).first()) || {};
  let monthly = null;
  const s = await currentStructure(e.id, '9999-12-31');
  if (s) {
    const comps = await db('salary_components');
    const off = new Set(comps.filter((c) => c.is_standard && !c.active).map((c) => c.code));
    const live = new Set(comps.filter((c) => !c.is_standard && c.active && c.kind === 'earning').map((c) => c.id));
    const std = ['basic', 'da', 'hra', 'allowances', 'conveyance', 'travelling_allowance', 'medical', 'other_allowance'].reduce((n, k) => n + (off.has(k) ? 0 : Number(s[k] || 0)), 0);
    const custom = (await db('salary_structure_items').where({ structure_id: s.id })).filter((i) => live.has(i.component_id)).reduce((n, i) => n + Number(i.amount || 0), 0);
    monthly = std + custom;
  }
  const v = {
    employee_name: fullName(e), first_name: e.first_name, employee_code: e.emp_code, designation: e.designation, department: e.department,
    joining_date: longDate(e.join_date), last_working_day: longDate(extra.last_working_day || e.exit_date), resignation_date: longDate(extra.resignation_date),
    work_location: e.work_location, manager_name: e.m_first ? `${e.m_first} ${e.m_last || ''}`.trim() : null,
    employment_type: String(e.employment_type || '').replace('_', ' '),
    salary_monthly: monthly ? rupees(monthly) : null, salary_annual: monthly ? rupees(monthly * 12) : null,
    probation_months: extra.probation_months || '6', notice_period: extra.notice_period || '30 days',
    company_name: co.name, company_address: co.address, today: longDate(today()),
    signatory_name: extra.signatory_name || co.signatory_name, signatory_title: extra.signatory_title || co.signatory_title,
  };
  return { v, employee: e };
}

export const render = (text, v) => String(text).replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in v ? (v[k] ? String(v[k]) : '[not set]') : m));

// ---- templates ----
const templateSchema = z.object({
  type: z.enum(['offer', 'appointment', 'experience', 'relieving', 'custom']), name: z.string().trim().min(2).max(100),
  title: z.string().trim().min(2).max(150), body: z.string().trim().min(10).max(10000), active: z.boolean().default(true),
});

export async function listTemplates(_req, res) {
  res.json({ templates: (await db('letter_templates').orderBy('id')).map((t) => ({ ...t, is_default: !!t.is_default, active: !!t.active })), placeholders: PLACEHOLDERS });
}
export async function createTemplate(req, res) {
  const d = templateSchema.parse(req.body);
  const [id] = await db('letter_templates').insert({ ...d, is_default: false });
  await audit(req, 'letter_template', id, 'create', null, { name: d.name });
  res.status(201).json({ id });
}
export async function updateTemplate(req, res) {
  const t = await db('letter_templates').where({ id: req.params.id }).first();
  if (!t) throw new HttpError(404, 'Template not found');
  const d = templateSchema.partial().parse(req.body);
  if (t.is_default && d.type && d.type !== t.type) throw new HttpError(400, 'The type of a built-in template cannot be changed');
  await db('letter_templates').where({ id: t.id }).update({ ...d, updated_at: db.fn.now() });
  await audit(req, 'letter_template', t.id, 'update', null, { name: d.name || t.name });
  res.json({ ok: true });
}
export async function deleteTemplate(req, res) {
  const t = await db('letter_templates').where({ id: req.params.id }).first();
  if (!t) throw new HttpError(404, 'Template not found');
  if (t.is_default) throw new HttpError(400, 'The built-in templates cannot be deleted. Switch it off instead.');
  await db('letter_templates').where({ id: t.id }).del();
  await audit(req, 'letter_template', t.id, 'delete', { name: t.name });
  res.status(204).end();
}

// ---- letters ----
const extraSchema = z.object({
  signatory_name: z.string().max(100).optional(), signatory_title: z.string().max(100).optional(), last_working_day: dateStr.optional().nullable(),
  resignation_date: dateStr.optional().nullable(), probation_months: z.string().max(3).optional(), notice_period: z.string().max(40).optional(),
}).default({});

// The wording filled in for one employee, for HR to read and adjust before issuing.
export async function preview(req, res) {
  const d = z.object({ employee_id: z.coerce.number().int(), template_id: z.coerce.number().int(), extra: extraSchema }).parse(req.body);
  const t = await db('letter_templates').where({ id: d.template_id }).first();
  if (!t) throw new HttpError(404, 'Template not found');
  const { v } = await variables(d.employee_id, d.extra);
  res.json({ title: render(t.title, v), body: render(t.body, v), type: t.type, signatory_name: v.signatory_name, signatory_title: v.signatory_title, missing: render(t.body, v).includes('[not set]') });
}

async function nextReference(type, year) {
  const prefix = `${PREFIX[type] || 'LTR'}/${year}/`;
  const last = await db('letters').where('reference_no', 'like', `${prefix}%`).orderBy('id', 'desc').first();
  let n = last ? Number(String(last.reference_no).split('/').pop()) + 1 : 1;
  while (await db('letters').where({ reference_no: `${prefix}${String(n).padStart(4, '0')}` }).first()) n += 1;
  return `${prefix}${String(n).padStart(4, '0')}`;
}

export async function createLetter(req, res) {
  const d = z.object({
    employee_id: z.coerce.number().int(), template_id: z.coerce.number().int().optional().nullable(), type: z.enum(['offer', 'appointment', 'experience', 'relieving', 'custom']).default('custom'),
    title: z.string().trim().min(2).max(150), body: z.string().trim().min(10).max(10000), issued_on: dateStr.optional(),
    signatory_name: z.string().max(100).optional().nullable(), signatory_title: z.string().max(100).optional().nullable(),
  }).parse(req.body);
  const emp = await db('employees').where({ id: d.employee_id }).first();
  if (!emp) throw new HttpError(404, 'Employee not found');
  if (/\{\{\s*\w+\s*\}\}/.test(d.body)) throw new HttpError(400, 'The letter still contains a {{placeholder}}. Remove or replace it before issuing.');
  const issued_on = d.issued_on || today();
  const reference_no = await nextReference(d.type, issued_on.slice(0, 4));
  const [id] = await db('letters').insert({ ...d, issued_on, reference_no, issued_by: req.user.id });
  await audit(req, 'letter', id, 'issue', null, { employee_id: emp.id, reference_no, type: d.type });
  await notifyEmployee(emp.id, { type: 'employment', title: `A letter was issued to you: ${d.title}`, link: `/letters/${id}` });
  res.status(201).json({ id, reference_no });
}

export async function listLetters(req, res) {
  const q = db('letters as l').join('employees as e', 'e.id', 'l.employee_id').select('l.id', 'l.type', 'l.title', 'l.reference_no', 'l.issued_on', 'l.employee_id', 'e.first_name', 'e.last_name', 'e.emp_code').orderBy('l.id', 'desc').limit(300);
  if (isHr(req)) { if (req.query.employee_id) q.where('l.employee_id', Number(req.query.employee_id)); } else q.where('l.employee_id', req.user.employeeId || 0);
  if (req.query.type) q.where('l.type', String(req.query.type));
  res.json((await q).map((l) => ({ ...l, name: fullName(l) })));
}

export async function getLetter(req, res) {
  const l = await db('letters as l').join('employees as e', 'e.id', 'l.employee_id').where('l.id', req.params.id).select('l.*', 'e.first_name', 'e.last_name', 'e.emp_code').first();
  if (!l || (!isHr(req) && l.employee_id !== req.user.employeeId)) throw new HttpError(404, 'Letter not found');
  res.json({ ...l, name: fullName(l) });
}

export async function deleteLetter(req, res) {
  const l = await db('letters').where({ id: req.params.id }).first();
  if (!l) throw new HttpError(404, 'Letter not found');
  await db('letters').where({ id: l.id }).del();
  await audit(req, 'letter', l.id, 'delete', { reference_no: l.reference_no, employee_id: l.employee_id });
  res.status(204).end();
}
