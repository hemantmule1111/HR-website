// Platform owner features: plans and feature switches, own web address, dashboard, health, activity log and safe delete.
import { B, PLAT_EMAIL, PLAT_PASS, ok, finish, call, callAsHost, uniq, platformToken, userToken } from './lib/helpers.mjs'

const sfx = uniq()
const code = 'feat' + sfx, domain = `hr${sfx}.example.com`, email = `owner${sfx}@feat.test`, TEMP = 'Zq7!mKx2vL-' + sfx, PW = 'Rb4#nTe9wQ-' + sfx

const plat = await platformToken(B, PLAT_EMAIL, PLAT_PASS)
ok('the platform owner signs in', !!plat)
let r = await call('GET', '/platform/features', plat); ok('the list of switchable features', r.s === 200 && r.j.length >= 7 && r.j.some((f) => f.key === 'payroll'), JSON.stringify(r.j))

console.log('--- a company with a plan, switches and its own address')
const mk = (o = {}) => call('POST', '/platform/companies', plat, { name: 'Feat Co ' + sfx, code, admin_email: email, admin_password: TEMP, max_employees: 5, plan: 'Basic', features: { payroll: false, overtime: false }, domain, ...o })
r = await mk({ domain: 'not a domain' }); ok('a web address that is not one is refused', r.s === 400, r.s)
r = await mk(); const cid = r.j?.id; ok('the company is created', r.s === 201 && !!cid, JSON.stringify(r.j))
r = await mk({ code: code + 'b', admin_email: 'x' + email, domain }); ok('the same web address cannot be used twice', r.s === 409, r.s + JSON.stringify(r.j))
r = await call('GET', '/platform/companies', plat); const row = r.j.find((c) => c.id === cid)
ok('the list shows plan, switches and address', row?.plan === 'Basic' && row.features.payroll === false && row.features.tests === true && row.domain === domain, JSON.stringify(row))

const adm = await userToken(B, code, email, PW, TEMP)
ok('the new company admin signs in', !!adm)
r = await call('GET', '/auth/me', adm); ok('the app is told which parts are on', r.j?.features?.payroll === false && r.j.features.overtime === false && r.j.features.tests === true, JSON.stringify(r.j?.features))
r = await call('GET', '/payroll/runs', adm); ok('payroll is refused, with a clear message', r.s === 403 && r.j.code === 'FEATURE_OFF' && /plan/i.test(r.j.error), JSON.stringify(r.j))
r = await call('GET', '/overtime/requests', adm); ok('overtime is refused', r.s === 403 && r.j.code === 'FEATURE_OFF', r.s)
r = await call('GET', '/tests', adm); ok('HR tests stay available', r.s === 200, r.s + JSON.stringify(r.j))
r = await call('GET', '/employees', adm); ok('ordinary pages are not affected', r.s === 200, r.s)

console.log('--- changing the switches')
r = await call('PATCH', `/platform/companies/${cid}`, plat, { features: { payroll: true, chat: false } }); ok('the owner turns payroll on and chat off', r.s === 200, JSON.stringify(r.j))
await new Promise((x) => setTimeout(x, 5500)) // the company record is cached for a few seconds
r = await call('GET', '/payroll/runs', adm); ok('payroll now works', r.s === 200, r.s + JSON.stringify(r.j))
r = await call('GET', '/chat/conversations', adm); ok('chat is now refused', r.s === 403 && r.j.code === 'FEATURE_OFF', r.s)
r = await call('GET', '/overtime/requests', adm); ok('overtime is still off (the other switches were kept)', r.s === 403, r.s)
r = await call('PATCH', `/platform/companies/${cid}`, adm, { features: { chat: true } }); ok('a company admin cannot change its own plan', r.s === 401 || r.s === 403, r.s)

console.log('--- own web address')
const viaHost = await callAsHost(domain, 'POST', '/auth/login', { email, password: PW })
ok('signing in at the company address needs no company code', viaHost.s === 200 && (viaHost.j.accessToken || viaHost.j.twoFactor), JSON.stringify(viaHost))
const wrongHost = (await callAsHost('other.example.org', 'POST', '/auth/login', { email, password: PW })).s
ok('an unknown address does not find it', wrongHost !== 200, wrongHost)

