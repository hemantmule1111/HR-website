// Creates the MySQL database named in .env if it does not exist (XAMPP's MySQL starts with no app databases).
import 'dotenv/config';
import mysql from 'mysql2/promise';

const name = process.env.DB_NAME || 'hrms';
if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error('DB_NAME may only contain letters, numbers and underscores');

try {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
  });
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.end();
  console.log(`Database "${name}" is ready.`);
} catch (e) {
  console.error(`Could not connect to MySQL at ${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || 3306} as ${process.env.DB_USER || 'root'}: ${e.message}`);
  console.error('Start MySQL in the XAMPP Control Panel and check DB_* in server/.env.');
  process.exit(1);
}
