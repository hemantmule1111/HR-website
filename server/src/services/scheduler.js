// Background jobs: every few minutes, each company gets its attendance reminders ("you forgot to check out").
import db from '../db/index.js';
import { runAs, runWithoutCompany } from '../db/tenant.js';
import { assertUsable } from './tenants.js';
import { sendReminders } from '../controllers/attendanceAdmin.js';

let busy = false;
export async function tick() {
  if (busy) return;
  busy = true;
  try {
    const companies = await runWithoutCompany(() => db('companies'));
    for (const c of companies) {
      try {
        assertUsable(c);
        await runAs(c.prefix, () => sendReminders(), c);
      } catch (e) {
        if (!/subscription|suspend|expired|inactive|not active/i.test(e.message)) console.warn(`reminders for ${c.code}:`, e.message);
      }
    }
  } finally { busy = false; }
}
export function startScheduler() {
  if (process.env.DISABLE_SCHEDULER === 'true') return;
  setInterval(() => tick().catch((e) => console.warn('scheduler:', e.message)), 5 * 60 * 1000).unref();
}
