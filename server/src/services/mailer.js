// Sending email. Set SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_SECURE (true for port 465) / MAIL_FROM / MAIL_FROM_NAME in .env.
// MAIL_LOG=true writes every email to server/mail-outbox.log instead of sending it (handy while developing).
// APP_URL is the address people open from email links (falls back to CLIENT_ORIGIN).
import fs from 'node:fs';
import nodemailer from 'nodemailer';
import { currentCompany } from '../db/tenant.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const appUrl = () => `${String(process.env.APP_URL || process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/+$/, '')}/`;
const clean = (s) => String(s ?? '').replace(/[\r\n\0]+/g, ' ').trim();

let transport = null;
const transportName = () => (process.env.MAIL_LOG === 'true' ? 'log' : process.env.SMTP_HOST ? 'smtp' : 'none');
function getTransport() {
  if (!transport && process.env.SMTP_HOST) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      connectionTimeout: 10000,
      socketTimeout: 15000,
    });
  }
  return transport;
}

// Sends one email now. Never throws: returns { sent, transport, error }.
export async function sendMail(to, subject, html, text = '') {
  const t = transportName();
  to = clean(to);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { sent: false, transport: t, error: 'Not a valid email address' };
  const plain = text || html.replace(/<(br|\/p|\/h\d|\/tr)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  try {
    if (t === 'log') {
      fs.appendFileSync(new URL('../../mail-outbox.log', import.meta.url), `${JSON.stringify({ time: new Date().toISOString(), to, subject, text: plain, html })}\n`);
    } else if (t === 'smtp') {
      await getTransport().sendMail({ from: `"${clean(process.env.MAIL_FROM_NAME || 'WorkPilot')}" <${clean(process.env.MAIL_FROM || process.env.SMTP_USER)}>`, to, subject: clean(subject), text: plain, html });
    } else {
      return { sent: false, transport: t, error: 'Email is not set up. Add the SMTP_* settings to .env.' };
    }
    return { sent: true, transport: t, error: null };
  } catch (e) {
    console.warn('mail failed:', to, e.message);
    return { sent: false, transport: t, error: e.message };
  }
}
// Fire and forget: a slow mail server never slows the request.
export const queueMail = (to, subject, html) => { sendMail(to, subject, html); };

// A plain, mobile-friendly email body. lines = paragraphs; facts = [[label, value]] shown in a box.
export function mailHtml(company, heading, lines = [], button = null, url = null, facts = [], foot = '') {
  const p = lines.filter(Boolean).map((l) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#334155">${esc(l)}</p>`).join('');
  const f = facts.length
    ? `<table role="presentation" style="width:100%;margin:6px 0 18px;border:1px solid #e2e8f0;border-radius:10px;border-collapse:separate;border-spacing:0">${facts.map(([k, v]) => `<tr><td style="padding:9px 14px;font-size:13px;color:#64748b;width:38%">${esc(k)}</td><td style="padding:9px 14px;font-size:15px;color:#0f172a;font-weight:600;word-break:break-all">${esc(v)}</td></tr>`).join('')}</table>`
    : '';
  const b = button && url
    ? `<p style="margin:18px 0"><a href="${esc(url)}" style="display:inline-block;background:#6366f1;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px">${esc(button)}</a></p><p style="margin:0 0 14px;font-size:12px;color:#94a3b8;word-break:break-all">If the button does not work, copy this address into your browser:<br>${esc(url)}</p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f4f5fb;font-family:Arial,Helvetica,sans-serif"><table role="presentation" style="width:100%;background:#f4f5fb;padding:24px 12px"><tr><td align="center"><table role="presentation" style="width:100%;max-width:560px;background:#ffffff;border-radius:14px;padding:28px"><tr><td><p style="margin:0 0 4px;font-size:13px;color:#6366f1;font-weight:700;letter-spacing:.04em;text-transform:uppercase">${esc(company)}</p><h1 style="margin:0 0 18px;font-size:21px;color:#0f172a">${esc(heading)}</h1>${p}${f}${b}${foot ? `<p style="margin:18px 0 0;font-size:12px;color:#94a3b8">${esc(foot)}</p>` : ''}</td></tr></table><p style="font-size:12px;color:#94a3b8;margin:14px 0 0">Sent by WorkPilot for ${esc(company)}. Please do not reply to this email.</p></td></tr></table></body></html>`;
}

const co = () => currentCompany() || { name: 'WorkPilot', code: '' };

// ---- the emails WorkPilot sends ----
export function mailWelcome(to, name, tempPassword, isReset = false) {
  const c = co();
  const url = `${appUrl()}login${c.code ? `?c=${encodeURIComponent(c.code)}` : ''}`;
  queueMail(to, isReset ? `Your ${c.name} password was reset` : `Welcome to ${c.name} on WorkPilot`, mailHtml(
    c.name, isReset ? 'Your password was reset' : `Welcome, ${name || 'there'}`,
    [isReset ? 'An administrator reset your password. Use the temporary password below to sign in.' : 'A WorkPilot account was created for you. Use the details below to sign in. You will find attendance, leave, payslips and more inside.', 'Please change this password after you sign in (top-right menu, Change password). Do not share it.'],
    'Sign in', url, [['Company code', c.code], ['Email', to], ['Temporary password', tempPassword]],
  ));
}

export function mailResetLink(to, token) {
  const c = co();
  const url = `${appUrl()}reset-password?t=${encodeURIComponent(token)}${c.code ? `&c=${encodeURIComponent(c.code)}` : ''}`;
  queueMail(to, `Reset your ${c.name} password`, mailHtml(c.name, 'Reset your password', ['We received a request to reset your WorkPilot password. The link below works for 1 hour and only once.', 'If you did not ask for this, you can ignore this email. Your password stays the same.'], 'Choose a new password', url));
}

export function mailPasswordChanged(to) {
  const c = co();
  queueMail(to, `Your ${c.name} password was changed`, mailHtml(c.name, 'Your password was changed', [`The password for ${to} was just changed.`, 'If this was you, nothing more is needed. If it was not you, ask your administrator to reset your password straight away.']));
}

export function mailNotification(to, { title, body, link }) {
  const c = co();
  const url = link ? `${appUrl()}${String(link).replace(/^\/+/, '')}` : null;
  queueMail(to, title, mailHtml(c.name, title, [body], url ? 'Open WorkPilot' : null, url));
}

export const mailTransportName = transportName;
