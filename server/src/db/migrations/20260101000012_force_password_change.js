// A login handed out with a temporary password must choose its own password at the first sign-in.
export async function up(knex) {
  await knex.schema.alterTable('users', (t) => { t.boolean('must_change_password').notNullable().defaultTo(false); });
}

export async function down() {}
