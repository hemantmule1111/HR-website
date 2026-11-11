// Creates (or resets) the platform owner login: the person who sells WorkPilot and creates the companies.
//   node scripts/create-platform-admin.mjs --email=you@yourdomain.com --password="a long password" --name="Your Name"
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import db from '../src/db/index.js';

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const email = arg('email').toLowerCase();
const password = arg('password');
const name = arg('name') || 'Platform owner';
if (!email || password.length < 10) {
  console.error('Usage: node scripts/create-platform-admin.mjs --email=... --password="at least 10 characters" [--name="..."]');
  process.exit(1);
}
const hash = await bcrypt.hash(password, 12);
const existing = await db('platform_admins').where({ email }).first();
if (existing) await db('platform_admins').where({ id: existing.id }).update({ password_hash: hash, name, failed_logins: 0, locked_until: null });
else await db('platform_admins').insert({ email, name, password_hash: hash });
console.log(existing ? `Updated the platform login ${email}` : `Created the platform login ${email}`);
await db.destroy();
