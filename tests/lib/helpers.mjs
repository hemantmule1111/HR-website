// Shared bits of the API tests: a tiny reporter and an HTTP helper. The tests run against any running copy of the API.
import http from 'node:http'
export { platformToken, userToken } from './auth.mjs'

export const B = process.env.API || 'http://localhost:4000/api/v1'
export const PLAT_EMAIL = process.env.PLAT_EMAIL || 'pf@test.local'
export const PLAT_PASS = process.env.PLAT_PASS || 'PlatTest#2026-xx'

let fails = 0
export const ok = (name, cond, extra = '') => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)) }
export const finish = () => { console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0) }

export async function call(method, path, token, body, headers = {}) {
  const r = await fetch(B + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  const ct = r.headers.get('content-type') || ''
  const j = ct.includes('json') ? await r.json().catch(() => null) : (await r.arrayBuffer(), null) // always read the body, so the connection is released
  return { s: r.status, j, ct }
}

// A request with its own Host header (the browser's fetch cannot set one), to test companies' own web addresses.
export function callAsHost(host, method, path, body) {
  return new Promise((resolve) => {
    const u = new URL(B + path)
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method, headers: { 'Content-Type': 'application/json', Host: host } }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { let j = null; try { j = JSON.parse(d) } catch { /* not json */ } resolve({ s: res.statusCode, j }) })
    })
    req.end(body ? JSON.stringify(body) : undefined)
  })
}

export const uniq = () => String(Date.now()).slice(-7)
