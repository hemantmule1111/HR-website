// HR interview tests: HR writes questions and answers, a candidate signs in with their email and a code and takes the test in the office.
export async function up(knex) {
  await knex.schema.createTable('test_templates', (t) => {
    t.bigIncrements('id');
    t.string('title', 120).notNullable();
    t.string('job_role', 100);
    t.string('industry', 100);
    t.text('description');
    t.integer('duration_minutes').notNullable().defaultTo(30);
    t.integer('pass_percent').notNullable().defaultTo(50);
    t.string('status', 10).notNullable().defaultTo('active'); // active | archived
    t.bigInteger('created_by').unsigned();
    t.timestamps(true, true);
  });

  await knex.schema.createTable('test_questions', (t) => {
    t.bigIncrements('id');
    t.bigInteger('template_id').unsigned().notNullable().references('test_templates.id').onDelete('CASCADE');
    t.string('type', 8).notNullable().defaultTo('mcq'); // mcq (one correct option) | text (HR marks it)
    t.text('question').notNullable();
    t.text('options'); // JSON array of option texts (mcq)
    t.integer('correct_option'); // index into options (mcq)
    t.text('model_answer'); // what a good answer looks like (text), shown to HR only
    t.integer('marks').notNullable().defaultTo(1);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.index(['template_id']);
  });

  await knex.schema.createTable('test_attempts', (t) => {
    t.bigIncrements('id');
    t.bigInteger('template_id').unsigned().notNullable().references('test_templates.id').onDelete('CASCADE');
    t.string('name', 120).notNullable();
    t.string('email', 150).notNullable();
    t.string('phone', 30);
    t.string('access_code', 8).notNullable();
    t.date('valid_on').notNullable(); // the code works up to the end of this day
    t.string('status', 12).notNullable().defaultTo('invited'); // invited | in_progress | submitted
    t.string('token', 64); // the candidate's session after they sign in
    t.timestamp('started_at').nullable();
    t.timestamp('submitted_at').nullable();
    t.integer('duration_minutes').notNullable().defaultTo(30);
    t.decimal('total_marks', 8, 2).notNullable().defaultTo(0);
    t.decimal('score', 8, 2).notNullable().defaultTo(0);
    t.decimal('percent', 5, 2).notNullable().defaultTo(0);
    t.integer('pending_review').notNullable().defaultTo(0); // written answers still waiting for HR marks
    t.string('result', 10); // pass | fail | review
    t.text('notes');
    t.bigInteger('created_by').unsigned();
    t.timestamps(true, true);
    t.index(['email']);
    t.index(['template_id']);
  });

  await knex.schema.createTable('test_answers', (t) => {
    t.bigIncrements('id');
    t.bigInteger('attempt_id').unsigned().notNullable().references('test_attempts.id').onDelete('CASCADE');
    t.bigInteger('question_id').unsigned().notNullable().references('test_questions.id').onDelete('CASCADE');
    t.integer('selected_option');
    t.text('answer_text');
    t.decimal('marks_awarded', 6, 2).nullable(); // null = not marked yet
    t.unique(['attempt_id', 'question_id']);
  });
}

export async function down() {}
