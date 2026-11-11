// Gives every existing salary structure the full Indian breakup (same monthly gross, split into components).
// Safe to run twice: structures that already have DA / conveyance / medical / other allowance are left alone.
import 'dotenv/config'
import db from '../src/db/index.js'
import { standardBreakup } from '../src/services/payrollCalc.js'

const rows = await db('salary_structures').orderBy('id')
let changed = 0
for (const s of rows) {
  const done = ['da', 'conveyance', 'medical', 'other_allowance'].some((k) => Number(s[k]) > 0)
  if (done) continue
  const gross = Number(s.basic) + Number(s.hra) + Number(s.allowances)
  // Employee 1 keeps the worked example from the payroll brief: Basic 90,000 + HRA 36,000 + Other allowance 18,000.
  const next = s.employee_id === 1 && Number(s.basic) === 90000
    ? { other_allowance: Number(s.allowances), allowances: 0, pf_mode: 'ceiling', pt_state: 'MH', esic_applicable: false }
    : standardBreakup(gross)
  await db('salary_structures').where({ id: s.id }).update({ ...next, note: s.note ? `${s.note} · Indian breakup` : 'Indian breakup' })
  changed += 1
}
console.log(`${changed} of ${rows.length} salary structures updated`)
const emps = await db('employees').count({ n: 'id' }).first()
const without = await db('employees as e').leftJoin('salary_structures as s', 's.employee_id', 'e.id').whereNull('s.id').count({ n: 'e.id' }).first()
console.log(`${emps.n} employees, ${without.n} without any salary structure`)
process.exit()
