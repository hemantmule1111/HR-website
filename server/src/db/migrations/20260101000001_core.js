export async function up(knex) {
  await knex.schema.createTable('roles', (t) => {
    t.increments('id');
    t.string('name', 50).notNullable().unique();
    t.string('description');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('permissions', (t) => {
    t.increments('id');
    t.string('key', 80).notNullable().unique(); // module.action
    t.string('description');
  });

  await knex.schema.createTable('role_permissions', (t) => {
    t.integer('role_id').unsigned().notNullable().references('roles.id').onDelete('CASCADE');
    t.integer('permission_id').unsigned().notNullable().references('permissions.id').onDelete('CASCADE');
    t.primary(['role_id', 'permission_id']);
  });

  await knex.schema.createTable('departments', (t) => {
    t.increments('id');
    t.string('name', 100).notNullable().unique();
    t.bigInteger('head_employee_id').unsigned().nullable(); // FK added with employees in M2
    t.string('status', 20).notNullable().defaultTo('active');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('designations', (t) => {
    t.increments('id');
    t.string('title', 100).notNullable().unique();
    t.integer('level').notNullable().defaultTo(1);
    t.string('status', 20).notNullable().defaultTo('active');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('users', (t) => {
    t.bigIncrements('id');
    t.bigInteger('employee_id').unsigned().nullable().index(); // FK added with employees in M2
    t.string('email', 150).notNullable().unique();
    t.string('password_hash').notNullable();
    t.integer('role_id').unsigned().notNullable().references('roles.id');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.integer('failed_logins').notNullable().defaultTo(0);
    t.timestamp('locked_until').nullable();
    t.timestamp('last_login_at').nullable();
    t.timestamps(true, true);
  });

  await knex.schema.createTable('audit_logs', (t) => {
    t.bigIncrements('id');
    t.bigInteger('user_id').unsigned().nullable();
    t.string('entity', 60).notNullable();
    t.string('entity_id', 40).nullable();
    t.string('action', 30).notNullable();
    t.json('old_value').nullable();
    t.json('new_value').nullable();
    t.string('ip', 64).nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['entity', 'entity_id']);
    t.index('user_id');
  });
}

export async function down(knex) {
  for (const t of ['audit_logs', 'users', 'designations', 'departments', 'role_permissions', 'permissions', 'roles']) {
    await knex.schema.dropTableIfExists(t);
  }
}
