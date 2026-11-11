# WorkPilot — HR Management System

React + Node.js HRMS for a single company (50–250 employees). See [HR-SPEC.md](HR-SPEC.md) for the original specification.

**Modules:** login with role-based access · employee master, documents and career history · org chart · shifts, check-in/out and attendance calendar · attendance regularization · leave types, balances, holidays and approvals · notifications · announcements · HR dashboard · reports with CSV export · payroll runs and payslips · audit log · light/dark theme.

**Documentation:** open **/documentation** in the running site, or see [DOCUMENTATION.md](DOCUMENTATION.md), for the user guide, admin guide, business rules and technical reference.

## Run it (no database install needed)

Requires Node 20+. For a quick local trial the API can use a SQLite file (`DB_CLIENT=sqlite3`; the `better-sqlite3` module is optional and on some machines needs C++ build tools to install). For real use, run MySQL — see [DEPLOY.md](DEPLOY.md) and `npm run setup:mysql`.

```
# API
cd server
npm install
npm run setup     # creates the database, roles/permissions and the first Super Admin
npm run demo      # optional: 15 sample employees, attendance, leave, payroll
npm run dev       # http://localhost:4000

# Web app (new terminal)
cd client
npm install
npm run dev       # http://localhost:5173 (proxies /api to :4000)
```

**Demo logins** (password `Demo@12345`, after `npm run demo`)

| Role | Email |
|---|---|
| HR Admin | aarav.mehta@demo.com |
| Reporting Manager | priya.nair@demo.com |
| Employee | karan.singh@demo.com |
| Payroll Admin | neha.joshi@demo.com |

Super Admin: `admin@example.com` / `ChangeMe123!` (from `server/.env`).

The login page shows one-click demo chips in development only.

## Tests

With the API running on demo data: `cd server && npm run smoke` runs 34 end-to-end checks (permissions, team scoping, leave balance maths, approvals, payslip privacy).

## Before going live

1. **Database:** in `server/.env` set `DB_CLIENT=mysql2` and the `DB_*` values, create an empty `hrms` database, then `npm run setup`.
2. **Secrets:** set a long random `JWT_SECRET`, change the seeded admin password, and set `NODE_ENV=production` (enables secure cookies and refuses the default secret).
3. **Email:** fill `SMTP_*` to send email alongside in-app notifications (optional).
4. **Serve:** `cd client && npm run build`, then serve `client/dist` from the same origin as the API (reverse proxy `/api` to the Node server), over HTTPS.
5. **Backups:** back up the database and `server/uploads/` (employee documents) daily.
6. **Payroll:** deductions are fixed monthly amounts entered per employee. PF, ESI, TDS and professional tax are **not** calculated; have these rules validated with a payroll professional before relying on payroll for real salaries.

## How it works (short)

- Permissions are `module.action` keys attached to roles (`server/src/db/seeds/01_roles_permissions.js`). The API checks them on every route; the UI hides what you can't use.
- Managers see themselves and their whole reporting tree; employees see only themselves; HR/management see everyone.
- Sensitive fields (bank, PAN, Aadhaar) need `employee.view_sensitive`. Sensitive changes are written to the audit log.
- Leave balances are created per year on first use: the annual quota is credited up front (pro-rated for people who join mid-year) plus capped carry-forward.
- Salary revisions, leave decisions and career events are kept as history, never overwritten.
