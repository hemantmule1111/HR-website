import { z } from 'zod';

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const monthStr = z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM');
export const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
export const id = z.coerce.number().int().positive();

// Empty strings from forms become null so optional columns stay clean.
export const blankToNull = (v) => (v === '' ? null : v);
export const optional = (schema) => z.preprocess(blankToNull, schema.nullish());

export function csv(rows, columns) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(','))].join('\n');
}
