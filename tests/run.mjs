// Runs every API test against a running copy of WorkPilot.
//   node tests/run.mjs                              (Node API on http://localhost:4000)
//   API=http://localhost:8300/api/v1 node tests/run.mjs   (the PHP version)
// The same tests must pass on both. See tests/README.md.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const only = process.argv[2]
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs') && (!only || f.includes(only))).sort()
let failed = 0
for (const f of files) {
  console.log(`\n=== ${f} ===`)
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit', env: process.env })
  if (r.status !== 0) failed++
}
console.log(failed ? `\n${failed} test file(s) FAILED` : `\nAll ${files.length} test file(s) passed`)
process.exit(failed ? 1 : 0)
