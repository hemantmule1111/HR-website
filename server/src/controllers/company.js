import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { uploadSub } from '../db/tenant.js';
import { guardUpload, sendSafe } from '../utils/fileGuard.js';
import { z } from 'zod';
import db from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { audit } from '../services/audit.js';

const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR || './uploads');
const txt = (n) => z.string().max(n).optional().transform((v) => (v ? v.trim() : null));

const schema = z.object({
  name: z.string().trim().min(1).max(150),
  tagline: txt(200), address: txt(400), phone: txt(40), email: txt(150), website: txt(150), tax_id: txt(80),
  accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colour must look like #4f46e5').default('#4f46e5'),
  signatory_name: txt(100), signatory_title: txt(100), payslip_footer: txt(400),
});

const present = ({ logo_path, ...c }) => ({ ...c, has_logo: !!logo_path });
const load = async () => (await db('company_profile').where({ id: 1 }).first()) || { id: 1, name: '', accent_color: '#4f46e5' };

export async function get(_req, res) {
  res.json(present(await load()));
}

export async function update(req, res) {
  const data = schema.parse(req.body);
  const before = await load();
  const exists = await db('company_profile').where({ id: 1 }).first();
  if (exists) await db('company_profile').where({ id: 1 }).update({ ...data, updated_at: db.fn.now() });
  else await db('company_profile').insert({ id: 1, ...data });
  await audit(req, 'company_profile', 1, 'update', present(before), data);
  res.json(present(await load()));
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_r, _f, cb) => { const d = path.join(UPLOAD_ROOT, uploadSub(), 'company'); fs.mkdirSync(d, { recursive: true }); cb(null, d); },
    filename: (_r, _f, cb) => cb(null, `logo-${crypto.randomUUID()}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
});
export const uploadMiddleware = [upload.single('file'), guardUpload(['png', 'jpg'])];

const removeFile = (p) => p && fs.rm(path.resolve(UPLOAD_ROOT, p), { force: true }, () => {});

export async function setLogo(req, res) {
  if (!req.file) throw new HttpError(400, 'Logo file is required');
  const before = await load();
  const patch = { logo_path: path.relative(UPLOAD_ROOT, req.file.path), logo_mime: req.file.mimetype, updated_at: db.fn.now() };
  if (await db('company_profile').where({ id: 1 }).first()) await db('company_profile').where({ id: 1 }).update(patch);
  else await db('company_profile').insert({ id: 1, name: '', ...patch });
  removeFile(before.logo_path);
  await audit(req, 'company_profile', 1, 'logo_upload');
  res.json(present(await load()));
}

export async function deleteLogo(req, res) {
  const before = await load();
  await db('company_profile').where({ id: 1 }).update({ logo_path: null, logo_mime: null, updated_at: db.fn.now() });
  removeFile(before.logo_path);
  await audit(req, 'company_profile', 1, 'logo_delete');
  res.json(present(await load()));
}

export async function logo(_req, res) {
  const c = await load();
  const full = c.logo_path && path.resolve(UPLOAD_ROOT, c.logo_path);
  if (!full || !full.startsWith(UPLOAD_ROOT) || !fs.existsSync(full)) throw new HttpError(404, 'No logo');
  sendSafe(res, full, 'logo', { inlineImages: true });
}
