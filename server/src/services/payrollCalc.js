// Indian monthly payroll maths. Pure functions: rates come from the dated statutory_rules table, never from constants.
const r2 = (n) => Math.round(n * 100) / 100;

// Latest value of each rule that is already in force on `date`.
export function rulesOn(rows, date) {
  const out = {};
  const sorted = [...rows].sort((a, b) => String(a.effective_from).slice(0, 10).localeCompare(String(b.effective_from).slice(0, 10)) || a.id - b.id);
  for (const r of sorted) {
    if (String(r.effective_from).slice(0, 10) <= date) out[r.rule_key] = Number(r.value);
  }
  return out;
}

// Maharashtra professional tax. February carries the extra rupees so the year totals Rs 2,500.
export function professionalTax(state, gender, gross, monthNo) {
  if (state !== 'MH') return 0;
  if (gender === 'female') return gross > 25000 ? (monthNo === 2 ? 300 : 200) : 0;
  if (gross <= 7500) return 0;
  if (gross <= 10000) return 175;
  return monthNo === 2 ? 300 : 200;
}

// Professional tax from the slabs a state publishes. Slabs are on monthly gross. Some states charge more in February.
export function ptFromSlabs(state, gender, gross, monthNo, slabs = []) {
  if (!state || state === 'NONE') return 0;
  const mine = slabs.filter((s) => s.state_code === state && s.active !== false && s.active !== 0);
  if (!mine.length) return 0;
  const latest = mine.map((s) => String(s.effective_from).slice(0, 10)).sort().pop();
  const current = mine.filter((s) => String(s.effective_from).slice(0, 10) === latest);
  const byGender = current.filter((s) => s.gender === gender);
  const use = byGender.length ? byGender : current.filter((s) => s.gender === 'any' || s.gender === 'male');
  const slab = use.find((s) => gross >= s.from_amount && (s.to_amount === null || s.to_amount === undefined || gross <= s.to_amount));
  if (!slab) return 0;
  return monthNo === 2 && slab.feb_amount !== null && slab.feb_amount !== undefined ? Number(slab.feb_amount) : Number(slab.monthly_amount);
}

