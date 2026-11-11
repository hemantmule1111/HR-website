// Payroll compliance foundation: second-approver control, professional tax slabs for many states, one-off payroll adjustments
// (arrears, bonus, leave encashment, gratuity), and the IDs the PF / ESIC returns need.
const D = '2020-01-01';
// state code, state name, gender, from, to (null = no upper limit), monthly amount, February amount (null = same as monthly)
const SLABS = [
  ['MH', 'Maharashtra', 'male', 0, 7500, 0, null], ['MH', 'Maharashtra', 'male', 7501, 10000, 175, null], ['MH', 'Maharashtra', 'male', 10001, null, 200, 300],
  ['MH', 'Maharashtra', 'female', 0, 25000, 0, null], ['MH', 'Maharashtra', 'female', 25001, null, 200, 300],
  ['KA', 'Karnataka', 'any', 0, 24999, 0, null], ['KA', 'Karnataka', 'any', 25000, null, 200, 300],
  ['TG', 'Telangana', 'any', 0, 15000, 0, null], ['TG', 'Telangana', 'any', 15001, 20000, 150, null], ['TG', 'Telangana', 'any', 20001, null, 200, null],
  ['AP', 'Andhra Pradesh', 'any', 0, 15000, 0, null], ['AP', 'Andhra Pradesh', 'any', 15001, 20000, 150, null], ['AP', 'Andhra Pradesh', 'any', 20001, null, 200, null],
  ['WB', 'West Bengal', 'any', 0, 10000, 0, null], ['WB', 'West Bengal', 'any', 10001, 15000, 110, null], ['WB', 'West Bengal', 'any', 15001, 25000, 130, null],
  ['WB', 'West Bengal', 'any', 25001, 40000, 150, null], ['WB', 'West Bengal', 'any', 40001, null, 200, null],
  ['GJ', 'Gujarat', 'any', 0, 12000, 0, null], ['GJ', 'Gujarat', 'any', 12001, null, 200, null],
  ['MP', 'Madhya Pradesh', 'any', 0, 18750, 0, null], ['MP', 'Madhya Pradesh', 'any', 18751, 25000, 125, null], ['MP', 'Madhya Pradesh', 'any', 25001, 33333, 167, null], ['MP', 'Madhya Pradesh', 'any', 33334, null, 208, 212],
  ['OD', 'Odisha', 'any', 0, 13304, 0, null], ['OD', 'Odisha', 'any', 13305, 25000, 125, null], ['OD', 'Odisha', 'any', 25001, null, 200, null],
  ['AS', 'Assam', 'any', 0, 10000, 0, null], ['AS', 'Assam', 'any', 10001, 15000, 150, null], ['AS', 'Assam', 'any', 15001, 25000, 180, null], ['AS', 'Assam', 'any', 25001, null, 208, null],
];

export async function up(knex) {
  await knex.schema.alterTable('employees', (t) => {
    t.string('uan', 20).nullable(); // EPF Universal Account Number
    t.string('esic_no', 20).nullable(); // ESIC insurance (IP) number
  });
  await knex.schema.alterTable('payroll_runs', (t) => { t.bigInteger('paid_by').unsigned().nullable(); });

  await knex.schema.createTable('payroll_settings', (t) => {
    t.integer('id').primary();
    t.boolean('dual_control').notNullable().defaultTo(false); // the person who approves a payroll run must not be the one who created it, and the one who pays must not be the approver
  });
  await knex('payroll_settings').insert({ id: 1 });

  await knex.schema.createTable('pt_slabs', (t) => {
    t.bigIncrements('id');
    t.string('state_code', 10).notNullable();
    t.string('state_name', 60).notNullable();
    t.string('gender', 8).notNullable().defaultTo('any'); // any | male | female
    t.integer('from_amount').notNullable().defaultTo(0); // monthly gross, rupees
    t.integer('to_amount').nullable(); // null = and above
    t.integer('monthly_amount').notNullable().defaultTo(0);
    t.integer('feb_amount').nullable(); // some states charge more in February so the year adds up
    t.date('effective_from').notNullable();
    t.boolean('active').notNullable().defaultTo(true);
    t.index(['state_code']);
  });
  for (const [state_code, state_name, gender, from_amount, to_amount, monthly_amount, feb_amount] of SLABS) {
    await knex('pt_slabs').insert({ state_code, state_name, gender, from_amount, to_amount, monthly_amount, feb_amount, effective_from: D });
  }

  await knex.schema.createTable('payroll_adjustments', (t) => {
    t.bigIncrements('id');
    t.bigInteger('employee_id').unsigned().notNullable().references('employees.id').onDelete('CASCADE');
    t.string('month', 7).notNullable(); // YYYY-MM: the payroll month it is paid in
    t.string('kind', 10).notNullable(); // earning | deduction
    t.string('label', 80).notNullable(); // printed on the payslip
    t.decimal('amount', 12, 2).notNullable();
    t.string('source', 20).notNullable().defaultTo('manual'); // manual | arrears | bonus | gratuity | leave_encashment | loan | other
    t.string('note', 255).nullable();
    t.bigInteger('created_by').unsigned().nullable();
    t.timestamps(true, true);
    t.index(['month']);
    t.index(['employee_id']);
  });
}

export async function down() {}
