import { z } from 'zod';
import db from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { audit } from '../services/audit.js';
import { fullName } from '../services/scope.js';
import { csv, dateStr, monthStr } from '../utils/validators.js';
import { monthRange } from '../utils/dates.js';
import { rulesOn } from '../services/payrollCalc.js';
import { currentStructure } from './payroll.js';

const r2 = (n) => Math.round(n * 100) / 100;

// ============ settings (second approver) ============
export async function getSettings(_req, res) {
  const s = await db('payroll_settings').where({ id: 1 }).first();
  res.json({ dual_control: !!s?.dual_control });
}
export async function updateSettings(req, res) {
  const { dual_control } = z.object({ dual_control: z.boolean() }).parse(req.body);
  await db('payroll_settings').where({ id: 1 }).update({ dual_control });
  await audit(req, 'payroll_settings', 1, 'update', null, { dual_control });
  res.json({ dual_control });
}

// ============ professional tax slabs ============
const slabSchema = z.object({
  state_code: z.string().trim().toUpperCase().regex(/^[A-Z]{2,10}$/, 'Use the short state code, for example KA'), state_name: z.string().trim().min(2).max(60),
  gender: z.enum(['any', 'male', 'female']).default('any'), from_amount: z.coerce.number().int().min(0), to_amount: z.coerce.number().int().min(0).nullable().optional(),
  monthly_amount: z.coerce.number().int().min(0).max(5000), feb_amount: z.coerce.number().int().min(0).max(5000).nullable().optional(), effective_from: dateStr, active: z.boolean().default(true),
}).refine((d) => d.to_amount == null || d.to_amount >= d.from_amount, { message: 'The upper limit must not be below the lower limit', path: ['to_amount'] });

export async function listSlabs(_req, res) {
  res.json((await db('pt_slabs').orderBy('state_code').orderBy('gender').orderBy('from_amount')).map((s) => ({ ...s, active: !!s.active, effective_from: String(s.effective_from).slice(0, 10) })));
}
export async function listStates(_req, res) {
  const rows = await db('pt_slabs').where({ active: true }).distinct('state_code', 'state_name').orderBy('state_name');
  res.json([...rows, { state_code: 'NONE', state_name: 'No professional tax' }]);
}
export async function addSlab(req, res) {
  const d = slabSchema.parse(req.body);
  const [id] = await db('pt_slabs').insert({ ...d, to_amount: d.to_amount ?? null, feb_amount: d.feb_amount ?? null });
  await audit(req, 'pt_slab', id, 'create', null, d);
  res.status(201).json({ id });
}
export async function updateSlab(req, res) {
  const s = await db('pt_slabs').where({ id: req.params.id }).first();
  if (!s) throw new HttpError(404, 'Slab not found');
  const d = slabSchema.parse(req.body);
  await db('pt_slabs').where({ id: s.id }).update({ ...d, to_amount: d.to_amount ?? null, feb_amount: d.feb_amount ?? null });
  await audit(req, 'pt_slab', s.id, 'update', s, d);
  res.json({ ok: true });
}
export async function deleteSlab(req, res) {
  const s = await db('pt_slabs').where({ id: req.params.id }).first();
  if (!s) throw new HttpError(404, 'Slab not found');
  await db('pt_slabs').where({ id: s.id }).del();
  await audit(req, 'pt_slab', s.id, 'delete', s);
  res.status(204).end();
}

// ============ one-off adjustments (arrears, bonus, leave encashment, gratuity ...) ============
const monthClosed = async (month) => !!(await db('payroll_runs').where({ month }).whereNot({ status: 'draft' }).first());

