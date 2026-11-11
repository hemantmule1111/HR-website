import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { currentPrefix, uploadSub } from '../db/tenant.js';
import { guardUpload, sendSafe } from '../utils/fileGuard.js';
import { z } from 'zod';
import db from '../db/index.js';
import { HttpError } from '../utils/http.js';

const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR || './uploads');
const MAX_FILE = 10 * 1024 * 1024;
// Plain documents only: no ZIP, and no older Office formats (.doc, .xls, .ppt) because those can carry macros.
const FILE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.docx', '.xlsx', '.pptx', '.txt', '.csv']);
const CHAT_KINDS = ['png', 'jpg', 'gif', 'webp', 'pdf', 'docx', 'xlsx', 'pptx', 'txt', 'csv'];
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const ONLINE_MS = 70 * 1000;

const toMs = (v) => (v instanceof Date ? v.getTime() : v ? new Date(String(v).includes('T') ? v : `${String(v).replace(' ', 'T')}Z`).getTime() : 0);
const iso = (v) => (v ? new Date(toMs(v)).toISOString() : null);

// ---- presence: remember the last time each user hit the chat API ----
const touched = new Map();
export async function touch(req, _res, next) {
  const now = Date.now();
  const key = `${currentPrefix()}:${req.user.id}`; // user ids repeat across companies
  if (now - (touched.get(key) || 0) > 20000) {
    touched.set(key, now);
    await db('users').where({ id: req.user.id }).update({ last_seen_at: db.fn.now() });
  }
  next();
}

// ---- people ----
const peopleQuery = () =>
  db('users as u')
    .leftJoin('employees as e', 'e.id', 'u.employee_id')
    .leftJoin('roles as r', 'r.id', 'u.role_id')
    .leftJoin('designations as g', 'g.id', 'e.designation_id')
    .leftJoin('departments as d', 'd.id', 'e.department_id')
    .where('u.is_active', true)
    .select('u.id', 'u.email', 'u.last_seen_at', 'e.first_name', 'e.last_name', 'r.name as role', 'g.title as designation', 'd.name as department');

const person = (r, meId) => ({
  id: Number(r.id),
  name: r.first_name ? `${r.first_name} ${r.last_name || ''}`.trim() : String(r.email).split('@')[0],
  role: r.role,
  designation: r.designation || null,
  department: r.department || null,
  online: Number(r.id) === meId || Date.now() - toMs(r.last_seen_at) < ONLINE_MS,
});

export async function people(req, res) {
  const rows = await peopleQuery().whereNot('u.id', req.user.id).orderBy('e.first_name').orderBy('u.email');
  res.json(rows.map((r) => person(r, req.user.id)));
}

// ---- access ----
async function getConversation(id) {
  const c = await db('chat_conversations').where({ id }).first();
  if (!c) throw new HttpError(404, 'Conversation not found');
  return c;
}
async function assertMember(userId, convId) {
  const c = await getConversation(convId);
  if (c.type !== 'everyone' && !(await db('chat_members').where({ conversation_id: convId, user_id: userId }).first())) {
    throw new HttpError(403, 'Not permitted');
  }
  return c;
}
async function ensureEveryone() {
  if (await db('chat_conversations').where({ type: 'everyone' }).first()) return;
  const co = await db('company_profile').where({ id: 1 }).first().catch(() => null);
  await db('chat_conversations').insert({ type: 'everyone', name: `${co?.name || 'Company'} · Everyone` });
}

async function markRead(userId, convId, messageId) {
  const row = await db('chat_reads').where({ conversation_id: convId, user_id: userId }).first();
  if (!row) await db('chat_reads').insert({ conversation_id: convId, user_id: userId, last_read_id: messageId });
  else if (Number(row.last_read_id) < messageId) await db('chat_reads').where({ conversation_id: convId, user_id: userId }).update({ last_read_id: messageId });
}

