import jwt from 'jsonwebtoken';
import { HttpError, wrap } from '../utils/http.js';
import { runAs, runWithoutCompany } from '../db/tenant.js';
import { companyByCode, companyById, companyByDomain, soleCompany, assertUsable, maybeRemindExpiry } from '../services/tenants.js';

const verify = (t) => { try { return jwt.verify(t, process.env.JWT_SECRET); } catch { return null; } };

// Decides which company a request belongs to, then runs the rest of the request as that company.
// Signed-in users carry their company inside the token; public pages (sign-in, logo, candidate test) name it with ?c=code.
export const resolveTenant = wrap(async (req, _res, next) => {
  let company = null;
  const bearer = (req.headers.authorization || '').startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
  const claim = bearer && verify(bearer);
  if (claim?.cid) company = await companyById(claim.cid);
  if (!company && req.cookies?.refresh) {
    const r = verify(req.cookies.refresh);
    if (r?.cid) company = await companyById(r.cid);
  }
  if (!company && typeof req.body?.token === 'string') { // a password-reset link names its company
    const rt = verify(req.body.token);
    if (rt?.cid && rt.rp) company = await companyById(rt.cid);
  }
  if (!company && typeof req.body?.challenge === 'string') { // so does the second step of signing in
    const ch = verify(req.body.challenge);
    if (ch?.cid && ch.tf) company = await companyById(ch.cid);
  }
  const deviceKey = String(req.headers['x-device-key'] || ''); // a biometric machine names its company in its key
  if (!company && deviceKey.includes('.')) company = await companyById(deviceKey.split('.')[0]);
  const testToken = String(req.headers['x-test-token'] || '');
  if (!company && testToken.includes('.')) company = await companyById(testToken.split('.')[0]);
  if (!company && req.hostname) company = await companyByDomain(req.hostname); // the company's own web address
  if (!company) {
    const code = req.query?.c || req.body?.company || req.headers['x-company'];
    if (code) {
      company = await companyByCode(code);
      if (!company) throw new HttpError(404, 'We could not find that company code. Please check it.');
    } else company = await soleCompany();
  }
  if (!company && (bearer || testToken)) throw new HttpError(401, 'Your session has ended. Please sign in again.'); // a token that names no company
  if (!company) return runWithoutCompany(() => next()); // fails closed: any company table is refused
  assertUsable(company);
  req.company = company;
  maybeRemindExpiry(company);
  return runAs(company.prefix, () => next(), company);
});
