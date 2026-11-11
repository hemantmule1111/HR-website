// Selling to many companies: plan label and feature switches, own web address, last sign-in, and the platform owner's activity log.
// Platform tables only (not per company).
export async function up(knex) {
  await knex.schema.alterTable('companies', (t) => {
    t.string('plan', 40).nullable(); // a label such as "Standard"
    t.text('features').nullable(); // JSON like {"payroll":true,"overtime":false}; empty = everything is on
    t.string('domain', 150).nullable(); // the company's own web address, e.g. hr.acme.com
    t.timestamp('last_login_at').nullable();
  });
  await knex.schema.alterTable('companies', (t) => { t.unique(['domain']); });
  await knex.schema.createTable('platform_log', (t) => {
    t.bigIncrements('id');
    t.bigInteger('admin_id').unsigned().nullable();
    t.string('admin_email', 150).nullable();
    t.string('action', 40).notNullable();
    t.bigInteger('company_id').unsigned().nullable();
    t.string('company_code', 40).nullable();
    t.string('detail', 500).nullable();
    t.string('ip', 60).nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['created_at']);
  });
}
export async function down() {}
