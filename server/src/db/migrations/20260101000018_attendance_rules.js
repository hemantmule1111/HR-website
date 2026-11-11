// Attendance: selfie at punch-in, QR sign-in, biometric devices, late / early rules, overtime from punch times, reminders.
export async function up(knex) {
  await knex.schema.createTable('attendance_settings', (t) => {
    t.integer('id').primary();
    t.boolean('selfie_required').notNullable().defaultTo(false);
    t.string('qr_mode', 10).notNullable().defaultTo('off'); // off | optional | required
    t.string('qr_secret', 64).nullable(); // made on first use; never sent to a browser
    t.integer('late_halfday_after_min').notNullable().defaultTo(0); // arriving this many minutes after shift start = half day (0 = off)
    t.integer('early_halfday_before_min').notNullable().defaultTo(0); // leaving this many minutes before shift end = half day (0 = off)
    t.integer('late_free_marks').notNullable().defaultTo(0); // late arrivals allowed in a month before each further one costs half a day
    t.boolean('late_penalty_on').notNullable().defaultTo(false);
    t.boolean('auto_overtime').notNullable().defaultTo(false);
    t.integer('auto_overtime_min').notNullable().defaultTo(30); // work beyond shift end shorter than this is not overtime
    t.boolean('reminders').notNullable().defaultTo(true);
    t.integer('remind_checkout_after_min').notNullable().defaultTo(60);
    t.integer('remind_checkin_after_min').notNullable().defaultTo(60); // 0 = do not remind people who have not checked in
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });
  await knex('attendance_settings').insert({ id: 1 });

  await knex.schema.createTable('attendance_devices', (t) => {
    t.bigIncrements('id');
    t.string('name', 100).notNullable();
    t.string('key_hash', 64).notNullable().unique();
    t.boolean('active').notNullable().defaultTo(true);
    t.dateTime('last_seen').nullable();
    t.timestamps(true, true);
  });

  await knex.schema.createTable('attendance_reminders', (t) => {
    t.bigIncrements('id');
    t.bigInteger('employee_id').unsigned().notNullable();
    t.date('date').notNullable();
    t.string('kind', 20).notNullable(); // checkin | checkout
    t.unique(['employee_id', 'date', 'kind']);
  });

  await knex.schema.alterTable('attendance', (t) => {
    t.string('in_photo', 120).nullable();
    t.string('out_photo', 120).nullable();
    t.integer('early_minutes').notNullable().defaultTo(0);
  });
  await knex.schema.alterTable('overtime_requests', (t) => {
    t.string('source', 10).notNullable().defaultTo('manual'); // manual | auto
  });
}
export async function down() {}
