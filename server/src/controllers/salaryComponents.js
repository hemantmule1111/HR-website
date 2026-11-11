import { z } from 'zod';
import db from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { audit } from '../services/audit.js';

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'item';
const body = z.object({
  name: z.string().trim().min(2).max(80),
  kind: z.enum(['earning', 'deduction']).default('earning'),
  in_wages: z.boolean().default(false),
});

const shape = (c) => ({ ...c, is_standard: !!c.is_standard, active: !!c.active, in_wages: !!c.in_wages });
const sameName = (name) => db('salary_components').whereRaw('lower(name) = ?', [name.toLowerCase()]);

export async function listComponents(_req, res) {
  res.json((await db('salary_components').orderBy('sort_order').orderBy('id')).map(shape));
}

export async function addComponent(req, res) {
  const d = body.parse(req.body);
  if (await sameName(d.name).first()) throw new HttpError(409, 'A category with this name already exists');
  const prefix = d.kind === 'deduction' ? 'ded' : 'earn';
  let code = `${prefix}_${slug(d.name)}`;
  for (let i = 2; await db('salary_components').where({ code }).first(); i += 1) code = `${prefix}_${slug(d.name)}_${i}`;
  const last = await db('salary_components').max({ m: 'sort_order' }).first();
  const [id] = await db('salary_components').insert({
    code, name: d.name, kind: d.kind, in_wages: d.kind === 'earning' && d.in_wages, is_standard: false, active: true, sort_order: Number(last?.m || 100) + 1,
  });
  await audit(req, 'salary_component', id, 'create', null, d);
  res.status(201).json({ id });
}

export async function updateComponent(req, res) {
  const c = await db('salary_components').where({ id: req.params.id }).first();
  if (!c) throw new HttpError(404, 'Category not found');
  const d = z.object({ name: z.string().trim().min(2).max(80).optional(), active: z.boolean().optional(), in_wages: z.boolean().optional() }).parse(req.body);
  if (c.code === 'basic' && d.active === false) throw new HttpError(400, 'Basic salary cannot be switched off');
  if (d.name && (await sameName(d.name).whereNot({ id: c.id }).first())) throw new HttpError(409, 'A category with this name already exists');
  const patch = { ...d, updated_at: db.fn.now() };
  if (c.kind === 'deduction') delete patch.in_wages;
  await db('salary_components').where({ id: c.id }).update(patch);
  await audit(req, 'salary_component', c.id, 'update', c, d);
  res.json({ ok: true });
}

export async function deleteComponent(req, res) {
  const c = await db('salary_components').where({ id: req.params.id }).first();
  if (!c) throw new HttpError(404, 'Category not found');
  if (c.is_standard) throw new HttpError(400, 'Standard categories cannot be deleted. Switch them off instead.');
  const used = await db('salary_structure_items').where({ component_id: c.id }).where('amount', '>', 0).count({ n: 'component_id' }).first();
  if (Number(used.n) > 0) throw new HttpError(409, `${used.n} salary structure(s) use this category. Switch it off instead, or set it to 0 in those structures first.`);
  await db('salary_components').where({ id: c.id }).del();
  await audit(req, 'salary_component', c.id, 'delete', c);
  res.status(204).end();
}