console.log('--- platform dashboard')
r = await call('GET', '/platform/overview', plat); const ov = r.j
const mine = ov?.companies?.find((c) => c.id === cid)
ok('overview: totals and one row per company', r.s === 200 && ov.totals.companies >= 2 && typeof ov.totals.employees === 'number' && ov.totals.active >= 1, JSON.stringify(ov?.totals))
ok('overview: usage, last sign-in and storage for the new company', mine && mine.employees === 0 && mine.users === 1 && !!mine.last_login_at && typeof mine.storage_bytes === 'number' && mine.plan === 'Basic', JSON.stringify(mine))
r = await call('GET', '/platform/overview', adm); ok('a company admin cannot open the platform dashboard', r.s === 401 || r.s === 403, r.s)

console.log('--- support health view')
r = await call('GET', `/platform/companies/${cid}/health`, plat); const h = r.j
ok('health: schema up to date, no missing tables', r.s === 200 && h.schema.up_to_date && Array.isArray(h.tables_missing) && h.tables_missing.length === 0, JSON.stringify(h))
ok('health: people counts and two-step status', h.users === 1 && h.admins === 1 && h.admins_with_two_step === 1 && h.employees === 0, JSON.stringify(h))
ok('health shows counts only, never names, emails or pay', !JSON.stringify(h).includes(email) && !('admin_email' in h), JSON.stringify(h).slice(0, 300))
r = await call('GET', `/platform/companies/999999/health`, plat); ok('an unknown company is not found', r.s === 404, r.s)

console.log('--- activity log')
r = await call('GET', '/platform/log', plat); const log = r.j || []
const acts = new Set(log.map((x) => x.action))
ok('log: sign-in, create and update are recorded with who did it', r.s === 200 && acts.has('sign_in') && acts.has('company_create') && acts.has('company_update') && log.every((x) => x.admin_email), JSON.stringify([...acts]))
r = await call('GET', `/platform/log?company=${cid}`, plat); ok('log can be filtered by company', r.j.length >= 2 && r.j.every((x) => x.company_id === cid), r.j.length)
r = await call('GET', '/platform/log', adm); ok('a company admin cannot read it', r.s === 401 || r.s === 403, r.s)

console.log('--- safe delete')
const del = (b, t = plat) => call('DELETE', `/platform/companies/${cid}`, t, b)
r = await del({ confirm_code: code, password: PLAT_PASS }); ok('refused while the company is active', r.s === 400 && /suspend/i.test(r.j.error), JSON.stringify(r.j))
await call('PATCH', `/platform/companies/${cid}`, plat, { status: 'suspended' })
r = await del({ confirm_code: code + 'x', password: PLAT_PASS }); ok('refused with the wrong typed code', r.s === 400 && /code/i.test(r.j.error), JSON.stringify(r.j))
r = await del({ confirm_code: code, password: 'nope-nope-nope' }); ok('refused with the wrong password', r.s === 400 && /password/i.test(r.j.error), JSON.stringify(r.j))
r = await del({ confirm_code: code, password: PLAT_PASS }); ok('refused until a fresh export was downloaded', r.s === 400 && /export/i.test(r.j.error), JSON.stringify(r.j))
r = await call('GET', `/platform/companies/${cid}/export`, plat); ok('the owner exports the company', r.s === 200, r.s)
r = await del({ confirm_code: code, password: PLAT_PASS }, adm); ok('a company admin cannot delete', r.s === 401 || r.s === 403, r.s)
const first = ov.companies.find((c) => c.code === 'default') || ov.companies[0]
const fr = await call('DELETE', `/platform/companies/${first.id}`, plat, { confirm_code: first.code, password: PLAT_PASS }); ok('the first company can never be deleted here', fr.s === 400, JSON.stringify(fr.j))
r = await del({ confirm_code: code.toUpperCase(), password: PLAT_PASS }); ok('the company and all its data are deleted', r.s === 200, JSON.stringify(r.j))
r = await call('GET', '/platform/companies', plat); ok('it is gone from the list', !r.j.some((c) => c.id === cid))
r = await call('POST', '/auth/login', null, { company: code, email, password: PW }); ok('and nobody can sign in to it any more', r.s === 404 || r.s === 401, r.s)
r = await call('GET', `/platform/log?company=${cid}`, plat); ok('the deletion is in the log', r.j.some((x) => x.action === 'company_delete') && r.j.some((x) => x.action === 'company_export'), JSON.stringify(r.j.map((x) => x.action)))

finish()
