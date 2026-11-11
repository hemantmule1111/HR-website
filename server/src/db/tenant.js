// Multi-company support. Every company has its own set of tables in the same database (a name prefix such as "c2_"),
// so a query made for one company can only ever reach that company's tables. The very first company keeps the
// plain, unprefixed tables (prefix ""), so existing installs keep working with no data move.
//
// The current company travels with the request (AsyncLocalStorage); the database layer adds the prefix to table names.
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const als = new AsyncLocalStorage();
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

// Migrations that belong to the platform (the list of companies), not to a company. All other migrations run once per company.
export const isPlatformMigration = (file) => /_platform\.js$/.test(file);
export const tenantMigrationFiles = () => fs.readdirSync(dir).filter((f) => f.endsWith('.js') && !isPlatformMigration(f)).sort();
export const MIGRATIONS_DIR = dir;

// Every table a company owns, read from the migrations themselves so it can never drift.
export const TENANT_TABLES = new Set(
  tenantMigrationFiles().flatMap((f) => [...fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/createTable\('(\w+)'/g)].map((m) => m[1])),
);

// Run `fn` as the given company. prefix "" = the first (unprefixed) company.
export const runAs = (prefix, fn, company) => als.run({ prefix, company }, fn);
// Run with no company selected: any company table is refused (fails closed).
export const runWithoutCompany = (fn) => als.run({ none: true }, fn);
export const currentStore = () => als.getStore();
// The company of the current request (used for the name and code in emails).
export const currentCompany = () => als.getStore()?.company;
export const currentPrefix = () => als.getStore()?.prefix ?? '';
// Each company keeps its uploaded files in its own folder (the first company keeps the original location).
export const uploadSub = () => currentPrefix().replace(/_$/, '');

// Index and constraint names are shared across a whole database, so they get the prefix too.
const NAMED = /_(index|unique|foreign|primary)$/;

// Used as knex's wrapIdentifier.
export function wrapIdentifier(value, original) {
  const store = als.getStore();
  if (store?.none && (TENANT_TABLES.has(value) || NAMED.test(value))) {
    throw new Error(`No company selected for this request (table "${value}")`);
  }
  const prefix = store?.prefix;
  if (prefix && (TENANT_TABLES.has(value) || NAMED.test(value))) return original(prefix + value);
  return original(value);
}
