// Builds the database files for a LIVE MySQL/MariaDB server, generated from the real migrations so they always match the application:
//
//   deploy/hr-live-install.sql                    a COMPLETE fresh database: the platform tables, the first company and its admin login
//   deploy/hr-live-upgrade-multicompany.sql       for a site that is ALREADY running: adds only the platform tables and registers the existing data as the first company
//   php/site/app/schema/tenant-schema.json        the recipe the PHP app uses to create the tables of every NEW company
//
//   node deploy/make-install-sql.mjs --email=admin@wpart.co.in --password="first company admin password" \
//        --platform-email=owner@wpart.co.in --platform-password="your platform owner password" [--company-name="My company"]
//
// Import hr-live-install.sql ONCE into an EMPTY database (phpMyAdmin -> Import). It contains no local test data and no default password.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { TENANT_TABLES, tenantMigrationFiles, isPlatformMigration, MIGRATIONS_DIR } from '../server/src/db/tenant.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'server', 'package.json'));
const knex = require('knex');
const bcrypt = require('bcryptjs');

const arg = (n, d = '') => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3) || d;
const email = arg('email', 'admin@wpart.co.in');
const password = arg('password');
const platformEmail = arg('platform-email');
const platformPassword = arg('platform-password');
const companyName = arg('company-name', 'My company');
if (password.length < 10) throw new Error('Pass --password="..." (at least 10 characters): it becomes the first company admin login.');
if (!platformEmail || platformPassword.length < 10) throw new Error('Pass --platform-email=... and --platform-password="..." (at least 10 characters): this is the platform owner login that creates companies.');

// "{P}" stands for the company's table prefix. The first company uses no prefix; every new company gets one such as "c2_".
const NAMED = /_(index|unique|foreign|primary)$/;
const k = knex({ client: 'mysql2', wrapIdentifier: (v, orig) => orig(TENANT_TABLES.has(v) || NAMED.test(v) ? `{P}${v}` : v) }); // only writes SQL text; it never connects
const out = [];
let cur = null; // statements of the migration / seed being captured for the per-company recipe
const sql = (s) => { out.push(`${s};`); if (cur) cur.push(s); };
const section = (title) => out.push('', `-- ${title}`, '');
const charset = (s) => (/^create table /i.test(s) ? `${s} ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci` : s);

// A stand-in for the migration's knex object: it records the SQL instead of running it.
const recorder = Object.assign(
  (table) => ({
    insert: (row) => { sql(k(table).insert(row).toString()); return Promise.resolve(); },
    update: (patch) => { sql(k(table).update(patch).toString()); return Promise.resolve(); }, // a fresh database has no rows yet, so this changes nothing
  }),
  {
    fn: k.fn,
    schema: {
      createTable: (name, cb) => { k.schema.createTable(name, cb).toSQL().forEach((q) => sql(charset(q.sql))); return Promise.resolve(); },
      alterTable: (name, cb) => { k.schema.alterTable(name, cb).toSQL().forEach((q) => sql(q.sql)); return Promise.resolve(); },
      hasTable: () => Promise.resolve(false),
    },
  },
);
const load = async (f) => import(pathToFileURL(path.join(MIGRATIONS_DIR, f)).href);

const schema = { version: 0, tables: [...TENANT_TABLES], migrations: [], seed: [] };
const files = tenantMigrationFiles();
const allFiles = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.js')).sort();
schema.version = files.length;

out.push(
  '-- WorkPilot: complete database for a LIVE server (MySQL 5.7+ / MariaDB 10.3+), multi-company edition.',
  `-- Generated ${new Date().toISOString().slice(0, 10)} from the application migrations.`,
  '--',
  '-- HOW TO USE: create an EMPTY database in cPanel, then phpMyAdmin -> select it -> Import -> choose this file.',
  '-- Import it once. It creates every table, the roles and permissions, the platform owner login, the first company and its admin login, and Indian holidays 2027-2029.',
  `-- Platform owner login: ${platformEmail}  (opens /platform and creates the companies)`,
  `-- First company: code "default", admin login ${email}. Change the passwords after signing in.`,
  '',
  'SET NAMES utf8mb4;',
  'SET time_zone = "+00:00";',
  'SET FOREIGN_KEY_CHECKS = 0;',
);

// 1) The tables a company owns, exactly as the migrations create them
for (const f of files) {
  section(`Migration ${f}`);
  cur = [];
  await (await load(f)).up(recorder);
  schema.migrations.push({ name: f, statements: cur });
  cur = null;
}

// 2) Platform tables (the list of companies and the platform owner login)
const platformFiles = allFiles.filter(isPlatformMigration);
section(`Migrations ${platformFiles.join(', ')} (platform tables)`);
const platformStart = out.length;
for (const pf of platformFiles) await (await load(pf)).up(recorder);
const platformSql = out.slice(platformStart);