export async function listAdjustments(req, res) {
  const q = db('payroll_adjustments as a').join('employees as e', 'e.id', 'a.employee_id').select('a.*', 'e.first_name', 'e.last_name', 'e.emp_code').orderBy('a.id', 'desc').limit(500);
  if (req.query.month) q.where('a.month', String(req.query.month));
  const rows = await q;
  const closed = new Map();
  for (const m of new Set(rows.map((r) => r.month))) closed.set(m, await monthClosed(m));
  res.json(rows.map((r) => ({ ...r, amount: Number(r.amount), name: fullName(r), locked: closed.get(r.month) })));
}
export async function addAdjustment(req, res) {
  const d = z.object({
    employee_id: z.coerce.number().int(), month: monthStr, kind: z.enum(['earning', 'deduction']), label: z.string().trim().min(2).max(80), amount: z.coerce.number().gt(0).max(100000000),
    source: z.enum(['manual', 'arrears', 'bonus', 'gratuity', 'leave_encashment', 'loan', 'other']).default('manual'), note: z.string().max(255).optional().nullable(),
  }).parse(req.body);
  if (!(await db('employees').where({ id: d.employee_id }).first())) throw new HttpError(404, 'Employee not found');
  if (await monthClosed(d.month)) throw new HttpError(400, 'Payroll for that month is already approved, so nothing can be added. Use the next month.');
  const [id] = await db('payroll_adjustments').insert({ ...d, note: d.note || null, created_by: req.user.id });
  await audit(req, 'payroll_adjustment', id, 'create', null, d);
  res.status(201).json({ id });
}
export async function deleteAdjustment(req, res) {
  const a = await db('payroll_adjustments').where({ id: req.params.id }).first();
  if (!a) throw new HttpError(404, 'Adjustment not found');
  if (await monthClosed(a.month)) throw new HttpError(400, 'Payroll for that month is already approved, so this can no longer be removed.');
  await db('payroll_adjustments').where({ id: a.id }).del();
  await audit(req, 'payroll_adjustment', a.id, 'delete', a);
  res.status(204).end();
}

// ============ calculators ============
// Basic + DA a month, from the employee's current salary structure.
async function basicDa(employeeId) {
  const s = await currentStructure(employeeId, '9999-12-31');
  if (!s) return null;
  const off = new Set((await db('salary_components').where({ is_standard: true, active: false })).map((c) => c.code));
  return (off.has('basic') ? 0 : Number(s.basic || 0)) + (off.has('da') ? 0 : Number(s.da || 0));
}
const employeeWith = (id) => db('employees').where({ id }).first();

// Gratuity (Payment of Gratuity Act): 15/26 x last drawn (basic + DA) x completed years, more than 6 extra months counts as a year, after 5 years of service, up to Rs 20 lakh.
export async function calcGratuity(req, res) {
  const d = z.object({ employee_id: z.coerce.number().int(), last_working_day: dateStr.optional(), early_exit_reason: z.enum(['none', 'death', 'disability']).default('none') }).parse(req.body);
  const e = await employeeWith(d.employee_id);
  if (!e) throw new HttpError(404, 'Employee not found');
  const end = d.last_working_day || (e.exit_date ? String(e.exit_date).slice(0, 10) : null);
  if (!end) throw new HttpError(400, 'Enter the last working day');
  const start = String(e.join_date).slice(0, 10);
  if (end < start) throw new HttpError(400, 'The last working day is before the joining date');
  const wage = await basicDa(e.id);
  if (wage === null) throw new HttpError(400, 'This employee has no salary structure');
  const rule = rulesOn(await db('statutory_rules'), end);
  const a = new Date(`${start}T00:00:00Z`); const b = new Date(`${end}T00:00:00Z`);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  const anchor = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + months, a.getUTCDate()));
  if (anchor > b) months -= 1; // not a full month yet
  const years = Math.floor(months / 12);
  const extraMonths = months - years * 12;
  const extraDays = Math.round((b - new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + months, a.getUTCDate()))) / 86400000);
  const counted = years + (extraMonths > 6 || (extraMonths === 6 && extraDays > 0) ? 1 : 0);
  const eligible = years >= 5 || d.early_exit_reason !== 'none';
  const raw = (wage * (rule.gratuity_days || 15) / (rule.gratuity_divisor || 26)) * counted;
  const cap = 2000000;
  res.json({
    employee: { id: e.id, name: fullName(e), emp_code: e.emp_code }, joined: start, last_working_day: end, service: { years, months: extraMonths, counted_years: counted },
    last_drawn_basic_da: r2(wage), eligible, cap, amount: eligible ? r2(Math.min(raw, cap)) : 0, uncapped: r2(raw),
    note: eligible ? (raw > cap ? 'Capped at Rs 20,00,000.' : 'Gratuity is tax-free up to the limit for most employees; confirm with your accountant.') : 'Not payable: less than 5 years of service (unless the exit is due to death or disability).',
  });
}

