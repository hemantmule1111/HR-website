// Two-step sign-in: the authenticator secret (stored encrypted), whether it is switched on, one-time recovery codes (hashes only).
export async function up(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.text('totp_secret').nullable();
    t.boolean('totp_enabled').notNullable().defaultTo(false);
    t.text('recovery_codes').nullable();
    t.integer('totp_last_step').notNullable().defaultTo(0);
  });
}

export async function down() {}
