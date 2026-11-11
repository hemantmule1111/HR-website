// All stored timestamps are UTC strings 'YYYY-MM-DD HH:MM:SS'; calendar dates are 'YYYY-MM-DD' in company time.
export const TZ = process.env.COMPANY_TZ || 'Asia/Kolkata';

export const ts = (d = new Date()) => d.toISOString().slice(0, 19).replace('T', ' ');
export const parseTs = (s) => (s ? new Date(`${String(s).replace(' ', 'T').slice(0, 19)}Z`) : null);

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function localParts(d = new Date()) {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  const time = `${p.hour}:${p.minute}`;
  return { date: `${p.year}-${p.month}-${p.day}`, time, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export const today = () => localParts().date;
export const toMinutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

const utc = (s) => new Date(`${s}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => { const d = utc(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export const dayOfWeek = (s) => utc(s).getUTCDay();
export const diffDays = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);

export function eachDate(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}`, days: last };
}

export const currentMonth = () => today().slice(0, 7);
export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
export const isMonth = (s) => /^\d{4}-\d{2}$/.test(s || '');
