import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import db from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { audit } from '../services/audit.js';
import { assertAccess } from '../services/scope.js';
import { notifyEmployee } from '../services/notify.js';
import { shiftFor, evaluate, dayStatuses, localToTs } from '../services/attendance.js';
import { getRules, publicRules, qrToken, newDeviceKey, hashKey, deviceFromKey, UPLOAD_ROOT } from '../services/attendanceRules.js';
import { sendSafe } from '../utils/fileGuard.js';
import { ts, localParts, toMinutes, parseTs } from '../utils/dates.js';
import { autoOvertime } from './overtime.js';
import { currentCompany } from '../db/tenant.js';

// ---- settings ----
const schema = z.object({
  selfie_required: z.boolean(),
  qr_mode: z.enum(['off', 'optional', 'required']),
  late_halfday_after_min: z.coerce.number().int().min(0).max(480),
  early_halfday_before_min: z.coerce.number().int().min(0).max(480),
  late_penalty_on: z.boolean(),
  late_free_marks: z.coerce.number().int().min(0).max(31),
  auto_overtime: z.boolean(),
  auto_overtime_min: z.coerce.number().int().min(0).max(480),
  reminders: z.boolean(),
  remind_checkout_after_min: z.coerce.number().int().min(0).max(480),
  remind_checkin_after_min: z.coerce.number().int().min(0).max(480),
});

// Everyone gets the part they need to punch in; people who manage attendance see all of it.
export async function getSettings(req, res) {
  const rules = await getRules();
  res.json(req.user.permissions.has('attendance.manage') || req.user.permissions.has('attendance.view_all') ? rules : publicRules(rules));
}
export async function updateSettings(req, res) {
  const d = schema.parse(req.body);
  const before = await getRules();
  await db('attendance_settings').where({ id: 1 }).update({ ...d, updated_at: db.fn.now() });
  await audit(req, 'attendance_settings', 1, 'update', before, d);
  res.json(await getRules());
}

// The code shown on the office screen (changes every 30 seconds).
export async function qrCode(_req, res) {
  const rules = await getRules();
  if (rules.qr_mode === 'off') throw new HttpError(400, 'QR sign-in is switched off. Turn it on in the Master sheet first.');
  res.json({ token: await qrToken(), company: currentCompany()?.code || null, refresh_in: 30 });
}

// ---- selfies ----
export async function punchPhoto(req, res) {
  const kind = req.params.kind === 'out' ? 'out' : 'in';
  const rec = await db('attendance').where({ id: req.params.id }).first();
  if (!rec) throw new HttpError(404, 'Not found');
  if (rec.employee_id !== req.user.employeeId) await assertAccess(req.user, rec.employee_id, 'attendance.view_all');
  const rel = rec[`${kind}_photo`];
  if (!rel) throw new HttpError(404, 'No photo');
  const full = path.resolve(UPLOAD_ROOT, rel);
  if (!full.startsWith(UPLOAD_ROOT) || !fs.existsSync(full)) throw new HttpError(404, 'File missing');
  sendSafe(res, full, 'selfie.jpg', { inlineImages: true });
}

// ---- biometric / machine keys (admin) ----
export async function listDevices(_req, res) {
  res.json((await db('attendance_devices').orderBy('id')).map((d) => ({ id: d.id, name: d.name, active: !!d.active, last_seen: d.last_seen })));
}
export async function addDevice(req, res) {
  const { name } = z.object({ name: z.string().trim().min(2).max(100) }).parse(req.body);
  const key = newDeviceKey(currentCompany()?.id || 0);
  const [id] = await db('attendance_devices').insert({ name, key_hash: hashKey(key.split('.')[1]) });
  await audit(req, 'attendance_device', id, 'create', null, { name });
  res.status(201).json({ id, name, key }); // the only time the key is shown
}
export async function updateDevice(req, res) {
  const d = z.object({ active: z.boolean() }).parse(req.body);
  const n = await db('attendance_devices').where({ id: req.params.id }).update({ active: d.active, updated_at: db.fn.now() });
  if (!n) throw new HttpError(404, 'Device not found');
  await audit(req, 'attendance_device', req.params.id, d.active ? 'enable' : 'disable');
  res.json({ ok: true });
}
export async function deleteDevice(req, res) {
  const n = await db('attendance_devices').where({ id: req.params.id }).del();
  if (!n) throw new HttpError(404, 'Device not found');
  await audit(req, 'attendance_device', req.params.id, 'delete');
  res.status(204).end();
}

// ---- a machine sends punches: { punches: [{ emp_code, time? }] } with header X-Device-Key ----
const punchSchema = z.object({ punches: z.array(z.object({ emp_code: z.string().trim().min(1).max(40), time: z.string().trim().max(40).optional() })).min(1).max(500) });

