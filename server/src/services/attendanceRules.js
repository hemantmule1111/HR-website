// Attendance rules: settings, selfie storage, QR sign-in codes, biometric device keys, reminders.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import db from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { uploadSub } from '../db/tenant.js';
import { randomName } from '../utils/fileGuard.js';

export const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR || './uploads');

export async function getRules() {
  const s = await db('attendance_settings').where({ id: 1 }).first();
  const { qr_secret, ...rest } = s;
  return { ...rest, selfie_required: !!s.selfie_required, late_penalty_on: !!s.late_penalty_on, auto_overtime: !!s.auto_overtime, reminders: !!s.reminders };
}
// What every signed-in person needs to know to punch in.
export const publicRules = (r) => ({ selfie_required: r.selfie_required, qr_mode: r.qr_mode });

// ---- QR sign-in: a code that changes every 30 seconds and is shown on a screen at the office ----
async function qrSecret() {
  const s = await db('attendance_settings').where({ id: 1 }).first();
  if (s.qr_secret) return s.qr_secret;
  const secret = crypto.randomBytes(32).toString('hex');
  await db('attendance_settings').where({ id: 1 }).update({ qr_secret: secret });
  return secret;
}
const sig = (secret, w) => crypto.createHmac('sha256', secret).update(`qr:${w}`).digest('hex').slice(0, 24);
export async function qrToken() {
  const w = Math.floor(Date.now() / 30000);
  return `${w}.${sig(await qrSecret(), w)}`;
}
async function qrValid(token) {
  const m = /^(\d{1,12})\.([0-9a-f]{24})$/.exec(String(token || ''));
  if (!m) return false;
  const w = Number(m[1]);
  const now = Math.floor(Date.now() / 30000);
  if (now - w > 8 || w > now + 1) return false; // good for about four minutes, enough to scan, open the app and sign in
  const want = Buffer.from(sig(await qrSecret(), w));
  const got = Buffer.from(m[2]);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
// Returns the source of the punch: 'qr' or 'web'. Throws when a code is needed and missing, or is old.
export async function punchSource(rules, body) {
  const code = body?.qr;
  if (rules.qr_mode === 'required' && !code) throw new HttpError(403, 'Scan the QR code shown at the office to check in or out.');
  if (code && rules.qr_mode !== 'off') {
    if (!(await qrValid(code))) throw new HttpError(400, 'That QR code has expired. Please scan the screen at the office again.');
    return 'qr';
  }
  return 'web';
}

// ---- Selfie at punch time ----
// A small JPEG taken by the browser camera, sent as text. Anything that is not a clean JPEG is refused.
export function saveSelfie(photo, required) {
  if (!photo) {
    if (required) throw new HttpError(400, 'A selfie is needed to check in. Allow camera access in your browser and take a photo.');
    return null;
  }
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(photo));
  if (!m) throw new HttpError(400, 'The selfie must be a JPEG photo.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length < 1000 || buf.length > 300000) throw new HttpError(400, 'The selfie is too small or too large.');
  if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff || buf[buf.length - 2] !== 0xff || buf[buf.length - 1] !== 0xd9) throw new HttpError(400, 'The selfie is not a valid JPEG photo.');
  const text = buf.toString('latin1').toLowerCase();
  if (text.includes('<?php') || text.includes('<script')) throw new HttpError(400, 'The selfie is not a valid JPEG photo.');
  const dir = path.join(UPLOAD_ROOT, uploadSub(), 'attendance');
  fs.mkdirSync(dir, { recursive: true });
  const full = path.join(dir, `${randomName()}.jpg`);
  fs.writeFileSync(full, buf);
  return path.relative(UPLOAD_ROOT, full).split(path.sep).join('/');
}

// ---- Biometric / machine keys: stored as a hash, shown once when made ----
export const hashKey = (k) => crypto.createHash('sha256').update(String(k)).digest('hex');
export function newDeviceKey(companyId) {
  return `${companyId}.${crypto.randomBytes(24).toString('hex')}`;
}
export async function deviceFromKey(key) {
  const secret = String(key || '').split('.')[1];
  if (!secret) return null;
  const d = await db('attendance_devices').where({ key_hash: hashKey(secret), active: true }).first();
  return d || null;
}

const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export { hhmm };
