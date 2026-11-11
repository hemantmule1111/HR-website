// Fast tests of the rules that decide money and access. No server or database needed:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../src/services/attendance.js';
import { ptFromSlabs } from '../src/services/payrollCalc.js';
import { featuresOf, featureForPath } from '../src/services/features.js';
import { newSecret, totpCode, verifyTotp, encryptText, decryptText } from '../src/utils/totp.js';

process.env.JWT_SECRET ||= 'unit-test-secret-unit-test-secret';

const shift = { start_time: '09:30', end_time: '18:30', grace_minutes: 15, half_day_minutes: 240 };
// Company time is India (UTC+5:30), and punches are stored in UTC: 04:00 UTC = 09:30 here.
const at = (hh, mm) => { const m = hh * 60 + mm - 330; return `2026-03-02 ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`; };

test('on time, full day', () => {
  const r = evaluate(shift, at(9, 40), at(18, 40));
  assert.equal(r.status, 'present'); assert.equal(r.late_minutes, 0); assert.equal(r.early_minutes, 0);
});
test('late beyond grace is counted from the shift start', () => {
  assert.equal(evaluate(shift, at(9, 50), at(18, 30)).late_minutes, 20);
});
test('worked less than the half-day minimum is a half day', () => {
  assert.equal(evaluate(shift, at(9, 30), at(12, 30)).status, 'half_day');
});
test('very late arrival becomes a half day only when the rule is on', () => {
  assert.equal(evaluate(shift, at(10, 45), at(18, 30)).status, 'present');
  assert.equal(evaluate(shift, at(10, 45), at(18, 30), { late_halfday_after_min: 60 }).status, 'half_day');
  assert.equal(evaluate(shift, at(10, 20), at(18, 30), { late_halfday_after_min: 60 }).status, 'present');
});
test('leaving early becomes a half day only when the rule is on', () => {
  const r = evaluate(shift, at(9, 30), at(16, 45), { early_halfday_before_min: 60 });
  assert.equal(r.early_minutes, 105); assert.equal(r.status, 'half_day');
  assert.equal(evaluate(shift, at(9, 30), at(18, 0), { early_halfday_before_min: 60 }).status, 'present');
});
test('no check-out yet: not early, not a half day', () => {
  const r = evaluate(shift, at(9, 30), null, { early_halfday_before_min: 60 });
  assert.equal(r.status, 'present'); assert.equal(r.early_minutes, 0);
});

const slabs = [
  { state_code: 'KA', gender: 'any', from_amount: 0, to_amount: 24999, monthly_amount: 0, feb_amount: null, effective_from: '2020-01-01', active: 1 },
  { state_code: 'KA', gender: 'any', from_amount: 25000, to_amount: null, monthly_amount: 200, feb_amount: 300, effective_from: '2020-01-01', active: 1 },
  { state_code: 'XX', gender: 'any', from_amount: 0, to_amount: null, monthly_amount: 100, feb_amount: null, effective_from: '2020-01-01', active: 0 },
];
test('professional tax: slab, February amount, no tax below the first slab', () => {
  assert.equal(ptFromSlabs('KA', 'male', 30000, 6, slabs), 200);
  assert.equal(ptFromSlabs('KA', 'male', 30000, 2, slabs), 300);
  assert.equal(ptFromSlabs('KA', 'male', 20000, 6, slabs), 0);
});
test('professional tax: unknown, switched-off and "none" states pay nothing', () => {
  assert.equal(ptFromSlabs('ZZ', 'male', 30000, 6, slabs), 0);
  assert.equal(ptFromSlabs('XX', 'male', 30000, 6, slabs), 0);
  assert.equal(ptFromSlabs('NONE', 'male', 30000, 6, slabs), 0);
});

test('feature switches: everything is on unless switched off', () => {
  assert.ok(Object.values(featuresOf({})).every(Boolean));
  assert.equal(featuresOf({ features: '{"payroll":false}' }).payroll, false);
  assert.equal(featuresOf({ features: '{"payroll":false}' }).overtime, true);
  assert.equal(featuresOf({ features: 'not json' }).payroll, true);
});
test('feature switches: paths map to the right feature', () => {
  assert.equal(featureForPath('/payroll/runs'), 'payroll');
  assert.equal(featureForPath('/payroll'), 'payroll');
  assert.equal(featureForPath('/payrolls'), null);
  assert.equal(featureForPath('/candidate-test/login'), 'tests');
  assert.equal(featureForPath('/attendance/check-in'), null);
});

test('two-step codes: the current code verifies once and the same step cannot be reused', () => {
  const secret = newSecret();
  const step = verifyTotp(secret, totpCode(secret), 0);
  assert.ok(step > 0);
  assert.ok(!verifyTotp(secret, totpCode(secret), step));
  assert.ok(!verifyTotp(secret, '12345', 0));
});
test('stored secrets are encrypted and come back intact', () => {
  const enc = encryptText('JBSWY3DPEHPK3PXP');
  assert.notEqual(enc, 'JBSWY3DPEHPK3PXP');
  assert.equal(decryptText(enc), 'JBSWY3DPEHPK3PXP');
});
