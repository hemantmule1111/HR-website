import { z } from 'zod';
import db from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { audit } from '../services/audit.js';
import { fullName } from '../services/scope.js';
import { dayStatuses } from '../services/attendance.js';
import { notifyEmployee } from '../services/notify.js';
import { csv, dateStr, monthStr } from '../utils/validators.js';
import { monthRange, currentMonth } from '../utils/dates.js';
import { calcPay, rulesOn } from '../services/payrollCalc.js';
import { getPolicy, hourlyRate, approvedFor } from '../services/overtime.js';

const r2 = (n) => Math.round(n * 100) / 100;

export async function currentStructure(employeeId, date) {
  return db('salary_structures').where({ employee_id: employeeId }).where('effective_from', '<=', date).orderBy('effective_from', 'desc').orderBy('id', 'desc').first();
}

// ---- Salary structures (history kept, never overwritten) ----
const structSchema = z.object({
  employee_id: z.coerce.number().int(),
  basic: z.coerce.number().min(0), hra: z.coerce.number().min(0).default(0),
  da: z.coerce.number().min(0).default(0), conveyance: z.coerce.number().min(0).default(0), travelling_allowance: z.coerce.number().min(0).default(0), medical: z.coerce.number().min(0).default(0),
  allowances: z.coerce.number().min(0).default(0), other_allowance: z.coerce.number().min(0).default(0),
  deductions: z.coerce.number().min(0).default(0), tds: z.coerce.number().min(0).default(0), overtime_eligible: z.union([z.boolean(), z.number()]).transform(Boolean).default(true),
  pf_mode: z.enum(['ceiling', 'actual', 'none']).default('ceiling'), esic_applicable: z.union([z.boolean(), z.number()]).transform(Boolean).default(false),
  pt_state: z.string().trim().toUpperCase().regex(/^[A-Z]{2,10}$/).default('MH'), // a state code from the professional tax slabs, or NONE
  items: z.array(z.object({ component_id: z.coerce.number().int(), amount: z.coerce.number().min(0) })).default([]),
  effective_from: dateStr, note: z.string().max(255).optional(),
});

export async function listStructures(req, res) {
  const empId = Number(req.query.employeeId || req.user.employeeId);
  if (!req.user.permissions.has('payroll.view_all') && empId !== req.user.employeeId) throw new HttpError(403, 'Not permitted');
  const rows = await db('salary_structures').where({ employee_id: empId }).orderBy('effective_from', 'desc').orderBy('id', 'desc');
  const items = rows.length ? await db('salary_structure_items').whereIn('structure_id', rows.map((r) => r.id)) : [];
  res.json(rows.map((r) => ({ ...r, items: items.filter((i) => i.structure_id === r.id).map((i) => ({ component_id: i.component_id, amount: Number(i.amount) })) })));
}

export async function addStructure(req, res) {
  const { items, ...d } = structSchema.parse(req.body);
  if (!(await db('employees').where({ id: d.employee_id }).first())) throw new HttpError(404, 'Employee not found');
  if (d.pt_state !== 'NONE' && !(await db('pt_slabs').where({ state_code: d.pt_state, active: true }).first())) throw new HttpError(400, 'Unknown professional tax state. Add its slabs on the Master sheet first.');
  const valid = new Set((await db('salary_components').where({ is_standard: false }).select('id')).map((c) => c.id));
  if (items.some((i) => !valid.has(i.component_id))) throw new HttpError(400, 'Unknown salary category');
  const [id] = await db('salary_structures').insert({ ...d, created_by: req.user.id });
  const toSave = items.filter((i) => i.amount > 0).map((i) => ({ structure_id: id, component_id: i.component_id, amount: i.amount }));
  if (toSave.length) await db('salary_structure_items').insert(toSave);
  await audit(req, 'salary_structure', id, 'create', null, { ...d, items });
  res.status(201).json({ id });
}

