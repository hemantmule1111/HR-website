# HRMS Development Specification (v1)

**Purpose:** single-company HRMS for own employees
**Stack:** React (frontend) + Node.js (API) + MySQL
**Scope:** Basic HRMS: employee master, roles, attendance, leave, approvals, dashboard
**Scale:** 50–250 users (a single app server and a single MySQL instance are enough)

## 1. In scope / out of scope

| In scope (v1) | Deferred |
|---|---|
| Login, RBAC, audit log | Payroll, PF/ESI/TDS/PT, payslips (Phase 3) |
| Company, department, designation, reporting hierarchy | Recruitment / ATS (Phase 4) |
| Employee master and documents | Performance, training, assets, exit (Phase 4) |
| Shifts, attendance, regularization | Biometric device integration (manual/web punch first) |
| Leave types, balances, requests, holidays | Expenses, travel, helpdesk, engagement |
| Manager approvals, in-app + email notifications | Multi-company / multi-tenancy |
| HR dashboard, basic reports | Mobile app |

## 2. Roles (v1)

| Role | Access |
|---|---|
| Super Admin | Config, users, roles, org setup |
| HR Admin | All employee, attendance and leave operations |
| Reporting Manager | Team attendance, leave approvals |
| Employee | Own profile, attendance, leave |
| Management | Read-only dashboard and reports |
| Auditor | Read-only records and audit trail |

Permissions are `module.action` strings (for example `leave.approve`, `employee.view_sensitive`). Roles map to permissions in the database. Sensitive fields (bank, ID documents, salary when added later) get separate permissions. Every create, update or delete on sensitive data writes to `audit_logs`.

## 3. Architecture

- **Frontend:** React + Vite, React Router, TanStack Query, a component library (MUI or Ant Design).
- **Backend:** Node.js + Express (or Fastify), layered as routes → controllers → services → repositories. Validation with Zod.
- **Database:** MySQL 8, migrations with Knex or Prisma.
- **Auth:** JWT access token (15 min) + refresh token in an httpOnly cookie. Passwords hashed with argon2/bcrypt. Rate-limit the login route.
- **Files:** employee documents on local disk or S3-compatible storage. Store only metadata and path in the DB. Serve through authorized endpoints, never as public URLs.
- **Jobs:** `node-cron` for the daily leave accrual, absent-marking and reminder emails. No queue is needed at this scale.
- **Email:** SMTP via Nodemailer.

```
/server  src/{routes,controllers,services,repositories,middleware,jobs,db/migrations}
/client  src/{pages,components,api,hooks,auth}
```

## 4. Database (v1 tables)

Conventions: `id` BIGINT PK, `created_at`, `updated_at`, `status` where relevant, FKs with indexes, no hard deletes for HR records (soft delete via `status`/`deleted_at`).

| Table | Key columns |
|---|---|
| users | employee_id FK, email (unique), password_hash, role_id, is_active, last_login_at |
| roles / permissions / role_permissions | name; permission key; mapping |
| departments | name, head_employee_id |
| designations | title, level |
| employees | emp_code (unique), name, email, phone, dob, gender, department_id, designation_id, manager_id (self FK), join_date, employment_type, work_location, status (active/probation/notice/exited) |
| employee_documents | employee_id, type, file_path, verified_by, verified_at, expires_on |
| employment_history | employee_id, event (confirmation/transfer/promotion), from/to values, effective_date, approved_by |
| shifts | name, start_time, end_time, grace_minutes, weekly_offs |
| employee_shifts | employee_id, shift_id, effective_from, effective_to |
| attendance | employee_id, date (unique together), check_in, check_out, source, status (present/absent/half/leave/holiday/weekoff), late_minutes, worked_minutes |
| attendance_regularizations | attendance_id/date, requested_in/out, reason, status, approver_id |
| leave_types | name, annual_quota, carry_forward_max, is_paid, allow_half_day, accrual_rule |
| leave_balances | employee_id, leave_type_id, year, opening, accrued, used, closing |
| leave_requests | employee_id, leave_type_id, from_date, to_date, day_part, days, reason, status, approver_id, decided_at, decision_note |
| holidays | date, name, is_optional |
| notifications | user_id, type, payload, read_at |
| audit_logs | user_id, entity, entity_id, action, old_value JSON, new_value JSON, ip, created_at |

Keep history, never overwrite it: a leave decision, a regularization and an employment change are each stored as their own record.

