const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// Server timestamps are UTC 'YYYY-MM-DD HH:MM:SS'; dates are plain 'YYYY-MM-DD'.
export const parseTs = (s) => (s ? new Date(`${String(s).replace(' ', 'T').slice(0, 19)}Z`) : null)

export function fmtDate(s, withYear = true) {
  if (!s) return '—'
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number)
  return `${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ''}`
}

export function fmtTime(ts) {
  const d = parseTs(ts)
  return d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'
}

export function fmtDateTime(ts) {
  const d = parseTs(ts)
  return d ? `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${fmtTime(ts)}` : '—'
}

export function timeAgo(ts) {
  const d = parseTs(ts)
  if (!d) return ''
  const s = Math.round((Date.now() - d) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
export const hours = (mins) => `${Math.floor((mins || 0) / 60)}h ${String((mins || 0) % 60).padStart(2, '0')}m`
export const initials = (name = '') => name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase()
export const titleCase = (s = '') => s.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())

export const currentMonth = () => new Date().toISOString().slice(0, 7)
export function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return d.toISOString().slice(0, 7)
}
export const monthLabel = (ym) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`

const HUES = [243, 262, 199, 160, 28, 340, 280, 215]
export function hueFor(name = '') {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return HUES[h % HUES.length]
}

// 125000.5 -> "Rupees One Lakh Twenty Five Thousand and Fifty Paise Only" (Indian numbering).
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
const below100 = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`)
const below1000 = (n) => `${n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ' ' : ''}` : ''}${below100(n % 100)}`
function wholeInWords(n) {
  if (n === 0) return 'Zero'
  const parts = []
  for (const [div, label] of [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']]) {
    if (n >= div) { parts.push(`${below1000(Math.floor(n / div))} ${label}`); n %= div }
  }
  if (n > 0) parts.push(below1000(n))
  return parts.join(' ')
}
export function rupeesInWords(amount) {
  const total = Math.round(Number(amount || 0) * 100)
  const rupees = Math.floor(total / 100), paise = total % 100
  return `Rupees ${wholeInWords(rupees)}${paise ? ` and ${below100(paise)} Paise` : ''} Only`
}
