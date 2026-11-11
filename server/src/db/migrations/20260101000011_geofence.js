// Geo-fenced attendance: the admin sets the office location(s); check-in and check-out only work from inside one of them.
export async function up(knex) {
  await knex.schema.createTable('geo_settings', (t) => {
    t.integer('id').primary();
    t.boolean('enabled').notNullable().defaultTo(false);
    t.integer('max_accuracy_m').notNullable().defaultTo(150); // a phone location less precise than this is refused
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });
  await knex('geo_settings').insert({ id: 1 });

  await knex.schema.createTable('office_locations', (t) => {
    t.bigIncrements('id');
    t.string('name', 100).notNullable();
    t.decimal('latitude', 10, 7).notNullable();
    t.decimal('longitude', 10, 7).notNullable();
    t.integer('radius_m').notNullable().defaultTo(100);
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });

  // Where each punch was made (kept for the record, shown to HR).
  await knex.schema.alterTable('attendance', (t) => {
    t.decimal('in_lat', 10, 7).nullable();
    t.decimal('in_lng', 10, 7).nullable();
    t.integer('in_accuracy').nullable();
    t.string('in_location', 100).nullable();
    t.decimal('out_lat', 10, 7).nullable();
    t.decimal('out_lng', 10, 7).nullable();
    t.integer('out_accuracy').nullable();
    t.string('out_location', 100).nullable();
  });
}

export async function down() {}
