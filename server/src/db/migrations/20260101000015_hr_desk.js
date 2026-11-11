// HR desk: help desk tickets (including confidential grievances), company policies that people acknowledge, and asset tracking.
export async function up(knex) {
  // ---- help desk ----
  await knex.schema.createTable('helpdesk_tickets', (t) => {
    t.bigIncrements('id');
    t.bigInteger('employee_id').unsigned().notNullable().references('employees.id').onDelete('CASCADE');
    t.string('category', 30).notNullable().defaultTo('hr'); // hr | payroll | it | admin | grievance | other
    t.string('subject', 150).notNullable();
    t.text('description').notNullable();
    t.string('priority', 10).notNullable().defaultTo('normal'); // low | normal | high
    t.string('status', 12).notNullable().defaultTo('open'); // open | in_progress | resolved | closed
    t.bigInteger('assigned_to').unsigned().nullable(); // a user (HR) handling it
    t.timestamp('resolved_at').nullable();
    t.timestamps(true, true);
    t.index(['employee_id']);
    t.index(['status']);
  });
  await knex.schema.createTable('helpdesk_comments', (t) => {
    t.bigIncrements('id');
    t.bigInteger('ticket_id').unsigned().notNullable().references('helpdesk_tickets.id').onDelete('CASCADE');
    t.bigInteger('user_id').unsigned().notNullable();
    t.text('body').notNullable();
    t.boolean('is_internal').notNullable().defaultTo(false); // a note only HR can see
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['ticket_id']);
  });

  // ---- policies ----
  await knex.schema.createTable('policies', (t) => {
    t.bigIncrements('id');
    t.string('title', 150).notNullable();
    t.text('description').nullable();
    t.string('file_path', 255).notNullable();
    t.string('original_name', 255).notNullable();
    t.string('mime', 100).notNullable();
    t.integer('size').notNullable().defaultTo(0);
    t.integer('version').notNullable().defaultTo(1); // a new file raises the version, and everyone must acknowledge again
    t.boolean('requires_ack').notNullable().defaultTo(true);
    t.boolean('active').notNullable().defaultTo(true);
    t.bigInteger('created_by').unsigned().nullable();
    t.timestamps(true, true);
  });
  await knex.schema.createTable('policy_acks', (t) => {
    t.bigInteger('policy_id').unsigned().notNullable().references('policies.id').onDelete('CASCADE');
    t.bigInteger('employee_id').unsigned().notNullable().references('employees.id').onDelete('CASCADE');
    t.integer('version').notNullable();
    t.timestamp('acknowledged_at').notNullable().defaultTo(knex.fn.now());
    t.string('ip', 60).nullable();
    t.primary(['policy_id', 'employee_id']);
  });

  // ---- assets ----
  await knex.schema.createTable('assets', (t) => {
    t.bigIncrements('id');
    t.string('tag', 40).notNullable().unique(); // the label on the item, e.g. LAP-0001
    t.string('name', 120).notNullable();
    t.string('category', 30).notNullable().defaultTo('laptop'); // laptop | phone | id_card | access_card | accessory | other
    t.string('serial_no', 80).nullable();
    t.date('purchase_date').nullable();
    t.decimal('value', 12, 2).nullable();
    t.string('status', 12).notNullable().defaultTo('available'); // available | assigned | repair | retired
    t.text('notes').nullable();
    t.timestamps(true, true);
    t.index(['status']);
  });
  await knex.schema.createTable('asset_assignments', (t) => {
    t.bigIncrements('id');
    t.bigInteger('asset_id').unsigned().notNullable().references('assets.id').onDelete('CASCADE');
    t.bigInteger('employee_id').unsigned().notNullable().references('employees.id').onDelete('CASCADE');
    t.date('issued_on').notNullable();
    t.string('condition_out', 120).nullable();
    t.bigInteger('issued_by').unsigned().nullable();
    t.date('returned_on').nullable();
    t.string('condition_in', 120).nullable();
    t.bigInteger('returned_by').unsigned().nullable();
    t.string('notes', 255).nullable();
    t.timestamps(true, true);
    t.index(['asset_id']);
    t.index(['employee_id']);
  });
}

export async function down() {}