// ---- Payroll runs ----
export async function compute(run) {
  const { from, to, days } = monthRange(run.month);
  const emps = await db('employees').where('join_date', '<=', to).where((q) => q.whereNull('exit_date').orWhere('exit_date', '>=', from)).orderBy('id');
  const slips = [];
  const rule = rulesOn(await db('statutory_rules'), to);
  const comps = await db('salary_components');
  const off = new Set(comps.filter((c) => c.is_standard && !c.active).map((c) => c.code));
  const policy = await getPolicy();
  const ptSlabs = await db('pt_slabs').where({ active: true }).where('effective_from', '<=', to);
  const adjustments = await db('payroll_adjustments').where({ month: run.month });
  const custom = new Map(comps.filter((c) => !c.is_standard && c.active).map((c) => [c.id, c]));
  for (const e of emps) {
    const s = await currentStructure(e.id, to);
    if (!s) continue;
    const paid = (await dayStatuses(e, from, to)).reduce((sum, d) => sum + d.paid, 0);
    const factor = Math.min(1, paid / days);
    const mine = (await db('salary_structure_items').where({ structure_id: s.id })).filter((i) => custom.has(i.component_id))
      .map((i) => ({ id: i.component_id, name: custom.get(i.component_id).name, amount: i.amount, in_wages: !!custom.get(i.component_id).in_wages, kind: custom.get(i.component_id).kind }));
    const earn = mine.filter((m) => m.kind === 'earning');
    // Overtime: the approved hours in this month, paid at the rate fixed when each request was approved.
    const ot = policy.enabled && s.overtime_eligible ? await approvedFor(e.id, from, to, hourlyRate(s, policy, off, earn)) : { hours: 0, pay: 0 };
    const pay = calcPay(s, factor, rule, e.gender, Number(run.month.slice(5, 7)), { off, earn, ded: mine.filter((m) => m.kind === 'deduction'), ot, ptSlabs, adjust: { earn: adjustments.filter((a) => a.employee_id === e.id && a.kind === 'earning'), ded: adjustments.filter((a) => a.employee_id === e.id && a.kind === 'deduction') } });
    slips.push({ run_id: run.id, employee_id: e.id, total_days: days, paid_days: paid, lop_days: Math.max(0, days - paid), ...pay });
  }
  return slips;
}

// A payslip row plus its lines for the categories the company added.
export async function saveSlips(conn, slips) {
  for (const { items = [], ...slip } of slips) {
    const [id] = await conn('payslips').insert(slip);
    if (items.length) await conn('payslip_items').insert(items.map((i) => ({ ...i, payslip_id: id })));
  }
}

export async function listRuns(_req, res) {
  const runs = await db('payroll_runs as r')
    .leftJoin('payslips as p', 'p.run_id', 'r.id')
    .groupBy('r.id')
    .select('r.*')
    .count({ employees: 'p.id' })
    .sum({ net_total: 'p.net' })
    .orderBy('r.month', 'desc');
  res.json(runs.map((r) => ({ ...r, employees: Number(r.employees), net_total: Number(r.net_total || 0) })));
}

export async function createRun(req, res) {
  const { month } = z.object({ month: monthStr }).parse(req.body);
  if (month > currentMonth()) throw new HttpError(400, 'Cannot run payroll for a future month');
  if (await db('payroll_runs').where({ month }).first()) throw new HttpError(409, 'Payroll for this month already exists');
  // Compute outside the transaction (it reads via the shared pool); the run id is only a label on each slip.
  const [runId] = await db('payroll_runs').insert({ month, created_by: req.user.id });
  try {
    const slips = await compute({ id: runId, month });
    if (!slips.length) throw new HttpError(400, 'No employees with a salary structure for this month');
    await saveSlips(db, slips);
  } catch (e) {
    await db('payroll_runs').where({ id: runId }).del();
    throw e;
  }
  await audit(req, 'payroll_run', runId, 'create', null, { month });
  res.status(201).json({ id: runId });
}

export async function recompute(req, res) {
  const run = await db('payroll_runs').where({ id: req.params.id }).first();
  if (!run) throw new HttpError(404, 'Run not found');
  if (run.status !== 'draft') throw new HttpError(400, 'Only draft runs can be recomputed');
  const slips = await compute(run);
  await db.transaction(async (trx) => {
    await trx('payslips').where({ run_id: run.id }).del();
    await saveSlips(trx, slips);
  });
  await audit(req, 'payroll_run', run.id, 'recompute');
  res.json({ ok: true });
}

export async function advanceRun(req, res) {
  const { action } = z.object({ action: z.enum(['approve', 'pay']) }).parse(req.body);
  const run = await db('payroll_runs').where({ id: req.params.id }).first();
  if (!run) throw new HttpError(404, 'Run not found');
  const next = { approve: ['draft', 'approved'], pay: ['approved', 'paid'] }[action];
  if (run.status !== next[0]) throw new HttpError(400, `Run must be ${next[0]} to ${action}`);
  // Second approver: when switched on, the person who created the run cannot approve it, and the approver cannot be the one who marks it paid.
  const dual = !!(await db('payroll_settings').where({ id: 1 }).first())?.dual_control;
  if (dual && action === 'approve' && run.created_by === req.user.id) throw new HttpError(403, 'Second approver needed: the person who created this payroll cannot approve it. Ask another payroll approver.');
  if (dual && action === 'pay' && run.approved_by === req.user.id) throw new HttpError(403, 'Second approver needed: the person who approved this payroll cannot also mark it as paid.');
  await db('payroll_runs').where({ id: run.id }).update(action === 'approve' ? { status: 'approved', approved_by: req.user.id, updated_at: db.fn.now() } : { status: 'paid', paid_by: req.user.id, updated_at: db.fn.now() });
  await audit(req, 'payroll_run', run.id, action, { status: run.status }, { status: next[1] });
  if (action === 'pay') {
    const slips = await db('payslips').where({ run_id: run.id }).select('employee_id');
    for (const s of slips) await notifyEmployee(s.employee_id, { type: 'payroll', title: `Your payslip for ${run.month} is ready`, link: '/payslips' });
  }
  res.json({ ok: true });
}

