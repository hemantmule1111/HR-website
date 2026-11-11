// The platform layer for selling WorkPilot to many companies: the list of companies and the platform (owner) logins.
// These two tables are NOT per company. Everything else is created once per company (see db/tenant.js).
import { tenantMigrationFiles } from '../tenant.js';

export async function up(knex) {
  await knex.schema.createTable('companies', (t) => {
    t.bigIncrements('id');
    t.string('code', 40).notNullable().unique(); // typed on the sign-in page, e.g. "acme"
    t.string('name', 150).notNullable();
    t.string('prefix', 20).notNullable().defaultTo(''); // table-name prefix; "" for the first company
    t.string('status', 12).notNullable().defaultTo('active'); // active | suspended
    t.integer('max_employees').notNullable().defaultTo(0); // 0 = no limit
    t.date('valid_until').nullable(); // subscription end; empty = no end
    t.integer('schema_version').notNullable().defaultTo(0); // how many company migrations have been applied
    t.text('notes');
    t.timestamps(true, true);
  });
  await knex.schema.createTable('platform_admins', (t) => {
    t.bigIncrements('id');
    t.string('name', 120).notNullable();
    t.string('email', 150).notNullable().unique();
    t.string('password_hash', 100).notNullable();
    t.integer('failed_logins').notNullable().defaultTo(0);
    t.timestamp('locked_until').nullable();
    t.timestamps(true, true);
  });
  // An install that already exists becomes the first company. Its tables stay exactly where they are (prefix "").
  const has = await knex.schema.hasTable('company_profile');
  if (has) {
    const p = await knex('company_profile').first();
    await knex('companies').insert({ code: 'default', name: p?.name || 'My company', prefix: '', schema_version: tenantMigrationFiles().length });
  }
}

export async function down() {}
