// Single-row company profile used for the payslip letterhead (logo, address, accent colour, ...).
export async function up(knex) {
  await knex.schema.createTable('company_profile', (t) => {
    t.integer('id').primary();
    t.string('name', 150).notNullable().defaultTo('');
    t.string('tagline', 200);
    t.string('address', 400);
    t.string('phone', 40);
    t.string('email', 150);
    t.string('website', 150);
    t.string('tax_id', 80); // CIN / GSTIN / registration number
    t.string('logo_path', 255);
    t.string('logo_mime', 60);
    t.string('accent_color', 9).notNullable().defaultTo('#4f46e5');
    t.string('signatory_name', 100);
    t.string('signatory_title', 100);
    t.string('payslip_footer', 400);
    t.timestamps(true, true);
  });
  await knex('company_profile').insert({ id: 1, name: 'WorkPilot' });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('company_profile');
}
