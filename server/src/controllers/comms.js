import { z } from 'zod';
import db from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { audit } from '../services/audit.js';
import { notifyUsers } from '../services/notify.js';
import { ts } from '../utils/dates.js';

// ---- Notifications ----
export async function listNotifications(req, res) {
  const items = await db('notifications').where({ user_id: req.user.id }).orderBy('id', 'desc').limit(50);
  const unread = await db('notifications').where({ user_id: req.user.id }).whereNull('read_at').count({ c: 'id' }).first();
  res.json({ unread: Number(unread.c), items });
}

export async function markRead(req, res) {
  await db('notifications').where({ id: req.params.id, user_id: req.user.id }).update({ read_at: ts() });
  res.status(204).end();
}

export async function markAllRead(req, res) {
  await db('notifications').where({ user_id: req.user.id }).whereNull('read_at').update({ read_at: ts() });
  res.status(204).end();
}

// ---- Announcements ----
const schema = z.object({ title: z.string().min(1).max(150), body: z.string().min(1).max(5000), pinned: z.boolean().optional() });

export async function listAnnouncements(_req, res) {
  res.json(await db('announcements').orderBy('pinned', 'desc').orderBy('id', 'desc').limit(50));
}

export async function createAnnouncement(req, res) {
  const d = schema.parse(req.body);
  const [id] = await db('announcements').insert({ ...d, created_by: req.user.id });
  await audit(req, 'announcement', id, 'create', null, d);
  const users = await db('users').where({ is_active: true }).whereNot({ id: req.user.id }).pluck('id');
  await notifyUsers(users, { type: 'announcement', title: d.title, body: d.body.slice(0, 200), link: '/' });
  res.status(201).json(await db('announcements').where({ id }).first());
}

export async function updateAnnouncement(req, res) {
  const d = schema.partial().parse(req.body);
  const before = await db('announcements').where({ id: req.params.id }).first();
  if (!before) throw new HttpError(404, 'Not found');
  await db('announcements').where({ id: before.id }).update({ ...d, updated_at: db.fn.now() });
  await audit(req, 'announcement', before.id, 'update', before, d);
  res.json(await db('announcements').where({ id: before.id }).first());
}

export async function deleteAnnouncement(req, res) {
  const before = await db('announcements').where({ id: req.params.id }).first();
  if (!before) throw new HttpError(404, 'Not found');
  await db('announcements').where({ id: before.id }).del();
  await audit(req, 'announcement', before.id, 'delete', before);
  res.status(204).end();
}