// 3) Knex's own bookkeeping, so "npm run setup" later sees these migrations as already done and only adds newer ones
section('Migration bookkeeping');
sql('CREATE TABLE `knex_migrations` (`id` int unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY, `name` varchar(255) DEFAULT NULL, `batch` int DEFAULT NULL, `migration_time` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
sql('CREATE TABLE `knex_migrations_lock` (`index` int unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY, `is_locked` int DEFAULT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
sql('INSERT INTO `knex_migrations_lock` (`index`, `is_locked`) VALUES (1, 0)');
sql(`INSERT INTO \`knex_migrations\` (\`name\`, \`batch\`) VALUES ${allFiles.map((f) => `('${f}', 1)`).join(', ')}`);

// 4) Roles and permissions (every company gets its own copy; the first company's copy is installed here)
const { PERMISSIONS, ROLES } = await import(pathToFileURL(path.join(root, 'server', 'src', 'db', 'seeds', '01_roles_permissions.js')).href);
section('Permissions, roles and what each role may do');
cur = schema.seed;
const permId = Object.fromEntries(PERMISSIONS.map((p, i) => [p, i + 1]));
sql(`INSERT INTO \`{P}permissions\` (\`id\`, \`key\`) VALUES ${PERMISSIONS.map((p) => `(${permId[p]}, '${p}')`).join(', ')}`);
const roleNames = Object.keys(ROLES);
sql(`INSERT INTO \`{P}roles\` (\`id\`, \`name\`) VALUES ${roleNames.map((r, i) => `(${i + 1}, '${r}')`).join(', ')}`);
const links = roleNames.flatMap((r, i) => ROLES[r].map((p) => `(${i + 1}, ${permId[p]})`));
sql(`INSERT INTO \`{P}role_permissions\` (\`role_id\`, \`permission_id\`) VALUES ${links.join(', ')}`);

// 5) Indian public holidays 2027-2029 (from scripts/seed-holidays.js)
section('Indian public holidays 2027-2029 (moon-dependent ones are marked "(tentative)")');
const src = fs.readFileSync(path.join(root, 'server', 'scripts', 'seed-holidays.js'), 'utf8');
const tDecl = src.match(/const T = [^;]+;/)[0];
const hDecl = src.match(/const HOLIDAYS = \{[\s\S]*?\n\};/)[0];
const HOLIDAYS = new Function(`${tDecl}\n${hDecl}\nreturn HOLIDAYS;`)();
const rows = Object.entries(HOLIDAYS).flatMap(([y, list]) => list.map(([md, name]) => ({ date: `${y}-${md}`, name })));
sql(k('holidays').insert(rows).toString());
cur = null;

// 6) The first company and its admin login, and the platform owner
section('First company (its tables use no prefix) and its admin login');
sql(k('companies').insert({ code: 'default', name: companyName, prefix: '', status: 'active', max_employees: 0, schema_version: files.length }).toString());
sql(k('company_profile').where({ id: 1 }).update({ name: companyName }).toString());
sql(k('users').insert({ email, password_hash: await bcrypt.hash(password, 12), role_id: roleNames.indexOf('Super Admin') + 1 }).toString());
section('Platform owner login');
sql(k('platform_admins').insert({ name: 'Platform owner', email: platformEmail.toLowerCase(), password_hash: await bcrypt.hash(platformPassword, 12) }).toString());
out.push('', 'SET FOREIGN_KEY_CHECKS = 1;', '');

const strip = (lines) => lines.map((l) => l.replace(/\{P\}/g, ''));
const file = path.join(root, 'deploy', 'hr-live-install.sql');
fs.writeFileSync(file, strip(out).join('\n'));

// The upgrade file for a site that is already running: only the platform tables + the existing data registered as the first company.
const up = [
  '-- WorkPilot: upgrade an ALREADY RUNNING site to the multi-company edition.',
  `-- Generated ${new Date().toISOString().slice(0, 10)}.`,
  '--',
  '-- HOW TO USE: phpMyAdmin -> select your existing WorkPilot database -> Import -> choose this file. Do this ONCE, BEFORE uploading the new files.',
  '-- It does not touch any existing table or row. It only adds the platform tables, registers your current data as the first company (code "default"),',
  `-- and creates the platform owner login ${platformEmail}.`,
  '-- After uploading the new files, sign in at /platform and press "Update databases" once to add the newer features to your existing data.',
  '',
  'SET NAMES utf8mb4;',
  ...strip(platformSql).filter((l) => l.trim()),
  strip([`${k('companies').insert({ code: 'default', name: companyName, prefix: '', status: 'active', max_employees: 0, schema_version: 0 }).toString()};`])[0],
  `${k('platform_admins').insert({ name: 'Platform owner', email: platformEmail.toLowerCase(), password_hash: await bcrypt.hash(platformPassword, 12) }).toString()};`,
  '',
];
fs.writeFileSync(path.join(root, 'deploy', 'hr-live-upgrade-multicompany.sql'), up.join('\n'));

// The recipe the PHP app follows to create a new company's tables ("{P}" is replaced by that company's prefix).
fs.mkdirSync(path.join(root, 'php', 'site', 'app', 'schema'), { recursive: true });
fs.writeFileSync(path.join(root, 'php', 'site', 'app', 'schema', 'tenant-schema.json'), JSON.stringify(schema));
console.log(`Wrote deploy/hr-live-install.sql: ${files.length} company migrations, ${schema.tables.length} tables per company, ${PERMISSIONS.length} permissions, ${roleNames.length} roles, ${rows.length} holidays`);
console.log('Wrote deploy/hr-live-upgrade-multicompany.sql and php/site/app/schema/tenant-schema.json');
