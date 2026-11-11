import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import db from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { audit } from '../services/audit.js';
import { TENANT_TABLES, runAs, uploadSub } from '../db/tenant.js';

// "Download my company data": a ZIP with one CSV per table (and, on request, the uploaded files). Passwords and security codes are never included.
const HIDE = { users: ['password_hash', 'totp_secret', 'recovery_codes', 'totp_last_step', 'failed_logins', 'locked_until', 'must_change_password'] };
const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR || './uploads');

const csvCell = (v) => { const s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

// A small "stored" ZIP writer kept in memory (exports of one company are modest).
function zipBuffer(entries) {
  const locals = []; const central = []; let off = 0;
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const [name, data] of entries) {
    const n = Buffer.from(name); const crc = zlib.crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    locals.push(lh, n, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, n); off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}

async function build(company, withFiles) {
  const entries = []; const counts = {};
  for (const t of TENANT_TABLES) {
    const hide = new Set(HIDE[t] || []);
    const rows = await db(t).select('*');
    let cols = rows.length ? Object.keys(rows[0]) : Object.keys(await db(t).columnInfo()); // an empty table still gets its column names
    cols = cols.filter((c) => !hide.has(c));
    const csv = `﻿${[cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n')}\r\n`;
    entries.push([`data/${t}.csv`, Buffer.from(csv)]);
    counts[t] = rows.length;
  }
  let skipped = '';
  if (withFiles) {
    const root = path.join(UPLOAD_ROOT, uploadSub());
    const files = [];
    const walk = (dir) => { if (!fs.existsSync(dir)) return; for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) walk(p); else files.push(p); } };
    walk(root);
    const total = files.reduce((n, f) => n + fs.statSync(f).size, 0);
    if (total > 300 * 1024 * 1024) skipped = 'The uploaded files are larger than 300 MB, so they were left out.\r\n';
    else for (const f of files) entries.push([`files/${path.relative(root, f).split(path.sep).join('/')}`, fs.readFileSync(f)]);
  }
  const readme = `WorkPilot data export\r\nCompany: ${company.name} (${company.code})\r\nCreated: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC\r\n\r\ndata/   one CSV file per table (open in Excel). Passwords and security codes are never included.\r\n${withFiles ? 'files/  uploaded documents, photos, logo and chat files.\r\n' : ''}${skipped}\r\nRows per table:\r\n${Object.entries(counts).map(([t, n]) => `  ${t}: ${n}\r\n`).join('')}`;
  entries.push(['README.txt', Buffer.from(readme)]);
  return zipBuffer(entries);
}

const send = (res, buf, name) => {
  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, '_')}"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
  res.send(buf);
};

const recent = new Map(); // at most 6 downloads an hour per company
export async function exportCompany(req, res) {
  const k = req.company.id; const now = Date.now();
  const list = (recent.get(k) || []).filter((t) => now - t < 3600000);
  if (list.length >= 6) throw new HttpError(429, 'You can download your data a few times an hour. Please try again later.');
  recent.set(k, [...list, now]);
  const withFiles = req.query.files === '1';
  await audit(req, 'company', req.company.id, 'export', null, { files: withFiles });
  send(res, await build(req.company, withFiles), `workpilot-${req.company.code}-${new Date().toISOString().slice(0, 10)}${withFiles ? '-with-files' : ''}.zip`);
}

export async function exportOneCompany(req, res) {
  const c = await db('companies').where({ id: req.params.id }).first();
  if (!c) throw new HttpError(404, 'Company not found');
  const buf = await runAs(c.prefix, () => build(c, req.query.files === '1'), c);
  send(res, buf, `workpilot-${c.code}-${new Date().toISOString().slice(0, 10)}.zip`);
}
