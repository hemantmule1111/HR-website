import db from '../db/index.js';
import { HttpError } from '../utils/http.js';
import { featuresOf } from './features.js';
import { currentCompany } from '../db/tenant.js';

export async function getGeo() {
  const s = await db('geo_settings').where({ id: 1 }).first();
  const locations = (await db('office_locations').orderBy('id')).map((l) => ({ ...l, latitude: Number(l.latitude), longitude: Number(l.longitude), active: !!l.active }));
  return { enabled: !!s.enabled && featuresOf(currentCompany()).geo, max_accuracy_m: Number(s.max_accuracy_m), locations };
}

// Distance between two points on the earth, in metres (haversine).
export function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

// Checks the position sent with a check-in / check-out. When the admin has switched the location check on, a punch without a
// position, with a vague position, or from outside every office location is refused. Returns the columns to store, or {}.
export async function verifyPunch(body, prefix) {
  const geo = await getGeo();
  const lat = num(body?.latitude), lng = num(body?.longitude), acc = num(body?.accuracy);
  const have = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  if (!geo.enabled) return have ? { [`${prefix}_lat`]: lat, [`${prefix}_lng`]: lng, [`${prefix}_accuracy`]: Number.isFinite(acc) ? Math.round(acc) : null } : {};
  const active = geo.locations.filter((l) => l.active);
  if (!have) throw new HttpError(400, 'Your location is required. Allow location access in your browser (the padlock next to the address) and try again.');
  if (!Number.isFinite(acc) || acc > geo.max_accuracy_m) {
    throw new HttpError(400, `Your phone or computer could not find your location precisely enough${Number.isFinite(acc) ? ` (${Math.round(acc)} m)` : ''}. Turn on GPS or Wi-Fi, move near a window, and try again.`);
  }
  let best = null;
  for (const l of active) {
    const d = distanceM(lat, lng, l.latitude, l.longitude);
    if (!best || d - l.radius_m < best.d - best.l.radius_m) best = { l, d };
  }
  if (!best) throw new HttpError(403, 'No office location has been set up. Please ask your admin.');
  if (best.d > best.l.radius_m) {
    const far = best.d >= 1000 ? `${(best.d / 1000).toFixed(1)} km` : `${Math.round(best.d)} m`;
    throw new HttpError(403, `You are ${far} away from ${best.l.name}. You can only check in within ${best.l.radius_m} m of the office.`);
  }
  return { [`${prefix}_lat`]: lat, [`${prefix}_lng`]: lng, [`${prefix}_accuracy`]: Math.round(acc), [`${prefix}_location`]: best.l.name };
}
