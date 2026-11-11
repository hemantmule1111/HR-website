// Two-step sign-in for the platform owner logins (platform tables are not per company).
export async function up(knex) {
  await knex.schema.createTable('platform_2fa', (t) => {
    t.bigInteger('admin_id').unsigned().notNullable().primary();
    t.text('secret').nullable();
    t.boolean('enabled').notNullable().defaultTo(false);
    t.text('recovery_codes').nullable();
    t.integer('last_step').notNullable().defaultTo(0);
  });
}

export async function down() {}
