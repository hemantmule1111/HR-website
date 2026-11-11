import { z } from 'zod';
import db from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { audit } from '../services/audit.js';
import { getGeo } from '../services/geo.js';

// What an employee needs to know before punching: is the check on, and which places count. No coordinates are shown.
export async function publicGeo(_req, res) {
  const g = await getGeo();
  res.json({ enabled: g.enabled, max_accuracy_m: g.max_accuracy_m, locations: g.locations.filter((l) => l.active).map((l) => ({ id: l.id, name: l.name, radius_m: l.radius_m })) });
}

// The admin's full view (Master sheet).
export async function adminGeo(_req, res) { res.json(await getGeo()); }

const settingsSchema = z.object({ enabled: z.boolean(), max_accuracy_m: z.coerce.number().int().min(20).max(1000) });

export async function updateSettings(req, res) {
  const d = settingsSchema.parse(req.body);
  const g = await getGeo();
  if (d.enabled && !g.locations.some((l) => l.active)) throw new HttpError(400, 'Add at least one office location before switching the location check on.');
  await db('geo_settings').where({ id: 1 }).update({ ...d, updated_at: db.fn.now() });
  await audit(req, 'geo_settings', 1, 'update', { enabled: g.enabled, max_accuracy_m: g.max_accuracy_m }, d);
  res.json(await getGeo());
}

const locSchema = z.object({
  name: z.string().trim().min(2).max(100),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radius_m: z.coerce.number().int().min(20).max(5000),
  active: z.boolean().default(true),
});

export async function addLocation(req, res) {
  const d = locSchema.parse(req.body);
  const [id] = await db('office_locations').insert(d);
  await audit(req, 'office_location', id, 'create', null, d);
  res.status(201).json({ id });
}

async function assertStillCovered(id, willBeActive) {
  const g = await getGeo();
  if (g.enabled && !willBeActive && !g.locations.some((l) => l.active && l.id !== id)) throw new HttpError(400, 'The location check is on, so at least one office location must stay active. Switch the check off first.');
}

export async function updateLocation(req, res) {
  const l = await db('office_locations').where({ id: req.params.id }).first();
  if (!l) throw new HttpError(404, 'Location not found');
  const d = locSchema.parse(req.body);
  await assertStillCovered(l.id, d.active);
  await db('office_locations').where({ id: l.id }).update({ ...d, updated_at: db.fn.now() });
  await audit(req, 'office_location', l.id, 'update', l, d);
  res.json({ ok: true });
}

export async function deleteLocation(req, res) {
  const l = await db('office_locations').where({ id: req.params.id }).first();
  if (!l) throw new HttpError(404, 'Location not found');
  await assertStillCovered(l.id, false);
  await db('office_locations').where({ id: l.id }).del();
  await audit(req, 'office_location', l.id, 'delete', l);
  res.status(204).end();
}
