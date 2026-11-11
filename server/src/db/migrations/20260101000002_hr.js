export async function up(knex) {
  await knex.schema.createTable('shifts', (t) => {
    t.increments('id');
    t.string('name', 80).notNullable().unique();
    t.string('start_time', 5).notNullable().defaultTo('09:30');
    t.string('end_time', 5).notNullable().defaultTo('18:30');
    t.integer('grace_minutes').notNullable().defaultTo(15);
    t.integer('half_day_minutes').notNullable().defaultTo(240); // worked less than this = half day
    t.string('weekly_offs', 20).notNullable().defaultTo('0'); // comma list of weekday numbers, 0 = Sunday
    t.string('status', 20).notNullable().defaultTo('active');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('employees', (t) => {
    t.bigIncrements('id');
    t.string('emp_code', 20).notNullable().unique();
    t.string('first_name', 80).notNullable();
    t.string('last_name', 80).notNullable().defaultTo('');
    t.string('email', 150).notNullable().unique();
    t.string('phone', 30);
    t.date('dob');
    t.string('gender', 20);
    t.string('address', 255);
    t.string('emergency_name', 100);
    t.string('emergency_phone', 30);
    t.integer('department_id').unsigned().references('departments.id');
    t.integer('designation_id').unsigned().references('designations.id');
    t.bigInteger('manager_id').unsigned().references('employees.id');
    t.integer('shift_id').unsigned().references('shifts.id');
    t.date('join_date').notNullable();
    t.string('employment_type', 30).notNullable().defaultTo('full_time');
    t.string('work_location', 100);
    t.string('status', 20).notNullable().defaultTo('active'); // probation | active | notice | exited
    t.date('probation_end');
    t.date('exit_date');
    t.string('bank_name', 100);
    t.string('bank_account', 40);
    t.string('ifsc', 20);
    t.string('pan', 20);
    t.string('aadhaar', 20);
    t.timestamps(true, true);
    t.index('manager_id');
    t.index('department_id');
  });

  await knex.schema.createTable('employee_documents', (t) => {
    t.bigIncrements('id');
    t.bigInteger('employee_id').unsigned().notNullable().references('employees.id').onDelete('CASCADE');
    t.string('type', 50).notNullable();
    t.string('original_name', 255).notNullable();
    t.string('file_path', 255).notNullable();
    t.string('mime', 100);
    t.integer('size').notNullable().defaultTo(0);
    t.date('expires_on');
    t.bigInteger('verified_by').unsigned();
    t.timestamp('verified_at').nullable();
    t.bigInteger('uploaded_by').unsigned();
    t.timestamps(true, true);
    t.index('employee_id');
  });

  await knex.schema.createTable('employment_history', (t) => {
    t.bigIncrements('id');
    t.bigInteger('employee_id').unsigned().notNullable().references('employees.id').onDelete('CASCADE');
    t.string('event', 30).notNullable(); // joining | confirmation | promotion | transfer | exit
    t.json('from_value');
    t.json('to_value');
    t.date('effective_date').notNullable();
    t.string('note', 255);
    t.bigInteger('approved_by').unsigned();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index('employee_id');
  });

  await knex.schema.createTable('attendance', (t) => {
    t.bigIncrements('id');
    t.bigInteger('employee_id').unsigned().notNullable().references('employees.id').onDelete('CASCADE');
    t.date('date').notNullable();
    t.dateTime('check_in');
    t.dateTime('check_out');
    t.string('source', 20).notNullable().defaultTo('web'); // web | regularized | manual
    t.string('status', 20).notNullable().defaultTo('present'); // present | half_day | absent
    t.integer('late_minutes').notNullable().defaultTo(0);
    t.integer('worked_minutes').notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.unique(['employee_id', 'date']);
  });

  await knex.schema.createTable('attendance_regularizations', (t) => {
    t.bigIncrements('id');
    t.bigInteger('employee_id').unsigned().notNullable().references('employees.id').onDelete('CASCADE');
    t.date('date').notNullable();
    t.string('requested_in', 5).notNullable();
    t.string('requested_out', 5).notNullable();
    t.string('reason', 255).notNullable();
    t.string('status', 20).notNullable().defaultTo('pending'); // pending | approved | rejected
    t.bigInteger('approver_id').unsigned();
    t.string('decision_note', 255);
    t.timestamp('decided_at').nullable();
    t.timestamps(true, true);
    t.index(['employee_id', 'status']);
  });

  await knex.schema.createTable('leave_types', (t) => {
    t.increments('id');
    t.string('name', 60).notNullable().unique();
    t.string('code', 10).notNullable().unique();
    t.string('color', 9).notNullable().defaultTo('#6366f1');
    t.decimal('annual_quota', 5, 1).notNullable().defaultTo(12);
    t.decimal('carry_forward_max', 5, 1).notNullable().defaultTo(0);
    t.boolean('is_paid').notNullable().defaultTo(true);
    t.boolean('allow_half_day').notNullable().defaultTo(true);
    t.boolean('count_weekoffs').notNullable().defaultTo(false); // sandwich style: weekoffs/holidays inside range count as leave
    t.string('status', 20).notNullable().defaultTo('active');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('leave_balances', (t) => {
    t.bigIncrements('id');
    t.bigInteger('employee_id').unsigned().notNullable().references('employees.id').onDelete('CASCADE');
    t.integer('leave_type_id').unsigned().notNullable().references('leave_types.id');
    t.integer('year').notNullable();
    t.decimal('opening', 5, 1).notNullable().defaultTo(0);
    t.decimal('accrued', 5, 1).notNullable().defaultTo(0);
    t.decimal('used', 5, 1).notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.unique(['employee_id', 'leave_type_id', 'year']);
  });

  await knex.schema.createTable('leave_requests', (t) => {
    t.bigIncrements('id');
    t.bigInteger('employee_id').unsigned().notNullable().references('employees.id').onDelete('CASCADE');
    t.integer('leave_type_id').unsigned().notNullable().references('leave_types.id');
    t.date('from_date').notNullable();
    t.date('to_date').notNullable();
    t.string('day_part', 10).notNullable().defaultTo('full'); // full | first_half | second_half
    t.decimal('days', 5, 1).notNullable();
    t.string('reason', 255).notNullable();
    t.string('status', 20).notNullable().defaultTo('pending'); // pending | approved | rejected | cancelled
    t.bigInteger('approver_id').unsigned();
    t.string('decision_note', 255);
    t.timestamp('decided_at').nullable();
    t.timestamps(true, true);
    t.index(['employee_id', 'status']);
    t.index(['from_date', 'to_date']);
  });

  await knex.schema.createTable('holidays', (t) => {
    t.increments('id');
    t.date('date').notNullable().unique();
    t.string('name', 100).notNullable();
    t.boolean('is_optional').notNullable().defaultTo(false);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('notifications', (t) => {
    t.bigIncrements('id');
    t.bigInteger('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.string('type', 40).notNullable();
    t.string('title', 150).notNullable();
    t.string('body', 255);
    t.string('link', 120);
    t.timestamp('read_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_id', 'read_at']);
  });

  await knex.schema.createTable('announcements', (t) => {
    t.bigIncrements('id');
    t.string('title', 150).notNullable();
    t.text('body').notNullable();
    t.boolean('pinned').notNullable().defaultTo(false);
    t.bigInteger('created_by').unsigned();
    t.timestamps(true, true);
  });

  await knex.schema.createTable('salary_structures', (t) => {
    t.bigIncrements('id');
    t.bigInteger('employee_id').unsigned().notNullable().references('employees.id').onDelete('CASCADE');
    t.decimal('basic', 12, 2).notNullable();
    t.decimal('hra', 12, 2).notNullable().defaultTo(0);
    t.decimal('allowances', 12, 2).notNullable().defaultTo(0);
    t.decimal('deductions', 12, 2).notNullable().defaultTo(0); // fixed monthly deductions (PF, PT etc. entered by payroll)
    t.date('effective_from').notNullable();
    t.string('note', 255);
    t.bigInteger('created_by').unsigned();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['employee_id', 'effective_from']);
  });

  await knex.schema.createTable('payroll_runs', (t) => {
    t.bigIncrements('id');
    t.string('month', 7).notNullable().unique();
    t.string('status', 20).notNullable().defaultTo('draft'); // draft | approved | paid
    t.bigInteger('created_by').unsigned();
    t.bigInteger('approved_by').unsigned();
    t.timestamps(true, true);
  });

  await knex.schema.createTable('payslips', (t) => {
    t.bigIncrements('id');
    t.bigInteger('run_id').unsigned().notNullable().references('payroll_runs.id').onDelete('CASCADE');
    t.bigInteger('employee_id').unsigned().notNullable().references('employees.id').onDelete('CASCADE');
    t.integer('total_days').notNullable();
    t.decimal('paid_days', 5, 1).notNullable();
    t.decimal('lop_days', 5, 1).notNullable();
    t.decimal('basic', 12, 2).notNullable();
    t.decimal('hra', 12, 2).notNullable();
    t.decimal('allowances', 12, 2).notNullable();
    t.decimal('gross', 12, 2).notNullable();
    t.decimal('deductions', 12, 2).notNullable();
    t.decimal('net', 12, 2).notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['run_id', 'employee_id']);
  });
}

export async function down(knex) {
  for (const t of [
    'payslips', 'payroll_runs', 'salary_structures', 'announcements', 'notifications', 'holidays',
    'leave_requests', 'leave_balances', 'leave_types', 'attendance_regularizations', 'attendance',
    'employment_history', 'employee_documents', 'employees', 'shifts',
  ]) {
    await knex.schema.dropTableIfExists(t);
  }
}
