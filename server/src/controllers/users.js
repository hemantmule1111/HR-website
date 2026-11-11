import crypto from 'node:crypto';
import { mailWelcome } from '../services/mailer.js';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import db from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { audit } from '../services/audit.js';

const createSchema = z.object({
  email: z.string().email(),
  role_id: z.coerce.number().int(),
  employee_id: z.coerce.number().int().nullish(),
});
const updateSchema = z.object({ role_id: z.coerce.number().int().optional(), is_active: z.boolean().optional() });

const base = () =>
  db('users as u')
    .join('roles as r', 'r.id', 'u.role_id')
    .leftJoin('employees as e', 'e.id', 'u.employee_id')
    .select('u.id', 'u.email', 'u.is_active', 'u.last_login_at', 'u.role_id', 'r.name as role', 'u.employee_id', 'e.first_name', 'e.last_name', 'e.emp_code');

export async function list(_req, res) {
  res.json(await base().orderBy('u.id'));
}

export async function roles(_req, res) {
  res.json(await db('roles').select('id', 'name').orderBy('id'));
}

export async function create(req, res) {
  const d = createSchema.parse(req.body);
  const temp = crypto.randomBytes(6).toString('base64url');
  const [id] = await db('users').insert({
    email: d.email, role_id: d.role_id, employee_id: d.employee_id ?? null, password_hash: await bcrypt.hash(temp, 12), must_change_password: true,
  });
  await audit(req, 'user', id, 'create', null, { email: d.email, role_id: d.role_id });
  mailWelcome(d.email, '', temp);
  res.status(201).json({ ...(await base().where('u.id', id).first()), temp_password: temp });
}

export async function update(req, res) {
  const d = updateSchema.parse(req.body);
  const user = await db('users').where({ id: req.params.id }).first();
  if (!user) throw new HttpError(404, 'User not found');
  if (user.id === req.user.id && (d.is_active === false || (d.role_id && d.role_id !== user.role_id))) {
    throw new HttpError(400, 'You cannot change your own role or deactivate yourself');
  }
  await db('users').where({ id: user.id }).update({ ...d, updated_at: db.fn.now() });
  await audit(req, 'user', user.id, 'update', { role_id: user.role_id, is_active: user.is_active }, d);
  res.json(await base().where('u.id', user.id).first());
}

export async function resetPassword(req, res) {
  const user = await db('users').where({ id: req.params.id }).first();
  if (!user) throw new HttpError(404, 'User not found');
  const temp = crypto.randomBytes(6).toString('base64url');
  await db('users').where({ id: user.id }).update({ password_hash: await bcrypt.hash(temp, 12), failed_logins: 0, locked_until: null, must_change_password: true });
  await audit(req, 'user', user.id, 'reset_password');
  mailWelcome(user.email, '', temp, true);
  res.json({ temp_password: temp });
}