function punchTime(raw) {
  if (!raw) return ts();
  const local = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?$/.exec(raw); // no zone given = the company's local time
  if (local) return localToTs(local[1], local[2]);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new Error('Time is not understood');
  return ts(d);
}

export async function devicePunch(req, res) {
  const dev = await deviceFromKey(req.headers['x-device-key']);
  if (!dev) throw new HttpError(401, 'Unknown or switched-off device key');
  await db('attendance_devices').where({ id: dev.id }).update({ last_seen: ts() });
  const { punches } = punchSchema.parse(req.body);
  const rules = await getRules();
  const rows = [];
  const skipped = [];
  for (const p of punches) {
    try { rows.push({ ...p, at: punchTime(p.time) }); } catch (e) { skipped.push({ emp_code: p.emp_code, reason: e.message }); }
  }
  rows.sort((a, b) => a.at.localeCompare(b.at));
  const nowTs = ts(new Date(Date.now() + 5 * 60000));
  const oldest = ts(new Date(Date.now() - 62 * 86400000));
  let saved = 0;
  for (const p of rows) {
    const emp = await db('employees').whereRaw('LOWER(emp_code) = ?', [p.emp_code.toLowerCase()]).first();
    if (!emp || emp.status === 'exited') { skipped.push({ emp_code: p.emp_code, reason: 'No active employee with this code' }); continue; }
    if (p.at > nowTs || p.at < oldest) { skipped.push({ emp_code: p.emp_code, reason: 'Time is in the future or more than 62 days old' }); continue; }
    const date = localParts(parseTs(p.at)).date;
    if (date < String(emp.join_date).slice(0, 10)) { skipped.push({ emp_code: p.emp_code, reason: 'Before the joining date' }); continue; }
    const shift = await shiftFor(emp);
    const rec = await db('attendance').where({ employee_id: emp.id, date }).first();
    if (!rec || !rec.check_in) {
      const calc = evaluate(shift, p.at, null, rules);
      if (rec) await db('attendance').where({ id: rec.id }).update({ check_in: p.at, source: 'device', ...calc, updated_at: db.fn.now() });
      else await db('attendance').insert({ employee_id: emp.id, date, check_in: p.at, source: 'device', ...calc });
      saved += 1;
      continue;
    }
    const gap = (a, b) => Math.abs(parseTs(a) - parseTs(b)) / 1000;
    if (gap(p.at, rec.check_in) < 120 || (rec.check_out && gap(p.at, rec.check_out) < 120)) { skipped.push({ emp_code: p.emp_code, reason: 'Same punch sent twice' }); continue; }
    let inT = rec.check_in;
    let outT = rec.check_out;
    if (p.at < inT) { outT = outT || inT; inT = p.at; } else if (!outT || p.at > outT) outT = p.at; else { skipped.push({ emp_code: p.emp_code, reason: 'Between the first and last punch of the day' }); continue; }
    await db('attendance').where({ id: rec.id }).update({ check_in: inT, check_out: outT, ...evaluate(shift, inT, outT, rules), updated_at: db.fn.now() });
    saved += 1;
    await autoOvertime(emp, date);
  }
  res.json({ saved, skipped });
}

// ---- reminders ----
export async function sendReminders() {
  const rules = await getRules();
  if (!rules.reminders) return 0;
  const now = localParts();
  if (now.minutes < 5 * 60) return 0;
  const emps = await db('employees').whereNot('status', 'exited').where('join_date', '<=', now.date);
  let sent = 0;
  for (const e of emps) {
    const shift = await shiftFor(e);
    const [day] = await dayStatuses(e, now.date, now.date);
    const start = toMinutes(shift.start_time);
    const end = toMinutes(shift.end_time);
    let kind = null;
    if (day.record?.check_in && !day.record.check_out && end > start && now.minutes >= end + rules.remind_checkout_after_min) kind = 'checkout';
    else if (day.status === 'pending' && rules.remind_checkin_after_min > 0 && now.minutes >= start + rules.remind_checkin_after_min && now.minutes < end) kind = 'checkin';
    if (!kind) continue;
    if (await db('attendance_reminders').where({ employee_id: e.id, date: now.date, kind }).first()) continue;
    await db('attendance_reminders').insert({ employee_id: e.id, date: now.date, kind });
    await notifyEmployee(e.id, kind === 'checkout'
      ? { type: 'attendance_reminder', title: 'Did you forget to check out?', body: 'Your shift has ended and you have not checked out yet. Check out now, or ask for a correction (regularization) if you left earlier.', link: '/attendance' }
      : { type: 'attendance_reminder', title: 'You have not checked in today', body: 'Your shift has started and there is no check-in for you yet. If you are on leave, ignore this.', link: '/attendance' });
    sent += 1;
  }
  return sent;
}
export async function remindersNow(_req, res) { res.json({ sent: await sendReminders() }); }
