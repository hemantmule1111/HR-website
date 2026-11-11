import { z } from 'zod';
import db from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { audit } from '../services/audit.js';
import { dateStr, timeStr, optional } from '../utils/validators.js';

// Generic CRUD factory for master tables. `hard` tables are deleted; others are soft-deactivated.
export function orgCrud(table, entity, fields, { hard = false, orderBy = 'id' } = {}) {
  const schema = z.object(fields);
  const partial = schema.partial();
  const find = async (id) => {
    const row = await db(table).where({ id }).first();
    if (!row) throw new HttpError(404, 'Not found');
    return row;
  };
  return {
    async list(_req, res) {
      res.json(await db(table).orderBy(orderBy));
    },
    async create(req, res) {
      const data = schema.parse(req.body);
      const [id] = await db(table).insert(data);
      await audit(req, entity, id, 'create', null, data);
      res.status(201).json(await find(id));
    },
    async update(req, res) {
      const data = partial.parse(req.body);
      const before = await find(req.params.id);
      await db(table).where({ id: before.id }).update({ ...data, ...(before.updated_at !== undefined ? { updated_at: db.fn.now() } : {}) });
      const after = await find(before.id);
      await audit(req, entity, before.id, 'update', before, after);
      res.json(after);
    },
    async remove(req, res) {
      const before = await find(req.params.id);
      if (hard) await db(table).where({ id: before.id }).del();
      else await db(table).where({ id: before.id }).update({ status: 'inactive' });
      await audit(req, entity, before.id, hard ? 'delete' : 'deactivate', before, null);
      res.status(204).end();
    },
  };
}

const status = z.enum(['active', 'inactive']).optional();
const num = z.coerce.number();

export const departments = orgCrud('departments', 'department', {
  name: z.string().min(1).max(100),
  head_employee_id: optional(z.coerce.number().int()),
  status,
});

export const designations = orgCrud('designations', 'designation', {
  title: z.string().min(1).max(100),
  level: z.coerce.number().int().min(1).max(20).optional(),
  status,
});

export const shifts = orgCrud('shifts', 'shift', {
  name: z.string().min(1).max(80),
  start_time: timeStr,
  end_time: timeStr,
  grace_minutes: z.coerce.number().int().min(0).max(120),
  half_day_minutes: z.coerce.number().int().min(0).max(600),
  weekly_offs: z.string().regex(/^[0-6](,[0-6])*$|^$/),
  status,
});

export const leaveTypes = orgCrud('leave_types', 'leave_type', {
  name: z.string().min(1).max(60),
  code: z.string().min(1).max(10),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  annual_quota: num.min(0).max(365),
  carry_forward_max: num.min(0).max(365).optional(),
  is_paid: z.boolean().optional(),
  allow_half_day: z.boolean().optional(),
  count_weekoffs: z.boolean().optional(),
  status,
});

export const holidays = orgCrud(
  'holidays',
  'holiday',
  { date: dateStr, name: z.string().min(1).max(100), is_optional: z.boolean().optional() },
  { hard: true, orderBy: 'date' },
);