// s = salary structure row, factor = paid days / days in month, monthNo = 1..12
// extra = { off: Set of standard earnings the company switched off, earn: [{ id, name, amount, in_wages }], ded: [{ id, name, amount }] }
export function calcPay(s, factor, rule, gender, monthNo, extra = {}) {
  const off = extra.off || new Set();
  const part = (k) => (off.has(k) ? 0 : r2(Number(s[k] || 0) * factor));
  const basic = part('basic'), da = part('da'), hra = part('hra'), special = part('allowances');
  const conveyance = part('conveyance'), travel = part('travelling_allowance'), medical = part('medical'), other = part('other_allowance');
  const earnItems = (extra.earn || []).map((c) => ({ ...c, amount: r2(Number(c.amount || 0) * factor) })).filter((c) => c.amount > 0);
  const customEarn = earnItems.reduce((n, c) => n + c.amount, 0);
  const customWage = earnItems.filter((c) => c.in_wages).reduce((n, c) => n + c.amount, 0);
  const fixedGross = r2(basic + da + hra + special + conveyance + travel + medical + other + customEarn);
  // Overtime is paid on top of salary. It is not "wages" for PF / ESIC / gratuity and it is left out of the 50% rule.
  const overtimeHours = r2(Number(extra.ot?.hours || 0));
  const overtimePay = r2(Number(extra.ot?.pay || 0));
  // One-off lines for this month (arrears, bonus, leave encashment ...). Paid in full, and not counted as wages for PF / ESIC.
  const adjEarn = (extra.adjust?.earn || []).map((a) => ({ name: a.label, kind: 'earning', amount: r2(Number(a.amount)) })).filter((a) => a.amount > 0);
  const adjDed = (extra.adjust?.ded || []).map((a) => ({ name: a.label, kind: 'deduction', amount: r2(Number(a.amount)) })).filter((a) => a.amount > 0);
  const adjEarnTotal = adjEarn.reduce((n, a) => n + a.amount, 0);
  const adjDedTotal = adjDed.reduce((n, a) => n + a.amount, 0);
  const gross = r2(fixedGross + overtimePay + adjEarnTotal);

  // Wages for statutory purposes: allowances left out of "wages" may not exceed 50% of total remuneration.
  const excluded = hra + conveyance + travel + medical + other + (customEarn - customWage);
  const addBack = Math.max(0, excluded - fixedGross * ((rule.wage_exclusion_limit ?? 50) / 100));
  const statutoryWages = r2(basic + da + special + customWage + addBack);

  const pfWages = s.pf_mode === 'none' ? 0 : s.pf_mode === 'actual' ? statutoryWages : Math.min(statutoryWages, rule.pf_wage_ceiling || 0);
  const pfEmployee = r2(pfWages * (rule.pf_employee_rate || 0) / 100);
  const employerPf = r2(pfWages * (rule.pf_employer_rate || 0) / 100);
  const epsWages = Math.min(pfWages, rule.pf_wage_ceiling || 0);
  const employerEps = r2(epsWages * (rule.eps_rate || 0) / 100);
  const employerEdli = r2(pfWages * (rule.edli_rate || 0) / 100);
  const employerAdmin = r2(pfWages * (rule.epf_admin_rate || 0) / 100);

  const esicOn = !!s.esic_applicable && statutoryWages > 0 && statutoryWages <= (rule.esic_wage_ceiling || 0);
  const esicEmployee = esicOn ? Math.ceil(statutoryWages * (rule.esic_employee_rate || 0) / 100) : 0;
  const employerEsic = esicOn ? Math.ceil(statutoryWages * (rule.esic_employer_rate || 0) / 100) : 0;

  const pt = extra.ptSlabs ? ptFromSlabs(s.pt_state, gender, gross, monthNo, extra.ptSlabs) : professionalTax(s.pt_state, gender, gross, monthNo);
  const tds = r2(Number(s.tds || 0));
  const otherDeductions = r2(Number(s.deductions || 0));
  const dedItems = (extra.ded || []).map((c) => ({ ...c, amount: r2(Number(c.amount || 0)) })).filter((c) => c.amount > 0);
  const deductions = r2(pfEmployee + esicEmployee + pt + tds + otherDeductions + adjDedTotal + dedItems.reduce((n, c) => n + c.amount, 0));

  const gratuity = r2(statutoryWages * (rule.gratuity_days || 15) / (rule.gratuity_divisor || 26) / 12);
  return {
    basic, da, hra, allowances: special, conveyance, travelling_allowance: travel, medical, other_allowance: other, overtime_hours: overtimeHours, overtime_pay: overtimePay, gross,
    statutory_wages: statutoryWages, pf_wages: r2(pfWages), pf_employee: pfEmployee, esic_employee: esicEmployee,
    professional_tax: pt, tds, other_deductions: otherDeductions, deductions, net: Math.max(0, r2(gross - deductions)),
    employer_pf: employerPf, employer_eps: employerEps, employer_edli: employerEdli, employer_admin: employerAdmin, employer_esic: employerEsic,
    items: [...earnItems.map((c) => ({ component_id: c.id, name: c.name, kind: 'earning', amount: c.amount })), ...dedItems.map((c) => ({ component_id: c.id, name: c.name, kind: 'deduction', amount: c.amount })), ...adjEarn.map((a) => ({ component_id: null, ...a })), ...adjDed.map((a) => ({ component_id: null, ...a }))],
    gratuity_provision: gratuity, employer_cost: r2(gross + employerPf + employerEdli + employerAdmin + employerEsic + gratuity),
  };
}

// A sensible default split of a monthly gross: Basic 50%, HRA 40% of Basic, fixed conveyance and medical, the rest as special allowance.
export function standardBreakup(gross) {
  const g = Math.round(Number(gross));
  const basic = Math.round(g * 0.5);
  const hra = Math.round(basic * 0.4);
  const conveyance = Math.min(1600, Math.max(0, g - basic - hra));
  const medical = Math.min(1250, Math.max(0, g - basic - hra - conveyance));
  const allowances = Math.max(0, g - basic - hra - conveyance - medical);
  return { basic, da: 0, hra, allowances, conveyance, medical, other_allowance: 0, tds: 0, pf_mode: 'ceiling', esic_applicable: g <= 21000, pt_state: 'MH', overtime_eligible: true };
}
