# WorkPilot tests

Two kinds, both kept in the project so every future change can be checked.

## 1. Quick unit tests (no server needed)

```
cd server
npm test
```

These check the rules that decide pay and access: late / early / half-day rules, professional tax slabs, feature switches,
two-step codes. They run in about a second. Add a case here whenever you change one of those rules.

## 2. API tests (against a running copy of the site)

Each test file makes its **own company**, signs in as that company's admin, does its checks and deletes the company again,
so it never touches your real data. It only needs a platform owner login.

```
# once: make a platform login just for testing (Node / SQLite dev database)
cd server
node scripts/create-platform-admin.mjs --email=pf@test.local --password="PlatTest#2026-xx" --name=PfTest

# run everything against the Node API (default http://localhost:4000/api/v1)
node tests/run.mjs                 # from the project folder
node tests/run.mjs attendance      # only files whose name contains "attendance"

# run the same tests against the PHP version
API=http://localhost:8300/api/v1 node tests/run.mjs
```

Other settings: `PLAT_EMAIL` and `PLAT_PASS` (the platform login), `API` (the API address).
The authenticator secrets of the test logins are kept in `tests/.secrets.json` (git-ignored). The first run switches two-step
sign-in on for the test logins by itself.

**The same tests must pass on Node and on PHP.** That is how the two backends are kept in step: when a test passes on one and
fails on the other, the difference is a bug.

For the PHP version you need a throw-away database (not your live one) and PHP's built-in server, for example
`php -S localhost:8300 router.php` in a copy of the site whose `config.php` has `'rate_limit' => false`,
`'mail' => ['transport' => 'log']`, `'backup' => ['auto' => false]` and `'reminders' => ['auto' => false]`.
For Node, set `DISABLE_RATE_LIMIT=true` in `server/.env` while testing (never on a live server).

## Files

| File | What it covers |
| --- | --- |
| `platform.test.mjs` | Plans and feature switches, own web address, platform dashboard, health view, activity log, safe delete |
| `attendance.test.mjs` | Selfie, QR sign-in, biometric machine, late / early rules, late penalty, overtime from punch times, reminders |
| `lib/helpers.mjs`, `lib/auth.mjs` | The shared helpers (HTTP calls, authenticator codes, signing in) |
| `run.mjs` | Runs all the test files and reports |