## 5. Core business rules

1. **Leave days** exclude weekly-offs and holidays (the sandwich rule is configurable per leave type). Half-day counts as 0.5.
2. **Balance check** happens on apply and again on approval. Approval deducts, and cancel or reject restores the balance, all inside one DB transaction.
3. **Overlap check:** one employee cannot have two non-rejected leave requests on the same date.
4. **Approval:** the direct manager approves. If the manager is absent or missing, it escalates to the HR Admin. A user can never approve their own request.
5. **Attendance status** is derived from punches against the shift: late after the grace period, half-day below a configurable threshold, absent when there is no punch and no leave.
6. **Regularization:** the employee requests a corrected punch, the manager approves, and the attendance row is updated with an audit entry.
7. **Accrual:** a monthly cron job credits the quota. Year-end carry-forward is capped per leave type.
8. **Visibility:** an employee sees only their own data, a manager sees their reporting tree, and HR sees everyone.

## 6. API surface (REST, `/api/v1`)

- `POST /auth/login | /auth/refresh | /auth/logout | /auth/change-password`
- `GET|POST|PATCH /employees`, `GET /employees/:id`, `/employees/:id/documents`, `/employees/:id/history`
- `CRUD /departments`, `/designations`, `/shifts`, `/holidays`, `/leave-types`
- `POST /attendance/check-in | /attendance/check-out`, `GET /attendance?month=&employeeId=`
- `POST /attendance/regularizations`, `PATCH /attendance/regularizations/:id` (approve/reject)
- `GET /leave/balances`, `POST /leave/requests`, `GET /leave/requests?scope=mine|team|all`, `PATCH /leave/requests/:id` (approve/reject/cancel)
- `GET /dashboard/summary`, `GET /reports/{headcount,attendance-monthly,leave-utilization}?format=csv`
- `GET /notifications`, `PATCH /notifications/:id/read`
- `GET /audit-logs` (Auditor and Super Admin only)

## 7. Screens

- **Employee:** dashboard (today's punch, balances, holidays, birthdays), my attendance calendar, apply for leave, my requests, my profile.
- **Manager:** team attendance, pending approvals (leave + regularization), team calendar.
- **HR Admin:** employee list/add/edit, documents, org setup, shifts, leave policy, holiday calendar, reports.
- **Management / Auditor:** read-only dashboard, reports, audit log viewer.
- **HR dashboard widgets:** total employees, present today, on leave, pending approvals, department-wise headcount, monthly joiners/exits, attendance %, upcoming birthdays and anniversaries.

## 8. Non-functional requirements

- HTTPS only, secure cookies, CORS locked to the app origin, helmet headers, parameterized queries.
- Input validation on every endpoint, and file upload limits (type, 5 MB).
- Daily DB backup and a tested restore.
- Indexes: `attendance(employee_id, date)`, `leave_requests(employee_id, status)`, `employees(manager_id)`, `audit_logs(entity, entity_id)`.
- Target: any list page responds in under 500 ms at 250 employees.
- Timestamps stored in UTC, displayed in the company timezone.

## 9. Delivery plan

| Milestone | Deliverables |
|---|---|
| M1: Foundation | Repo, migrations, auth, RBAC, audit logging, org setup (departments, designations) |
| M2: Employees | Employee master, documents, hierarchy, employment history, employee dashboard |
| M3: Attendance | Shifts, punch in/out, attendance calendar, regularization with approval |
| M4: Leave | Leave types, balances, accrual job, requests, approvals, holidays |
| M5: Dashboard and release | Notifications, HR dashboard, reports/CSV export, hardening, UAT, deployment |

**Later phases:** Phase 3 payroll (salary structure, payroll run, payslips, statutory rules validated with a payroll/CA professional); Phase 4 recruitment, performance, training, assets, exit.

## 10. Open questions to resolve before M1

1. Leave policy: quotas per type, carry-forward and encashment rules, whether the sandwich rule applies.
2. Working week and shifts: weekly-off pattern, grace minutes, half-day thresholds.
3. Attendance source: web punch only, or will biometric devices be integrated (needs the device model and export or API)?
4. Does a single approver suffice, or is multi-level approval needed?
5. Existing employee data: is there a spreadsheet to import?
6. Hosting target (VPS, cloud, on-prem) and the email provider.
7. Is `inext.php` (currently empty) meant to be part of this, or can the project start fresh with `/server` and `/client`?
