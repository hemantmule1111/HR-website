import { HttpError } from './http.js';

// Length (10+) is checked by the schemas; this refuses the passwords attackers try first.
const COMMON = ['password', 'passw0rd', '1234567890', '0123456789', 'qwertyuiop', 'qwerty1234', 'letmein123', 'welcome123', 'admin12345', 'changeme123', 'iloveyou12', 'abcdefghij', 'workpilot'];

export function weakPassword(pw, email) {
  const l = String(pw).toLowerCase();
  if (COMMON.some((c) => l.includes(c))) return 'That password is too easy to guess. Choose something less common.';
  if (new Set(pw).size < 5) return 'That password is too repetitive. Use a mix of letters, numbers and symbols.';
  const name = String(email || '').split('@')[0].toLowerCase();
  if (name.length >= 4 && l.includes(name)) return 'Your password should not contain your email name.';
  return null;
}

export function requireStrongPassword(pw, email) {
  const w = weakPassword(pw, email);
  if (w) throw new HttpError(400, w);
}