// Leave encashment: (basic + DA) / 30 per day.
export async function calcLeaveEncashment(req, res) {
  const d = z.object({ employee_id: z.coerce.number().int(), days: z.coerce.number().gt(0).max(365) }).parse(req.body);
  const e = await employeeWith(d.employee_id);
  if (!e) throw new HttpError(404, 'Employee not found');
  const wage = await basicDa(e.id);
  if (wage === null) throw new HttpError(400, 'This employee has no salary structure');
  const perDay = wage / 30;
  res.json({ employee: { id: e.id, name: fullName(e), emp_code: e.emp_code }, last_drawn_basic_da: r2(wage), per_day: r2(perDay), days: d.days, amount: r2(perDay * d.days) });
}

// Bonus (Payment of Bonus Act): wage for the calculation is capped (Rs 7,000, or the minimum wage if higher), only people earning up to Rs 21,000 a month qualify.
export async function calcBonus(req, res) {
  const d = z.object({ fy_start_year: z.coerce.number().int().min(2000).max(2100), percent: z.coerce.number().min(8.33).max(20).default(8.33), wage_ceiling: z.coerce.number().min(1000).default(7000), eligibility_limit: z.coerce.number().min(1000).default(21000) }).parse(req.body);
  const from = `${d.fy_start_year}-04-01`; const to = `${d.fy_start_year + 1}-03-31`;
  const emps = await db('employees').where('join_date', '<=', to).where((q) => q.whereNull('exit_date').orWhere('exit_date', '>=', from)).orderBy('first_name');
  const rows = [];
  for (const e of emps) {
    const wage = await basicDa(e.id);
    if (wage === null) continue;
    const start = String(e.join_date).slice(0, 10) > from ? String(e.join_date).slice(0, 10) : from;
    const end = e.exit_date && String(e.exit_date).slice(0, 10) < to ? String(e.exit_date).slice(0, 10) : to;
    const sd = new Date(`${start}T00:00:00Z`); const ed = new Date(`${end}T00:00:00Z`);
    const months = Math.min(12, Math.max(0, (ed.getUTCFullYear() - sd.getUTCFullYear()) * 12 + (ed.getUTCMonth() - sd.getUTCMonth()) + 1));
    const eligible = wage <= d.eligibility_limit && months >= 1;
    const base = Math.min(wage, d.wage_ceiling);
    rows.push({ employee_id: e.id, name: fullName(e), emp_code: e.emp_code, basic_da: r2(wage), calculation_wage: r2(base), months, eligible, amount: eligible ? r2((base * d.percent / 100) * months) : 0 });
  }
  res.json({ financial_year: `${d.fy_start_year}-${String(d.fy_start_year + 1).slice(2)}`, percent: d.percent, rows, total: r2(rows.reduce((n, r) => n + r.amount, 0)) });
}

