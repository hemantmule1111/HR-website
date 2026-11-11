import 'dotenv/config';

const common = {
  migrations: { directory: './src/db/migrations' },
  seeds: { directory: './src/db/seeds' },
};

// DB_CLIENT=sqlite3 gives a zero-setup local database; the default is MySQL.
const config =
  process.env.DB_CLIENT === 'sqlite3'
    ? {
        client: 'better-sqlite3',
        connection: { filename: process.env.SQLITE_FILE || './hrms.sqlite' },
        useNullAsDefault: true,
        pool: {
          afterCreate: (conn, done) => {
            conn.pragma('foreign_keys = ON');
            done(null, conn);
          },
        },
        ...common,
      }
    : {
        client: 'mysql2',
        connection: {
          host: process.env.DB_HOST,
          port: Number(process.env.DB_PORT || 3306),
          user: process.env.DB_USER,
          password: process.env.DB_PASSWORD,
          database: process.env.DB_NAME,
          timezone: 'Z',
          dateStrings: true,
        },
        ...common,
      };

export default config;
