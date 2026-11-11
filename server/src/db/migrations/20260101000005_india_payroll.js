// Indian salary breakup: more earning components, PF / ESIC / Professional Tax / TDS settings per salary revision,
// statutory rates kept in a dated table (never hard-coded), and the full breakup stored on every payslip.
const RULES = [
  // [rule_key, value, effective_from, note]
  ['pf_employee_rate', 12, '2000-01-01', 'Employee PF contribution (%)'],
  ['pf_employer_rate', 12, '2000-01-01', 'Employer PF contribution (%), includes the EPS share'],
  ['eps_rate', 8.33, '2000-01-01', 'Part of the employer PF that goes to EPS (%)'],
  ['pf_wage_ceiling', 15000, '2014-09-01', 'EPF wage ceiling (Rs / month)'],
  ['pf_wage_ceiling', 25000, '2026-09-17', 'EPF wage ceiling raised to Rs 25,000'],
  ['edli_rate', 0.5, '2000-01-01', 'Employer EDLI (%)'],
  ['epf_admin_rate', 0.5, '2000-01-01', 'Employer EPF administration charge (%)'],
  ['esic_employee_rate', 0.75, '2019-07-01', 'Employee ESIC (%)'],
  ['esic_employer_rate', 3.25, '2019-07-01', 'Employer ESIC (%)'],
  ['esic_wage_ceiling', 21000, '2017-01-01', 'ESIC wage eligibility ceiling (Rs / month)'],
  ['wage_exclusion_limit', 50, '2025-11-21', 'Labour Codes: excluded allowances above this % of remuneration are added back to wages'],
  ['gratuity_days', 15, '2000-01-01', 'Gratuity: days of wages per completed year'],
  ['gratuity_divisor', 26, '2000-01-01', 'Gratuity: working days in a month'],
];

export async function up(knex) {
  await knex.schema.alterTable('salary_structures', (t) => {
    t.decimal('da', 12, 2).notNullable().defaultTo(0);
    t.decimal('conveyance', 12, 2).notNullable().defaultTo(0);
    t.decimal('medical', 12, 2).notNullable().defaultTo(0);
    t.decimal('other_allowance', 12, 2).notNullable().defaultTo(0);
    t.decimal('tds', 12, 2).notNullable().defaultTo(0); // monthly income-tax (TDS) amount set by payroll
    t.string('pf_mode', 10).notNullable().defaultTo('ceiling'); // ceiling | actual | none
    t.boolean('esic_applicable').notNullable().defaultTo(false);
    t.string('pt_state', 10).notNullable().defaultTo('MH'); // MH = Maharashtra, NONE = no professional tax
  });
  // The old "fixed deductions" held PF / PT typed in by hand. They are now calculated, so it only keeps loan / advance recoveries.
  await knex('salary_structures').update({ deductions: 0 });

  await knex.schema.alterTable('payslips', (t) => {
    for (const c of ['da', 'conveyance', 'medical', 'other_allowance', 'statutory_wages', 'pf_wages', 'pf_employee', 'esic_employee',
      'professional_tax', 'tds', 'other_deductions', 'employer_pf', 'employer_eps', 'employer_edli', 'employer_admin', 'employer_esic',
      'gratuity_provision', 'employer_cost']) t.decimal(c, 12, 2).notNullable().defaultTo(0);
  });

  await knex.schema.createTable('statutory_rules', (t) => {
    t.bigIncrements('id');
    t.string('rule_key', 40).notNullable();
    t.decimal('value', 14, 4).notNullable();
    t.date('effective_from').notNullable();
    t.string('note', 255);
    t.bigInteger('created_by').unsigned();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['rule_key', 'effective_from']);
  });
  for (const [rule_key, value, effective_from, note] of RULES) await knex('statutory_rules').insert({ rule_key, value, effective_from, note });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('statutory_rules');
}
