// An email to the owner when the server hits an unexpected error. Set ERROR_ALERT_EMAIL in .env (empty = no emails).
// The same error is emailed at most once every 15 minutes, and nothing a user typed (no request body, no query) is included.
import { sendMail, mailHtml } from './mailer.js';

const seen = new Map();
export function alertError(err, req) {
  const to = String(process.env.ERROR_ALERT_EMAIL || '').trim();
  if (!to) return;
  const where = `${req?.method || ''} ${String(req?.path || '').replace(/\/\d+/g, '/:id')}`.trim();
  const key = `${err?.message}|${where}`.slice(0, 200);
  const last = seen.get(key) || 0;
  if (Date.now() - last < 15 * 60000) return;
  seen.set(key, Date.now());
  if (seen.size > 200) seen.delete(seen.keys().next().value);
  const stack = String(err?.stack || '').split('\n').slice(0, 6).join('\n');
  sendMail(to, 'WorkPilot error: ' + String(err?.message || 'Server error').slice(0, 80), mailHtml('WorkPilot', 'The server hit an error', [
    `When: ${new Date().toISOString()}`, `Where: ${where || 'unknown'}`, `Company: ${req?.company?.code || 'n/a'}`, `Error: ${err?.message || 'unknown'}`, stack,
  ])).catch(() => {});
}