// ---- conversations ----
async function summaries(userId, onlyId) {
  await ensureEveryone();
  const q = db('chat_conversations as c').where((b) =>
    b.where('c.type', 'everyone').orWhereIn('c.id', db('chat_members').where({ user_id: userId }).select('conversation_id')),
  );
  if (onlyId) q.where('c.id', onlyId);
  const convs = await q.select('c.*');
  if (!convs.length) return [];
  const ids = convs.map((c) => c.id);

  const lastIds = db('chat_messages').whereIn('conversation_id', ids).groupBy('conversation_id').select(db.raw('max(id) as id'));
  const lasts = await db('chat_messages as m').join('users as u', 'u.id', 'm.sender_id').leftJoin('employees as e', 'e.id', 'u.employee_id')
    .whereIn('m.id', lastIds).select('m.*', 'e.first_name', 'u.email');
  const lastBy = Object.fromEntries(lasts.map((m) => [m.conversation_id, m]));

  const unreadRows = await db('chat_messages as m')
    .leftJoin('chat_reads as r', function join() { this.on('r.conversation_id', 'm.conversation_id').andOn('r.user_id', db.raw('?', [userId])); })
    .whereIn('m.conversation_id', ids).whereNot('m.sender_id', userId).whereNull('m.deleted_at')
    .whereRaw('m.id > coalesce(r.last_read_id, 0)')
    .groupBy('m.conversation_id').select('m.conversation_id', db.raw('count(*) as n'));
  const unreadBy = Object.fromEntries(unreadRows.map((r) => [r.conversation_id, Number(r.n)]));

  const members = await db('chat_members').whereIn('conversation_id', ids).select('conversation_id', 'user_id');
  const memberIds = {};
  for (const m of members) (memberIds[m.conversation_id] ||= []).push(Number(m.user_id));
  const dmOthers = [...new Set(convs.filter((c) => c.type === 'direct').flatMap((c) => (memberIds[c.id] || []).filter((x) => x !== userId)))];
  const others = dmOthers.length ? Object.fromEntries((await peopleQuery().whereIn('u.id', dmOthers)).map((r) => [Number(r.id), person(r, userId)])) : {};
  const everyoneCount = Number((await db('users').where({ is_active: true }).count({ n: '*' }).first()).n);

  return convs.map((c) => {
    const m = lastBy[c.id];
    const other = c.type === 'direct' ? others[(memberIds[c.id] || []).find((x) => x !== userId)] || null : null;
    return {
      id: Number(c.id),
      type: c.type,
      name: other ? other.name : c.name,
      other,
      member_count: c.type === 'everyone' ? everyoneCount : (memberIds[c.id] || []).length,
      created_by: c.created_by ? Number(c.created_by) : null,
      unread: unreadBy[c.id] || 0,
      updated_at: iso(m?.created_at || c.created_at),
      last: m ? {
        id: Number(m.id), sender_id: Number(m.sender_id), mine: Number(m.sender_id) === userId,
        sender_name: m.first_name || String(m.email).split('@')[0], deleted: !!m.deleted_at,
        body: m.deleted_at ? null : m.body, file_name: m.deleted_at ? null : m.file_name, created_at: iso(m.created_at),
      } : null,
    };
  }).sort((a, b) => toMs(b.updated_at) - toMs(a.updated_at));
}

export async function listConversations(req, res) {
  res.json(await summaries(req.user.id));
}

export async function unread(req, res) {
  const list = await summaries(req.user.id);
  res.json({ total: list.reduce((n, c) => n + c.unread, 0) });
}

const createSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('direct'), user_id: z.coerce.number().int() }),
  z.object({ type: z.literal('group'), name: z.string().trim().min(1).max(100), member_ids: z.array(z.coerce.number().int()).min(1).max(200) }),
]);

