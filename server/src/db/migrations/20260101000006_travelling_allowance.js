// Travelling allowance as its own earning component, on the salary structure and on every payslip.
export async function up(knex) {
  await knex.schema.alterTable('salary_structures', (t) => { t.decimal('travelling_allowance', 12, 2).notNullable().defaultTo(0); });
  await knex.schema.alterTable('payslips', (t) => { t.decimal('travelling_allowance', 12, 2).notNullable().defaultTo(0); });
}

export async function down() {}
