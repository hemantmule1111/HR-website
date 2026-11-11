// In-app chat: direct messages, group chats, an "everyone" channel, file attachments and read receipts.
export async function up(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.timestamp('last_seen_at').nullable(); // presence (online dot)
  });

  await knex.schema.createTable('chat_conversations', (t) => {
    t.bigIncrements('id');
    t.string('type', 10).notNullable(); // direct | group | everyone
    t.string('name', 100);
    t.string('direct_key', 40).unique(); // "<lowUserId>:<highUserId>" so a pair of people share one thread
    t.bigInteger('created_by').unsigned();
    t.timestamp('last_message_at').nullable();
    t.timestamps(true, true);
  });

  await knex.schema.createTable('chat_members', (t) => {
    t.bigInteger('conversation_id').unsigned().notNullable().references('chat_conversations.id').onDelete('CASCADE');
    t.bigInteger('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.timestamp('joined_at').notNullable().defaultTo(knex.fn.now());
    t.primary(['conversation_id', 'user_id']);
    t.index('user_id');
  });

  await knex.schema.createTable('chat_messages', (t) => {
    t.bigIncrements('id');
    t.bigInteger('conversation_id').unsigned().notNullable().references('chat_conversations.id').onDelete('CASCADE');
    t.bigInteger('sender_id').unsigned().notNullable().references('users.id');
    t.text('body');
    t.string('file_path', 255);
    t.string('file_name', 255);
    t.string('file_mime', 100);
    t.integer('file_size');
    t.timestamp('deleted_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['conversation_id', 'id']);
  });

  await knex.schema.createTable('chat_reads', (t) => {
    t.bigInteger('conversation_id').unsigned().notNullable().references('chat_conversations.id').onDelete('CASCADE');
    t.bigInteger('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.bigInteger('last_read_id').unsigned().notNullable().defaultTo(0);
    t.primary(['conversation_id', 'user_id']);
  });
}

export async function down(knex) {
  for (const t of ['chat_reads', 'chat_messages', 'chat_members', 'chat_conversations']) await knex.schema.dropTableIfExists(t);
  await knex.schema.alterTable('users', (t) => t.dropColumn('last_seen_at'));
}