// ============ statutory files and bank file ============
const clean = (s) => String(s ?? '').replace(/[#~\r\n]/g, ' ').trim();
const onlyAscii = (s) => clean(s).normalize('NFKD').replace(/[^\x20-\x7e]/g, '').toUpperCase();

export async function exportRun(req, res) {
  const run = await db('payroll_runs').where({ id: req.params.id }).first();
  if (!run) throw new HttpError(404, 'Run not found');
  if (run.status === 'draft') throw new HttpError(400, 'Approve the payroll run first. These files are made from approved figures.');
  const kind = req.params.kind;
  if (!['ecr', 'esic', 'pt', 'bank'].includes(kind)) throw new HttpError(404, 'Unknown file');
  const { to } = monthRange(run.month);
  const rule = rulesOn(await db('statutory_rules'), to);
  const rows = await db('payslips as p').join('employees as e', 'e.id', 'p.employee_id').where('p.run_id', run.id)
    .select('p.*', 'e.first_name', 'e.last_name', 'e.emp_code', 'e.uan', 'e.esic_no', 'e.bank_name', 'e.bank_account', 'e.ifsc').orderBy('e.first_name');
  const num = (v) => Number(v || 0);
  const warnings = [];
  let lines = []; let name; let type = 'text/csv; charset=utf-8';
  if (kind === 'ecr') {
    // EPFO "ECR" text file: one line per member, fields separated by #~#
    const ceil = rule.pf_wage_ceiling || 15000;
    for (const p of rows.filter((x) => num(x.pf_employee) > 0 || num(x.pf_wages) > 0)) {
      if (!p.uan) warnings.push(`${fullName(p)} (${p.emp_code}) has no UAN`);
      const epf = Math.round(num(p.pf_wages)); const eps = Math.min(epf, ceil);
      lines.push([clean(p.uan), onlyAscii(fullName(p)), Math.round(num(p.gross)), epf, eps, eps, Math.round(num(p.pf_employee)), Math.round(num(p.employer_eps)), Math.round(num(p.employer_pf)) - Math.round(num(p.employer_eps)), Math.round(num(p.lop_days)), 0].join('#~#'));
    }
    name = `ECR-${run.month}.txt`; type = 'text/plain; charset=utf-8';
    var body = `${lines.join('\r\n')}\r\n`;
  } else if (kind === 'esic') {
    const head = ['IP Number', 'IP Name', 'No of days for which wages paid/payable during the month', 'Total monthly wages', 'Reason code for zero working days (numeric only; provide 0 for none)', 'Last working day'];
    const out = [];
    for (const p of rows.filter((x) => num(x.esic_employee) > 0 || num(x.employer_esic) > 0)) {
      if (!p.esic_no) warnings.push(`${fullName(p)} (${p.emp_code}) has no ESIC IP number`);
      out.push({ a: p.esic_no || '', b: fullName(p), c: Math.round(num(p.paid_days)), d: Math.round(num(p.statutory_wages) || num(p.gross)), e: 0, f: '' });
    }
    name = `ESIC-${run.month}.csv`;
    var body = csv(out, head.map((label, i) => ({ key: 'abcdef'[i], label })));
  } else if (kind === 'pt') {
    const out = [];
    const states = new Map((await db('pt_slabs').distinct('state_code', 'state_name')).map((s) => [s.state_code, s.state_name]));
    const structs = new Map();
    for (const p of rows.filter((x) => num(x.professional_tax) > 0)) {
      const s = await currentStructure(p.employee_id, to);
      structs.set(p.employee_id, s?.pt_state || '');
      out.push({ state: states.get(s?.pt_state) || s?.pt_state || '', code: p.emp_code, name: fullName(p), gross: num(p.gross), pt: num(p.professional_tax) });
    }
    out.sort((a, b) => a.state.localeCompare(b.state));
    out.push({ state: 'TOTAL', code: '', name: '', gross: '', pt: r2(out.reduce((n, r) => n + r.pt, 0)) });
    name = `Professional-tax-${run.month}.csv`;
    var body = csv(out, [{ key: 'state', label: 'State' }, { key: 'code', label: 'Employee code' }, { key: 'name', label: 'Employee' }, { key: 'gross', label: 'Gross salary' }, { key: 'pt', label: 'Professional tax' }]);
  } else {
    const out = [];
    for (const p of rows.filter((x) => num(x.net) > 0)) {
      if (!p.bank_account || !p.ifsc) { warnings.push(`${fullName(p)} (${p.emp_code}) has no bank account or IFSC`); continue; }
      out.push({ name: fullName(p), acc: p.bank_account, ifsc: String(p.ifsc).toUpperCase(), amount: r2(num(p.net)), narr: `Salary ${run.month}`, code: p.emp_code, bank: p.bank_name || '' });
    }
    name = `Bank-transfer-${run.month}.csv`;
    var body = csv(out, [{ key: 'name', label: 'Beneficiary name' }, { key: 'acc', label: 'Account number' }, { key: 'ifsc', label: 'IFSC' }, { key: 'amount', label: 'Amount' }, { key: 'narr', label: 'Narration' }, { key: 'code', label: 'Employee code' }, { key: 'bank', label: 'Bank' }]);
  }
  if (req.query.check === '1') return res.json({ kind, file: name, rows: kind === 'ecr' ? lines.length : body.split('\n').length - 2, warnings });
  await audit(req, 'payroll_run', run.id, `export_${kind}`);
  res.set({ 'Content-Type': type, 'Content-Disposition': `attachment; filename="${name}"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
  res.send(kind === 'ecr' ? body : `﻿${body}`);
}
