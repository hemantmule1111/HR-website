// QR sign-in: the office screen shows a link such as https://site/?qr=CODE. The code is kept for a few minutes while the person signs in.
const KEY = 'wp_qr'

// Called once when the app starts: takes the code out of the address and hides it from the address bar.
export function captureQr() {
  try {
    const u = new URL(window.location.href)
    const code = u.searchParams.get('qr')
    if (!code) return
    sessionStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() }))
    u.searchParams.delete('qr')
    window.history.replaceState({}, '', u.pathname + (u.search || '') + u.hash)
  } catch { /* storage can be blocked: the person just scans again */ }
}

// The code scanned in the last four minutes, or null.
export function getQr() {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) || 'null')
    if (v && Date.now() - v.at < 4 * 60 * 1000) return v.code
  } catch { /* ignore */ }
  return null
}
export const clearQr = () => { try { sessionStorage.removeItem(KEY) } catch { /* ignore */ } }