export async function createConversation(req, res) {
  const data = createSchema.parse(req.body);
  const me = req.user.id;
  let id;
  if (data.type === 'direct') {
    if (data.user_id === me) throw new HttpError(400, 'You cannot chat with yourself');
    if (!(await db('users').where({ id: data.user_id, is_active: true }).first())) throw new HttpError(404, 'User not found');
    const key = `${Math.min(me, data.user_id)}:${Math.max(me, data.user_id)}`;
    const existing = await db('chat_conversations').where({ direct_key: key }).first();
    if (existing) id = existing.id;
    else {
      id = await db.transaction(async (trx) => {
        const [cid] = await trx('chat_conversations').insert({ type: 'direct', direct_key: key, created_by: me });
        await trx('chat_members').insert([{ conversation_id: cid, user_id: me }, { conversation_id: cid, user_id: data.user_id }]);
        return cid;
      });
    }
  } else {
    const ids = [...new Set([me, ...data.member_ids])];
    const valid = await db('users').whereIn('id', ids).where({ is_active: true }).pluck('id');
    if (valid.length < 2) throw new HttpError(400, 'Pick at least one other person');
    id = await db.transaction(async (trx) => {
      const [cid] = await trx('chat_conversations').insert({ type: 'group', name: data.name, created_by: me });
      await trx('chat_members').insert(valid.map((u) => ({ conversation_id: cid, user_id: u })));
      return cid;
    });
  }
  const [summary] = await summaries(me, id);
  res.status(201).json(summary);
}

export async function conversationInfo(req, res) {
  const c = await assertMember(req.user.id, req.params.id);
  const rows = c.type === 'everyone'
    ? await peopleQuery().orderBy('e.first_name')
    : await peopleQuery().whereIn('u.id', db('chat_members').where({ conversation_id: c.id }).select('user_id')).orderBy('e.first_name');
  res.json({ id: Number(c.id), type: c.type, name: c.name, created_by: c.created_by ? Number(c.created_by) : null, members: rows.map((r) => person(r, req.user.id)) });
}

export async function addMembers(req, res) {
  const c = await assertMember(req.user.id, req.params.id);
  if (c.type !== 'group') throw new HttpError(400, 'Members can only be added to group chats');
  const { user_ids } = z.object({ user_ids: z.array(z.coerce.number().int()).min(1).max(200) }).parse(req.body);
  const valid = await db('users').whereIn('id', user_ids).where({ is_active: true }).pluck('id');
  const have = new Set((await db('chat_members').where({ conversation_id: c.id }).pluck('user_id')).map(Number));
  const fresh = valid.filter((u) => !have.has(Number(u)));
  if (fresh.length) await db('chat_members').insert(fresh.map((u) => ({ conversation_id: c.id, user_id: u })));
  res.json({ added: fresh.length });
}

export async function leave(req, res) {
  const c = await assertMember(req.user.id, req.params.id);
  if (c.type !== 'group') throw new HttpError(400, 'You can only leave group chats');
  await db('chat_members').where({ conversation_id: c.id, user_id: req.user.id }).del();
  res.status(204).end();
}