export async function deleteRun(req, res) {
  const run = await db('payroll_runs').where({ id: req.params.id }).first();
  if (!run) throw new HttpError(404, 'Run not found');
  if (run.status !== 'draft') throw new HttpError(400, 'Only draft runs can be deleted');
  await db('payroll_runs').where({ id: run.id }).del();
  await audit(req, 'payroll_run', run.id, 'delete', run);
  res.status(204).end();
}

export async function runPayslips(req, res) {
  const run = await db('payroll_runs').where({ id: req.params.id }).first();
  if (!run) throw new HttpError(404, 'Run not found');
  const rows = (await db('payslips as p').join('employees as e', 'e.id', 'p.employee_id').where('p.run_id', run.id)
    .select('p.*', 'e.first_name', 'e.last_name', 'e.emp_code').orderBy('e.first_name'))
    .map((p) => ({ ...p, name: fullName(p) }));
  if (req.query.format === 'csv') {
    const cols = ['emp_code:Code', 'name:Employee', 'paid_days:Paid days', 'lop_days:LOP days', 'basic:Basic', 'da:DA', 'hra:HRA', 'allowances:Special allowance', 'conveyance:Conveyance', 'travelling_allowance:Travelling allowance', 'medical:Medical', 'other_allowance:Other allowance', 'overtime_hours:Overtime hours', 'overtime_pay:Overtime pay', 'gross:Gross', 'pf_employee:PF (employee)', 'esic_employee:ESIC (employee)', 'professional_tax:Professional tax', 'tds:TDS', 'other_deductions:Other deductions', 'deductions:Total deductions', 'net:Net pay', 'employer_pf:Employer PF', 'employer_edli:EDLI', 'employer_admin:PF admin', 'employer_esic:Employer ESIC', 'gratuity_provision:Gratuity provision', 'employer_cost:Employer cost']
      .map((c) => { const [key, label] = c.split(':'); return { key, label }; });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="payroll-${run.month}.csv"`);
    return res.send(csv(rows, cols));
  }
  res.json({ run, payslips: rows });
}

// ---- Employee-facing payslips (only approved/paid runs) ----
export async function myPayslips(req, res) {
  if (!req.user.employeeId) return res.json([]);
  res.json(await db('payslips as p').join('payroll_runs as r', 'r.id', 'p.run_id')
    .where('p.employee_id', req.user.employeeId).whereIn('r.status', ['approved', 'paid'])
    .select('p.*', 'r.month', 'r.status').orderBy('r.month', 'desc'));
}

export async function getPayslip(req, res) {
  const p = await db('payslips as p').join('payroll_runs as r', 'r.id', 'p.run_id').where('p.id', req.params.id).select('p.*', 'r.month', 'r.status').first();
  if (!p) throw new HttpError(404, 'Payslip not found');
  const own = p.employee_id === req.user.employeeId && ['approved', 'paid'].includes(p.status);
  if (!own && !req.user.permissions.has('payroll.view_all')) throw new HttpError(403, 'Not permitted');
  const e = await db('employees as e').leftJoin('departments as d', 'd.id', 'e.department_id').leftJoin('designations as g', 'g.id', 'e.designation_id')
    .where('e.id', p.employee_id).select('e.*', 'd.name as department', 'g.title as designation').first();
  const items = await db('payslip_items').where({ payslip_id: p.id }).orderBy('id');
  res.json({ ...p, items: items.map((i) => ({ name: i.name, kind: i.kind, amount: Number(i.amount) })), employee: { name: fullName(e), emp_code: e.emp_code, department: e.department, designation: e.designation, join_date: e.join_date, bank_account: e.bank_account ? `••••${String(e.bank_account).slice(-4)}` : null } });
}

// ---- Statutory rates (dated; history is kept so old payrolls stay reproducible) ----
const ruleSchema = z.object({ rule_key: z.string().min(1).max(40), value: z.coerce.number().min(0), effective_from: dateStr, note: z.string().max(255).optional() });

export async function listRules(_req, res) {
  res.json(await db('statutory_rules').orderBy('rule_key').orderBy('effective_from', 'desc').orderBy('id', 'desc'));
}

export async function addRule(req, res) {
  const d = ruleSchema.parse(req.body);
  if (!(await db('statutory_rules').where({ rule_key: d.rule_key }).first())) throw new HttpError(400, 'Unknown rule');
  const [id] = await db('statutory_rules').insert({ ...d, created_by: req.user.id });
  await audit(req, 'statutory_rule', id, 'create', null, d);
  res.status(201).json({ id });
}
