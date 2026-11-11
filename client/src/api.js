// Minimal API client: keeps the access token in memory and refreshes it via the httpOnly cookie.
let accessToken = null

export const setToken = (t) => { accessToken = t }

async function raw(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {}
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData
  if (body && !isForm) headers['Content-Type'] = 'application/json'
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`
  return fetch(`${import.meta.env.BASE_URL}api/v1${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  })
}

export async function refreshSession() {
  const res = await raw('/auth/refresh', { method: 'POST', auth: false })
  if (!res.ok) return false
  setToken((await res.json()).accessToken)
  return true
}

async function withRefresh(path, opts) {
  let res = await raw(path, opts)
  if (res.status === 401 && (await refreshSession())) res = await raw(path, opts)
  return res
}

export async function api(path, opts) {
  const res = await withRefresh(path, opts)
  if (res.status === 204) return null
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = data.details?.[0] ? ` (${data.details[0].path?.join('.') || ''}: ${data.details[0].message})` : ''
    throw new Error(`${data.error || `Request failed (${res.status})`}${data.details ? detail : ''}`)
  }
  return data
}

// Authenticated file download (CSV exports, employee documents).
export async function download(path, filename) {
  const res = await withRefresh(path)
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Download failed')
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// Authenticated file -> object URL (for <img src>).
export async function blobUrl(path) {
  const res = await withRefresh(path)
  if (!res.ok) throw new Error('Could not load file')
  return URL.createObjectURL(await res.blob())
}

// The company code typed at sign-in is remembered on this computer (it is not a secret).
export const getCompany = () => { try { return localStorage.getItem('wp-company') || '' } catch { return '' } }
export const setCompany = (code) => { try { localStorage.setItem('wp-company', code) } catch { /* private mode */ } }

export async function login(email, password, company) {
  const res = await raw('/auth/login', { method: 'POST', body: { email, password, company: company || undefined }, auth: false })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Login failed')
  if (company) setCompany(company.trim().toLowerCase())
  if (data.twoFactor) return { twoFactor: true, challenge: data.challenge } // the code comes next
  setToken(data.accessToken)
  return {}
}

// Second step of signing in: the 6-digit code from the authenticator app (or a recovery code).
export async function verifyTwoFactor(challenge, code, company) {
  const res = await raw('/auth/2fa/verify', { method: 'POST', body: { challenge, code, company: company || undefined }, auth: false })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'That code did not work')
  setToken(data.accessToken)
}

export async function logout() {
  await raw('/auth/logout', { method: 'POST', auth: false })
  setToken(null)
}

// Authenticated file -> Blob.
export async function fetchBlob(path) {
  const res = await withRefresh(path)
  if (!res.ok) throw new Error('Could not load file')
  return res.blob()
}
