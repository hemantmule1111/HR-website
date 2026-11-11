// Overtime: company policy (set on the Master sheet), employee requests, and the pay that lands on the payslip.
export async function up(knex) {
  await knex.schema.createTable('overtime_settings', (t) => {
    t.integer('id').primary();
    t.boolean('enabled').notNullable().defaultTo(true);
    t.string('basis', 10).notNullable().defaultTo('basic_da'); // pay per hour is worked out from: basic | basic_da | gross
    t.decimal('hours_per_day', 4, 2).notNullable().defaultTo(8);
    t.decimal('days_per_month', 4, 1).notNullable().defaultTo(26);
    t.decimal('rate_weekday', 4, 2).notNullable().defaultTo(2); // x ordinary hourly rate (Factories Act: double)
    t.decimal('rate_weekoff', 4, 2).notNullable().defaultTo(2);
    t.decimal('rate_holiday', 4, 2).notNullable().defaultTo(2);
    t.integer('min_minutes').notNullable().defaultTo(30); // shorter requests are refused
    t.decimal('max_hours_day', 4, 2).notNullable().defaultTo(4);
    t.decimal('max_hours_month', 5, 2).notNullable().defaultTo(50);
    t.integer('max_back_days').notNullable().defaultTo(7); // how far back a request may be raised
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });
  await knex('overtime_settings').insert({ id: 1 });

  await knex.schema.createTable('overtime_requests', (t) => {
    t.bigIncrements('id');
    t.bigInteger('employee_id').unsigned().notNullable().references('employees.id').onDelete('CASCADE');
    t.date('date').notNullable();
    t.string('start_time', 5).notNullable();
    t.string('end_time', 5).notNullable();
    t.decimal('hours', 5, 2).notNullable();
    t.string('day_type', 10).notNullable().defaultTo('weekday'); // weekday | weekoff | holiday
    t.decimal('rate', 4, 2).notNullable().defaultTo(2); // multiplier fixed when the request is approved
    t.string('reason', 255).notNullable();
    t.string('status', 12).notNullable().defaultTo('pending'); // pending | approved | rejected | cancelled
    t.bigInteger('approver_id').unsigned();
    t.string('decision_note', 255);
    t.timestamp('decided_at');
    t.timestamps(true, true);
    t.index(['employee_id', 'date']);
    t.index(['status']);
  });

  await knex.schema.alterTable('salary_structures', (t) => { t.boolean('overtime_eligible').notNullable().defaultTo(true); });
  await knex.schema.alterTable('payslips', (t) => {
    t.decimal('overtime_hours', 6, 2).notNullable().defaultTo(0);
    t.decimal('overtime_pay', 12, 2).notNullable().defaultTo(0);
  });
}

export async function down() {}