// ---- messages ----
const shape = (m, meId, readers) => ({
  id: Number(m.id),
  sender_id: Number(m.sender_id),
  sender_name: m.first_name ? `${m.first_name} ${m.last_name || ''}`.trim() : String(m.email).split('@')[0],
  mine: Number(m.sender_id) === meId,
  body: m.deleted_at ? null : m.body,
  deleted: !!m.deleted_at,
  file: !m.deleted_at && m.file_name ? { name: m.file_name, mime: m.file_mime, size: m.file_size, image: /^image\//.test(m.file_mime || '') } : null,
  created_at: iso(m.created_at),
  read_by: Number(m.sender_id) === meId ? readers.filter((r) => Number(r.user_id) !== meId && Number(r.last_read_id) >= Number(m.id)).length : 0,
});

const withSender = () => db('chat_messages as m').join('users as u', 'u.id', 'm.sender_id').leftJoin('employees as e', 'e.id', 'u.employee_id')
  .select('m.*', 'e.first_name', 'e.last_name', 'u.email');

export async function listMessages(req, res) {
  const c = await assertMember(req.user.id, req.params.id);
  const limit = Math.min(Number(req.query.limit) || 60, 300);
  const rows = (await withSender().where('m.conversation_id', c.id).orderBy('m.id', 'desc').limit(limit)).reverse();
  const readers = await db('chat_reads').where({ conversation_id: c.id });
  const mine = readers.find((r) => Number(r.user_id) === req.user.id);
  res.json({ messages: rows.map((m) => shape(m, req.user.id, readers)), has_more: rows.length === limit, last_read_id: Number(mine?.last_read_id || 0) });
}

export async function markConversationRead(req, res) {
  const c = await assertMember(req.user.id, req.params.id);
  const last = await db('chat_messages').where({ conversation_id: c.id }).max({ m: 'id' }).first();
  if (last?.m) await markRead(req.user.id, c.id, Number(last.m));
  res.status(204).end();
}

// Check membership before multer touches the disk.
export const sendGate = async (req, _res, next) => {
  try { await assertMember(req.user.id, req.params.id); next(); } catch (e) { next(e); }
};
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _f, cb) => {
      const dir = path.join(UPLOAD_ROOT, uploadSub(), 'chat', String(req.params.id));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_r, _f, cb) => cb(null, crypto.randomUUID()),
  }),
  limits: { fileSize: MAX_FILE },
  fileFilter: (_r, f, cb) => (FILE_EXT.has(path.extname(f.originalname).toLowerCase())
    ? cb(null, true)
    : cb(new HttpError(400, 'This file type is not allowed. Use images, PDF, Word, Excel, PowerPoint, TXT or CSV.'))),
});
export const uploadMiddleware = [upload.single('file'), guardUpload(CHAT_KINDS)];

export async function sendMessage(req, res) {
  const c = await assertMember(req.user.id, req.params.id);
  const { body } = z.object({ body: z.string().max(4000).optional() }).parse(req.body);
  const text = (body || '').trim();
  if (!text && !req.file) throw new HttpError(400, 'Type a message or attach a file');
  const f = req.file;
  const [id] = await db('chat_messages').insert({
    conversation_id: c.id, sender_id: req.user.id, body: text || null,
    ...(f ? { file_path: path.relative(UPLOAD_ROOT, f.path), file_name: Buffer.from(f.originalname, 'latin1').toString('utf8').slice(0, 250), file_mime: f.mimetype, file_size: f.size } : {}),
  });
  await db('chat_conversations').where({ id: c.id }).update({ last_message_at: db.fn.now(), updated_at: db.fn.now() });
  await markRead(req.user.id, c.id, Number(id));
  const m = await withSender().where('m.id', id).first();
  res.status(201).json(shape(m, req.user.id, []));
}

export async function deleteMessage(req, res) {
  const m = await db('chat_messages').where({ id: req.params.id }).first();
  if (!m) throw new HttpError(404, 'Message not found');
  if (Number(m.sender_id) !== req.user.id) throw new HttpError(403, 'You can only delete your own messages');
  await db('chat_messages').where({ id: m.id }).update({ deleted_at: db.fn.now(), body: null, file_path: null, file_name: null, file_mime: null, file_size: null });
  if (m.file_path) fs.rm(path.resolve(UPLOAD_ROOT, m.file_path), { force: true }, () => {});
  res.status(204).end();
}

export async function downloadFile(req, res) {
  const m = await db('chat_messages').where({ id: req.params.id }).first();
  if (!m || m.deleted_at || !m.file_path) throw new HttpError(404, 'File not found');
  await assertMember(req.user.id, m.conversation_id);
  const full = path.resolve(UPLOAD_ROOT, m.file_path);
  if (!full.startsWith(UPLOAD_ROOT) || !fs.existsSync(full)) throw new HttpError(404, 'File missing');
  return sendSafe(res, full, m.file_name, { inlineImages: true });
}
