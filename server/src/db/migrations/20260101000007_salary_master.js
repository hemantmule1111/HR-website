// Salary master sheet: the company decides which salary categories exist (earnings and deductions).
// The standard earnings keep their columns on salary_structures / payslips; categories the company adds live in the item tables.
const STANDARD = [
  ['basic', 'Basic salary', 1, 1], ['da', 'Dearness allowance (DA)', 1, 2], ['hra', 'House rent allowance (HRA)', 0, 3],
  ['allowances', 'Special allowance', 1, 4], ['conveyance', 'Conveyance', 0, 5], ['travelling_allowance', 'Travelling allowance', 0, 6],
  ['medical', 'Medical allowance', 0, 7], ['other_allowance', 'Other allowances', 0, 8],
];

export async function up(knex) {
  await knex.schema.createTable('salary_components', (t) => {
    t.bigIncrements('id');
    t.string('code', 40).notNullable().unique();
    t.string('name', 80).notNullable();
    t.string('kind', 10).notNullable().defaultTo('earning'); // earning | deduction
    t.boolean('is_standard').notNullable().defaultTo(false); // standard categories have their own column and cannot be deleted, only switched off
    t.boolean('active').notNullable().defaultTo(true);
    t.boolean('in_wages').notNullable().defaultTo(false); // earning counts as "wages" for PF / ESIC / gratuity (Labour Codes 50% rule)
    t.integer('sort_order').notNullable().defaultTo(100);
    t.timestamps(true, true);
  });
  for (const [code, name, in_wages, sort_order] of STANDARD) {
    await knex('salary_components').insert({ code, name, kind: 'earning', is_standard: true, active: true, in_wages: !!in_wages, sort_order });
  }

  await knex.schema.createTable('salary_structure_items', (t) => {
    t.bigInteger('structure_id').unsigned().notNullable().references('salary_structures.id').onDelete('CASCADE');
    t.bigInteger('component_id').unsigned().notNullable().references('salary_components.id').onDelete('CASCADE');
    t.decimal('amount', 12, 2).notNullable().defaultTo(0);
    t.primary(['structure_id', 'component_id']);
  });

  await knex.schema.createTable('payslip_items', (t) => {
    t.bigIncrements('id');
    t.bigInteger('payslip_id').unsigned().notNullable().references('payslips.id').onDelete('CASCADE');
    t.bigInteger('component_id').unsigned();
    t.string('name', 80).notNullable(); // copied, so an old payslip still reads right after a category is renamed or removed
    t.string('kind', 10).notNullable();
    t.decimal('amount', 12, 2).notNullable().defaultTo(0);
    t.index(['payslip_id']);
  });
}

export async function down() {}
