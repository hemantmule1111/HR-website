// Per-company feature switches: the platform owner turns parts of WorkPilot on or off for each customer (so they can be priced as add-ons).
export const FEATURES = {
  payroll: 'Payroll and payslips',
  overtime: 'Overtime',
  tests: 'HR tests',
  geo: 'Attendance location check',
  hrdesk: 'Help desk, policies and assets',
  letters: 'Letters',
  chat: 'Chat',
};

// A company with no switches saved has everything on.
export function featuresOf(company) {
  let saved = {};
  try { saved = company?.features ? JSON.parse(company.features) : {}; } catch { saved = {}; }
  return Object.fromEntries(Object.keys(FEATURES).map((k) => [k, saved[k] !== false]));
}

// Which feature a request path belongs to (null = always available).
const PREFIXES = [
  ['/payroll', 'payroll'], ['/overtime', 'overtime'], ['/tests', 'tests'], ['/candidate-test', 'tests'], ['/test-candidates', 'tests'], ['/geo', 'geo'],
  ['/helpdesk', 'hrdesk'], ['/policies', 'hrdesk'], ['/assets', 'hrdesk'], ['/letters', 'letters'], ['/chat', 'chat'],
];
export function featureForPath(p) {
  const hit = PREFIXES.find(([pre]) => p === pre || p.startsWith(`${pre}/`));
  return hit ? hit[1] : null;
}

export function featureGate(req, res, next) {
  const key = featureForPath(req.path);
  if (key && req.company && featuresOf(req.company)[key] === false) {
    return res.status(403).json({ error: `${FEATURES[key]} is not included in your plan. Please contact your provider to add it.`, code: 'FEATURE_OFF' });
  }
  return next();
}
