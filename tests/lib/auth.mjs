// Test helper: authenticator codes, platform sign-in and company-admin sign-in (with two-step setup on first use).
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const FILE = path.join(here, '..', '.secrets.json') // authenticator secrets of the test logins (git-ignored)
const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return {} } }
const save = (d) => fs.writeFileSync(FILE, JSON.stringify(d))
export const stored = (key) => load()[key]
export const remember = (key, patch) => { const d = load(); d[key] = { ...(d[key] || {}), ...patch }; save(d) }

const unb32 = (s) => { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of s.replace(/=+$/, '').toUpperCase()) bits += a.indexOf(c).toString(2).padStart(5, '0'); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out) }
export function hotp(secret, counter) { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(counter)); const h = crypto.createHmac('sha1', unb32(secret)).update(b).digest(); const o = h[h.length - 1] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1000000).padStart(6, '0') }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// A code that was not used before: waits for the next 30-second step when the last one was already spent.
export async function freshCode(key, secret) {
  let step = Math.floor(Date.now() / 30000)
  const last = stored(key)?.last_step || 0
  if (step <= last) { await sleep((last + 1) * 30000 - Date.now() + 300); step = last + 1 }
  remember(key, { last_step: step })
  return hotp(secret, step)
}

const call = async (B, m, p, t, body) => {
  const r = await fetch(B + p, { method: m, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { s: r.status, j: await r.json().catch(() => null) }
}

export async function platformToken(B, email, password) {
  const key = `${B}|platform|${email}`
  let r = await call(B, 'POST', '/platform/auth/login', null, { email, password })
  if (r.j?.twoFactor) {
    const code = await freshCode(key, stored(key).secret)
    r = await call(B, 'POST', '/platform/auth/verify', null, { challenge: r.j.challenge, code })
    return r.j?.token
  }
  const tok = r.j?.token
  if (!tok) return null
  const s = await call(B, 'POST', '/platform/2fa/setup', tok)
  remember(key, { secret: s.j.secret, last_step: 0 })
  const e = await call(B, 'POST', '/platform/2fa/enable', tok, { code: await freshCode(key, s.j.secret) })
  return e.s === 200 ? tok : null
}

// Signs a company user in. A brand new admin (temporary password) sets a new password and the two-step app first.
export async function userToken(B, company, email, password, tempPassword = null) {
  const key = `${B}|${company}|${email}`
  let r = await call(B, 'POST', '/auth/login', null, { company, email, password: tempPassword || password })
  if (r.j?.twoFactor) {
    const code = await freshCode(key, stored(key).secret)
    r = await call(B, 'POST', '/auth/2fa/verify', null, { company, challenge: r.j.challenge, code })
    return r.j?.accessToken
  }
  let tok = r.j?.accessToken
  if (!tok) return null
  if (tempPassword) {
    const c = await call(B, 'POST', '/auth/change-password', tok, { currentPassword: tempPassword, newPassword: password })
    if (c.s >= 300) return null
    r = await call(B, 'POST', '/auth/login', null, { company, email, password })
    tok = r.j?.accessToken
  }
  const st = await call(B, 'GET', '/auth/2fa', tok)
  if (st.j && !st.j.enabled) {
    const s = await call(B, 'POST', '/auth/2fa/setup', tok)
    if (s.j?.secret) {
      remember(key, { secret: s.j.secret, last_step: 0 })
      await call(B, 'POST', '/auth/2fa/enable', tok, { code: await freshCode(key, s.j.secret) })
    }
  }
  return tok
}
