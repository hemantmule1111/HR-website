# WorkPilot — Documentation

WorkPilot is a web-based HR management system for a single company (about 50–250 employees). It covers the employee master, attendance, leave, approvals, payroll and payslips, announcements, an org chart, reports, an audit trail and built-in team chat.

*Last updated: 8 November 2026.* This guide is also part of the site: open **/documentation** (for example `http://localhost:5173/documentation`), or choose **Documentation** in the top-right user menu.

**Contents**

1. [Getting started](#1-getting-started)
2. [Roles and permissions](#2-roles-and-permissions)
3. [Employee guide](#3-employee-guide)
4. [Manager guide](#4-manager-guide)
5. [HR and admin guide](#5-hr-and-admin-guide)
6. [Payroll guide](#6-payroll-guide)
7. [Chat](#7-chat)
8. [How the rules work](#8-how-the-rules-work)
9. [Technical reference](#9-technical-reference)
10. [Troubleshooting and FAQ](#10-troubleshooting-and-faq)
11. [Known limitations](#11-known-limitations)

---

## 1. Getting started

### 1.1 Signing in

Open the address your administrator gave you (for a local trial: `http://localhost:5173`) and sign in with your **company code** (given by your HR team; it is remembered on that computer), your work email and your password.

- **Password rules:** at least 10 characters. Change it any time from the top-right menu → **Change password**. Changing it signs you out of other devices.
- **Lock-out:** after **5 wrong passwords** the account is locked for **15 minutes**.
- **Session:** you stay signed in for up to 7 days of activity; a short-lived security token renews itself in the background.

### 1.2 Finding your way around

| Area | What it is |
|---|---|
| **Left sidebar** | The WorkPilot logo, your photo and role, the menu, and **Logout**. The menu only shows what your role may use. |
| **Top bar** | The page title, the theme switch (light / dark), notifications (bell), and your user menu (**My profile**, **Change password**, **Sign out**). |
| **Chat button** | The round button at the bottom-right opens team chat (see [Chat](#7-chat)). |
| **Back-to-top arrow** | Appears above the chat button when you scroll down a long page. |

On a phone or small window the sidebar becomes a slide-out menu (the ☰ button).

### 1.3 Notifications

The **bell** in the top bar lists things that need your attention, such as a leave decision, a new approval waiting for you, or "Your payslip for <month> is ready" (sent when payroll is marked as paid). Click one to jump to the related page. **Mark all read** clears the list.

### 1.4 Light and dark theme

Use the sun/moon button in the top bar. Your choice is remembered in that browser.

---

## 2. Roles and permissions

Every user has exactly one role. A role is a set of permissions, and the menu and the server both enforce them.

| Role | Intended for | Can do |
|---|---|---|
| **Super Admin** | The system owner | Everything, including users, organisation setup, payroll, reports and the audit log. |
| **HR Admin** | HR team | Manage employees (including bank and ID details), users, departments, shifts, leave types, holidays, company profile, announcements; approve leave and regularizations for everyone; view reports. |
| **Payroll Admin** | Payroll / finance | Salary structures, payroll runs and all payslips; view employees (including sensitive fields) and attendance; reports. |
| **Reporting Manager** | Team leads and managers | See their own team (their whole reporting tree), approve their team's leave and attendance requests. |
| **Employee** | Everyone | Own profile, attendance, leave, payslips, documents, chat. |
| **Management** | Leadership | Read-only view of all employees, attendance, leave and reports. |
| **Auditor** | Compliance | Read-only view of records plus the **Audit log**. |

Behind the scenes permissions are named `module.action` (for example `leave.approve`, `employee.view_sensitive`). The role-to-permission mapping lives in `server/src/db/seeds/01_roles_permissions.js` and is loaded into the database by `npm run setup`.

**Who sees whom**

- Employees see only themselves.
- Managers see themselves and everyone below them in the reporting tree.
- HR, Management and Auditors see everyone.
- **Sensitive fields** (bank account, IFSC, PAN, Aadhaar) are visible only to people with the "view sensitive" permission and to the employee themselves. Changes to these fields are written to the audit log.

> Everyone with a login can chat with everyone else, regardless of role.

---

## 3. Employee guide

### 3.1 Dashboard

Your home page shows:

- A greeting with the time and a **Check in / Check out** button.
- **Quick actions**, your **leave balance**, **announcements**, **upcoming holidays**.
- Birthdays and work anniversaries in the next 30 days.

(The Super Admin account has no employee record, so instead of a check-in card it shows a greeting and role badge in the centre of the top bar.)

### 3.2 Attendance

Open **Attendance**. The tabs are:

| Tab | What it shows |
|---|---|
| **Calendar** | Your month, day by day: present, half day, absent, leave, week off, holiday. Late arrivals and hours worked are shown on each day. |
| **Team today** | Managers and HR only: who is in, late or absent today. |
| **Pending** | Your attendance-correction requests that are still waiting for approval (the tab label shows the count). |
| **My requests** | Your requests that have already been approved or rejected, with the approver's note. |

**Checking in and out**

1. On the dashboard click **Check in** when you start and **Check out** when you finish.
2. You can check in once per day and check out once per day.

**Fixing a wrong or missing punch (regularization)**

1. In your calendar click the small **edit** icon on a past day.
2. Enter the correct in and out times and a reason, then **Submit request**.
3. Your manager (or HR) approves or rejects it. You get a notification either way.

You cannot regularize a future date, and only one request per date can be pending.

### 3.3 Leave

Open **Leave**.

- **Balances** appear at the top, one card per leave type.
- Click **Apply for leave**, choose the type, dates (and *half day* if the type allows it), add a reason, and submit. Your manager is notified.
- **My requests** lists everything you have applied for, with its status (pending, approved, rejected, cancelled). You can cancel a pending request, or an approved request that has not started yet.
- **Who is off** shows your team's time off for the month.
- **Holidays** lists company holidays **grouped by year**, including upcoming years.

The app checks, before you submit, that you have enough balance and that you don't already have leave on those dates. See [leave rules](#82-leave).

### 3.4 Payslips

Open **My payslips**. Each approved month appears as a card with the net pay. Click one to open it, then **Print / Save as PDF**.

A payslip shows the company letterhead (logo, name, address), your details, paid days and loss-of-pay days, earnings, deductions, **net pay in figures and in words**, and the authorised signatory line.

> Payslips only appear after payroll for that month has been **approved** by the payroll team.

**Printing tip:** in the browser's print dialog switch on **Background graphics** if the coloured bands don't print.

### 3.5 My profile

Open **My profile** from the user menu.

- **Overview** tab: *Personal*, *Employment* and *Bank & identity* cards. Use the **Edit** button on **Personal** and **Bank & identity** to change your own phone, date of birth, gender, address, emergency contact and bank/ID details. The **Employment** card (department, designation, manager, status) can be changed by HR only.
- **Documents** tab: upload your documents (below).
- **Career** tab: your history (joining, confirmation, promotions, transfers).
- **Salary** tab: your salary structure and revisions.

The employee's name, role and badges appear in the top bar while you are on the profile page.

**Profile photo.** Click the small upload button on your picture in the **sidebar** (under the logo) and choose a JPG or PNG (max 5 MB). It replaces your initials in the sidebar and the top bar.

**Documents tab**

| Card | Notes |
|---|---|
| **PAN Card**, **Aadhar Card** | Required |
| **Driving Licence**, **Passport** | Optional |
| **Signature** | Required |
| **Education Documents** | Required; you can select **several files** at once |
| **Past company Other document** | Offer, experience and other earlier-employer papers, plus signed policies |

How to upload: choose a file (or files) on each card you need, then click the single **Upload Documents** button. Each file can be **JPG, PNG or PDF, up to 5 MB**. Each card shows **Pending**, **Uploaded** or **Verified**.

**Changing a document.** You can change your own documents **until HR verifies them**:

- **Replace:** for PAN Card, Aadhar Card, Driving Licence, Passport and Signature, choose a new file on the card and click **Upload Documents**. The new file replaces the old one. (Education Documents keeps every file you add.)
- **Remove:** click **Remove** under a file and confirm. The card goes back to *Pending* and you can upload again.
- **Locked:** once HR has verified a document, the card shows **Verified · locked** and you can no longer replace or remove it. If it needs correcting, ask HR: they can still remove or replace it.

To look at an uploaded file click **View Document**. One popup shows all your documents with **Previous / Next** buttons, the arrow keys, and name chips at the bottom to jump to any file. HR can **Verify** a document once checked.

### 3.6 Org chart

**Org chart** shows the whole company as a tree.

- Each card has the person's initials, name and designation, and a small badge with their number of direct reports.
- Cards are **colour-coded by department**. Click a department chip above the chart to highlight it and fade the rest.
- The chart **fits itself to the window**. Use **−**, **+** and **Fit** to zoom.
- Click a card to open that person's profile (if your role may view employees).

### 3.7 Announcements

**Announcements** lists company news from HR. The latest also appear on the dashboard.

---

## 4. Manager guide

Managers (role **Reporting Manager**) get an **Approvals** page.

- **Leave** tab: requests from your reporting tree. Open one, check the dates and balance, then **Approve** or **Reject** (add a note if you wish).
- **Attendance** tab: regularization requests from your team.
- The menu badge and the notification bell show how many items are waiting.

You can only decide requests for people below you in the reporting tree, and **never your own requests**. HR can decide anyone's.

Use **Attendance → Team today** and **Leave → Who is off** to see who is working and who is away.

---

## 5. HR and admin guide

### 5.1 Employees

**Employees** lists everyone with search and filters.

- **Add employee:** fill in personal details, department, designation, reporting manager, shift, join date, employment type, location and status. Tick **Create login** to create a sign-in with a role. The system shows a **one-time temporary password**; share it securely and ask the person to change it at first login.
- **Open an employee** to see the same tabs as *My profile*. HR can edit every field, change the **Employment** card, **verify** or **delete** documents, record career events (confirmation, promotion, transfer…) and see salary history.
- Employee codes (`EMP0001`, `EMP0002`, …) are assigned automatically.

### 5.2 Users & access

**Users & access** (Super Admin and HR Admin) controls who can sign in.

- **Add user:** email, role, and (optionally) the employee record the login belongs to. The system shows a one-time temporary password.
- **Disable** or re-enable an account.
- **Reset password:** generates a new temporary password for that user.

(The server also accepts role changes for a user, `PATCH /users/:id`; the screen currently offers add, disable/enable and reset.)

Disabled users cannot sign in. Their records stay.

### 5.3 Org settings

**Org settings** has one tab per master list. Who can edit each:

| Tab | Content | Needs |
|---|---|---|
| **Departments** | Names | `org.manage` |
| **Designations** | Titles and levels | `org.manage` |
| **Shifts** | Start/end time, grace minutes, half-day threshold, weekly offs | `attendance.manage` |
| **Leave types** | Name, code, colour, annual quota, carry-forward cap, paid/unpaid, half-day, whether weekends/holidays inside the range count | `leave.manage` |
| **Holidays** | Date, name, optional or company holiday | `leave.manage` |
| **Company** | Logo, name, tagline, address, phone, email, website, registration / GST number, payslip accent colour, signatory name and title, payslip footer note | `org.manage` |

**Company profile and logo.** Upload a PNG or JPG logo (max 2 MB; a wide logo on white works best). The same profile appears on every payslip. Changing the logo, colour or signatory updates all payslips, including past months.

**Holidays.** Indian public holidays for 2027–2029 are included. Festival dates that depend on the moon (Ramzan Id, Bakrid, Muharram) are marked "(tentative)": confirm them against the official list each year. To add more, run `npm run holidays` in `server` after editing `server/scripts/seed-holidays.js`, or add them one by one in **Org settings → Holidays**.

### 5.4 Announcements

**Announcements → New** lets HR post news, optionally pinned to the top. Edit or delete from the same page.

### 5.5 Reports

**Reports** (with CSV export) has three tabs:

- **Headcount** by department and status.
- **Attendance** monthly summary per employee.
- **Leave utilization** by leave type.

### 5.6 Audit log

**Audit log** (Super Admin and Auditor) records every sensitive change: who did it, what changed (old and new values) and when. Examples: employee edits, sensitive-field changes, document uploads, downloads and verifications, leave and regularization decisions, payroll actions, password changes, company-profile changes.

---

### 5.7 HR tests (interviews in the office)

**HR tests** (sidebar, Administration) is for anyone who can manage employees (HR Admin and Super Admin).

1. **Tests & questions → New test.** Give it a name, the job role and industry, the time allowed, the pass mark and instructions for the candidate.
2. **Add questions.** A *multiple choice* question has two to six options and one correct option; it is marked automatically. A *written* question has an optional model answer that only HR sees; HR marks it by hand. Each question has its own marks. **Duplicate** copies a test so you can adapt it for another role.
3. **Candidates & results → Add a candidate.** Choose the test, enter the candidate's name and **email** and the test date. The system makes a 6-digit **access code**. Give the candidate the test page address, their email and the code. You can copy all three from the box that appears.
4. The candidate opens the test page on the office computer (the **Open candidate test page** button), signs in with the email and code, reads the instructions and presses **Start**. A timer runs; answers are saved every few seconds; the test is submitted when the candidate presses Submit or time runs out. The page needs no staff login.
5. HR watches the **Candidates & results** list update by itself: *Not started*, *Taking the test* (with time left) and *Submitted* with the score. Open **Result** to see every answer beside the correct one, mark the written answers, and add private interview notes. The result is **Pass** or **Fail** against the pass mark once all written answers are marked; until then it shows *Needs marking*.
6. **Re-test** clears the answers and gives a new code. **New code** does the same for a candidate who has not started.

Good to know: the access code only works on the test date; a candidate can only be signed in once at a time and cannot see correct answers or scores; once any candidate has started a test its questions are locked (use Duplicate to change them); a test that has been taken can be archived but not deleted.

### 5.9 Email and forgotten passwords

**What WorkPilot emails**
- A **welcome email** with the company code, the sign-in link and the **temporary password** when a login is created (Add employee with a login, or Users &amp; access → Add user), and when an admin resets a password.
- A **password reset link** when someone presses **Forgot password?** on the sign-in page. The link works for **1 hour and only once**, and is never usable as a sign-in. The answer on screen is always the same, so nobody can find out which emails have accounts. At most 3 reset emails an hour go to one address.
- A **"your password was changed"** email whenever a password is changed or reset.
- **Notification emails** for things that need attention: leave requests and decisions, attendance regularization, overtime, payslips ready, and employment changes. Birthdays, anniversaries and announcements are only shown in the app.
- **Subscription reminders:** in the last 7 days before a company's subscription ends, the company admin and the platform owner get one email a day (sent when someone uses the site that day).

**Setting it up (platform owner)**
1. Sign in at **/platform** and press **Test email**, then enter your own address. With the PHP site, the host's own mail function is used by default.
2. If it fails or goes to spam, create a mailbox in cPanel (Email Accounts, for example noreply@yourdomain.com) and add the `'mail'` block to `app/config.php` (a commented example is in the file). For the Node version use the `SMTP_*` settings in `.env`.
3. Without email the site still works: notifications appear in the bell and an admin can reset a password under **Users &amp; access**.

**Temporary passwords must be replaced.** Anyone whose login was created or reset by an administrator (including a new company's first admin) sees a **Choose your own password** screen at their first sign-in and cannot use anything else until they do. They then sign in again with the new password. The new password must differ from the temporary one and follow the password rules. Resetting a password through the emailed link, or changing it from the menu, also clears the requirement.

Tips: the temporary password in a welcome email is meant to be changed straight away (top-right menu, Change password). Emails are sent after the page has answered, so a slow mail server never slows the site.

### 5.10 Two-step sign-in (authenticator app)

Two-step sign-in adds a 6-digit code from an app on the person's phone after the password, so a stolen password alone cannot open the account.

- **Required** for every **Super Admin** (company admin) and for the **platform owner**. At their next sign-in they are taken to a **Set up two-step sign-in** screen and cannot use anything else until it is done.
- **Optional** for everyone else: top-right menu → **Two-step sign-in**.

**Setting it up** (about two minutes)
1. Install an authenticator app on your phone: Google Authenticator, Microsoft Authenticator or Authy.
2. Press **Set it up**, scan the QR code (or type the key shown), and type the 6-digit code the app shows.
3. WorkPilot shows **8 recovery codes** once. Download or print them and keep them safe. Each works **one time** if you lose your phone.

**Signing in afterwards:** email and password, then the 6-digit code (or a recovery code). A code works once and only for about a minute. Five wrong codes lock the account for 15 minutes.

**Lost phone**
- Use a recovery code to sign in, then set up the new phone (menu → Two-step sign-in → New recovery codes).
- A company admin can reset a colleague: **Users & access → Reset two-step**. The person signs in with the password alone and sets it up again if their role requires it.
- The platform owner resets a company admin with **Admin password** on the platform page (this also clears their two-step setup).
- If the **platform owner** loses the phone and all recovery codes, run this in phpMyAdmin, then sign in and set it up again: `DELETE FROM platform_2fa;`

Good to know: the authenticator secret is stored encrypted using the site's `jwt_secret` (do not change that secret after people have set up two-step sign-in, or they will need a reset). The phone's clock must be right (set it to automatic).

### 5.11 Your data: download and backups

**Download my company data (company admin).** Master sheet → **Your company data**. You get a ZIP with one spreadsheet (CSV) per list: employees, attendance, leave, payroll, overtime, tests and everything else, plus a README with the row counts. **Download data and files** also includes uploaded documents, photos, the logo and chat files. Passwords and security codes are never included. Use it to keep your own copy or if you move to another system. Up to 6 downloads an hour. Each download is recorded in the audit log. The file contains personal data, so store it safely.

**Backups (platform owner).** The whole database, every company together, is saved automatically about once a day as a compressed SQL file in `app/storage/backups` (the newest 14 are kept; the uploaded files are saved every Sunday, newest 4 kept). Open **/platform → Backups** to see them, press **Back up now**, or download a file. For a backup that does not depend on someone visiting the site, add a cPanel cron job that runs `app/cron-backup.php` once a day (see the install guide, Part H).
- **Keep copies away from the server.** A backup stored only on the same server is lost if the server is lost. Download one regularly.
- **Restore:** phpMyAdmin → select an empty database → Import → choose the `.sql.gz` file.
- **Export one company:** on the platform page press **Export** beside the company (for example when a customer leaves).
- Automatic backups need the MySQL database. Switch the automatic backup off with `'backup' => ['auto' => false]` in `app/config.php`.

### 5.12 Help desk, company policies and assets

**Help desk** (sidebar, for everyone with an employee record). An employee presses **New ticket**, chooses what it is about (HR question, Payroll, IT / equipment, Office / admin, **Grievance**, Other), a priority and the details. The HR team (anyone who can manage employees) is notified by email and in the bell, opens the ticket, replies, changes the **status** (Open, In progress, Resolved, Closed) and **priority**, and can add **internal notes** that the employee never sees. The employee gets a notification for every reply and status change, can reply (which re-opens a resolved ticket), and can close or re-open their own ticket. Tickets are private: an employee sees only their own, and a **grievance** is seen only by the person who raised it and HR. HR sees every ticket under **All tickets**.

**Company policies** (sidebar: Policies). HR presses **Publish a policy**, enters a title and description and uploads a **PDF or Word (.docx)** file (checked like every other upload). Everyone is notified. Each employee opens the policy (**Read**) and then presses **I have read it** to acknowledge it; the date is recorded. **Who read it** shows HR who has acknowledged and who has not. Choosing a new file under **Edit** publishes a **new version**, and everyone must acknowledge it again. A policy can be marked "for information" (no acknowledgement), switched off (hidden from employees) or deleted.

**Assets** (Administration → Assets, HR only). Register laptops, phones, ID cards, access cards and other company property with a tag, name, serial number, purchase date and value. **Issue** an asset to an employee (the condition is noted and the employee is notified), **Take back** when it returns (note its condition and whether it is available again, in repair or retired), and open its **History** to see everyone who held it. An asset that is issued cannot be deleted or changed to another status until it is taken back, and one that was ever issued keeps its history (mark it retired instead of deleting). Each employee's profile has an **Assets** tab showing what they hold now and held before, which is the checklist to use when someone leaves.

### 5.13 Letters (offer, appointment, experience, relieving)

**Administration → Letters** (HR only) creates letters on your company letterhead: the logo, company name, address, phone, email, website and registration number from **Org settings → Company**, a reference number, the date, the text and a signature block.

1. Press **Create a letter**. Choose the employee and the letter (Offer, Appointment, Experience, Relieving, or your own templates). Enter who signs it and the extra dates the letter needs (last working day, resignation date, probation, notice period).
2. WorkPilot fills in the letter from the employee's record: name, designation, department, date of joining, work location, reporting manager and the **monthly and annual gross salary** from their current salary structure (written in Indian digit grouping, for example Rs. 5,10,720). Anything it cannot find shows as **[not set]** so you notice it.
3. Read the text and change anything you need, then press **Issue letter**. The letter gets a reference number such as **OFR/2026/0001** (OFR offer, APT appointment, EXP experience, REL relieving, LTR other; the number runs on within each type and year), the employee is notified, and the letter opens ready to print.
4. Press **Print / Save as PDF**. In the print window choose **Save as PDF** as the printer to download a PDF (turn off "Headers and footers" for a clean page). It prints on one clean page without the menus.

**Templates** (Letters → Templates). The four standard letters come with WorkPilot and can be edited or switched off, but not deleted. Add your own (salary certificate, address proof, warning letter...). The text can include details such as the employee's name or salary by clicking them in the list; each is replaced by the real value for every employee. Changing a template never changes letters that were already issued.

**For employees:** an issued letter appears on the employee's profile under **Letters** (and in a notification), where they can view and print it. Employees see only their own letters. HR can delete a letter issued by mistake. Issuing and deleting are recorded in the audit log.

### 5.14 Attendance rules (selfie, QR, machines, late rules, reminders)

All of these are set by an admin on **Master sheet → Attendance rules** and **Biometric machines**.

- **Selfie.** When on, checking in opens the camera and the photo is saved with the punch. Managers and HR see it from the small eye icon on the attendance calendar. It is a record for people to look at; it does not match faces. The camera works only on https pages.
- **QR sign-in.** Open **Attendance → Office QR code** on a screen at the entrance. The code changes every 30 seconds. With *Required*, employees can check in or out only after scanning it with their phone, which proves they are at the office better than location alone.
- **Biometric machines.** Add a machine to get a secret key (shown once). The machine's software sends punches to `POST /api/v1/device/punch` with the header `X-Device-Key`. People are matched by employee code. The first punch of a day is the check-in, the last is the check-out. Machines that cannot call a web address need a small bridge program; WorkPilot does not talk to machine hardware directly.
- **Late and early rules.** Arriving more than a set number of minutes late, or leaving more than a set number early, makes the day a half day. Optionally, after a monthly allowance of late arrivals, each further one costs half a day's pay.
- **Overtime from punch times.** Work beyond the shift end (or any work on a weekly off or holiday) becomes a pending overtime claim, marked *From punch times*, which the manager approves. Claims the employee made themselves are left alone, and closed payroll months are not touched.
- **Reminders.** "Did you forget to check out?" and "You have not checked in today" appear in the bell and are emailed, once a day each. They run every few minutes by themselves. To switch the automatic run off on the PHP host use `'reminders' => ['auto' => false]` in config.php.

### 5.15 Phone, languages and printing

- **Install on a phone.** Open the site in Chrome (Android) or Safari (iPhone), choose "Add to Home screen" or "Install app". It opens full screen like an app, with the WorkPilot icon, and shows a friendly page when there is no connection. It does not store any company data on the phone for offline use, and notifications still appear only inside the app (phone push notifications are not included).
- **Hindi and Marathi.** Choose the language on the sign-in page or in the user menu (top right). The sign-in page, menu, dashboard check-in and the attendance page are translated; other screens still show English. A phrase with no translation shows in English. The wording was written without a native review, so ask a Hindi / Marathi speaker to check it. To translate more, wrap the text in `t('...')` and add a line to `client/src/i18n/hi.js` and `mr.js`.
- **Accessibility.** There is a "Skip to content" link for keyboard users, clear keyboard focus outlines, and animations stop for people who ask their device for reduced motion.
- **Printing.** Payslips, letters and tables print cleanly on A4: menus and buttons are hidden and table headings repeat on each page.

### 5.8 Attendance location (geo-fence)

**Master sheet → Attendance location** (admin only) controls where people may check in and out.

1. Press **Add location**. Stand at the office with your phone or laptop and press **Use my current location**, or paste the latitude and longitude from Google Maps. Set the **allowed distance** (100 m suits one building). Add one location per office.
2. Set **Location check** to **On** and press **Save**. (It cannot be switched on until at least one active location exists, and the last active location cannot be removed while it is on.)

From then on, **Check in** and **Check out** ask the person's browser for their location. The punch is refused, with a clear message, when:
- the person blocks location access or the location cannot be found (nothing is recorded),
- the location is too vague (vaguer than the **least precise location accepted**, default 150 m),
- the person is further than the allowed distance from every office location (the message says how far away they are).

The place and exact position of every punch is saved with the attendance record. Employees see only the place names, never the coordinates. Regularization requests (forgotten punches) are not location-checked, because a manager approves them.

Good to know: browsers share location only on **https** pages (the live site) and when the person allows it. Someone using special tools can fake a phone location, so use this together with normal supervision.

## 6. Payroll guide

Payroll is for the **Payroll Admin** and **Super Admin**.

### 6.1 Salary master (your salary categories)

**Payroll → Salary master** is where the company decides which salary categories exist, to match its own policy.

- **Website logo:** the admin uploads (or removes) the logo here. It is used in the sidebar, on the sign-in page, as the browser-tab icon and on payslips. Until one is uploaded, the built-in WorkPilot logo is shown.
- **Standard categories** (Basic, DA, HRA, Special allowance, Conveyance, Travelling allowance, Medical allowance, Other allowances) can be **renamed** or **switched off**. A switched-off category disappears from the salary form and breakup and is left out of new payroll runs. Basic salary cannot be switched off. Standard categories cannot be deleted.
- **Add category** creates your own **earning** (for example Performance allowance, Shift allowance) or **deduction** (for example Canteen recovery, Staff loan). Earnings are added to gross and pro-rated for unpaid days; deductions are a fixed monthly amount.
- For your own earnings, tick **Counts as wages** only if the law treats the amount like Basic for PF, ESIC and gratuity. Otherwise it is treated as an allowance under the 50% rule.
- **Remove** deletes a category you added. If a salary structure still uses it you will be asked to switch it off instead, so history is never lost.

New categories show up as extra boxes in **New revision** on each employee's Salary tab, and as extra lines on the payslip. Old payslips keep the names and amounts they were created with.

### 6.2 Salary structures (Indian salary breakup)

Each employee needs a salary structure before they can be paid. On the employee's **Salary** tab, **Current salary breakup** shows today's earnings and statutory settings, and **New revision** adds a structure with:

- **Earnings (per month):** Basic, Dearness allowance (DA), HRA, Special allowance, Conveyance, Travelling allowance, Medical allowance and Other allowances. Gross salary is their total.
- **Provident fund:** *On wage ceiling* (PF on the statutory ceiling, the usual choice), *On actual wages*, or *Not applicable*.
- **ESIC:** applicable or not. It is only deducted while the employee's wages are within the ESIC ceiling.
- **Professional tax:** Maharashtra or not applicable.
- **Income tax (TDS) per month** and **Other recoveries** (loan, advance, canteen).
- an **effective-from** date.

A new revision starts with the current values filled in, so you only change what moved. History is kept: a new row never overwrites an old one. Payroll uses the latest structure effective on or before the end of the month.

### 6.3 Running payroll

1. Open **Payroll → Run payroll** and choose the month. (You cannot run a future month, and a month can only be run once.)
2. The system creates a **draft** and calculates every employee who has a salary structure.
3. Review the list. You can **Recompute** a draft (for example after attendance corrections) or **Delete** it and start over.
4. **Approve** the draft. Employees can now see their payslips.
5. **Mark as paid** once salaries have been transferred. Employees get a "Your payslip is ready" notification.
6. **Export CSV** at any time for your accounts team.

### 6.4 What a payslip contains

| Item | How it is worked out |
|---|---|
| **Paid days** | Days present, plus paid leave, holidays and weekly offs; half days count 0.5; unpaid leave and absences are not paid. |
| **Earnings** | Each component × (paid days ÷ days in the month). Gross is their sum. |
| **Statutory wages** | Gross less the part of HRA, conveyance, travelling, medical and other allowances that is above 50% of gross (the Labour Codes 50% rule). It is the base for PF, ESIC and gratuity. |
| **Provident fund** | Employee 12% of PF wages. PF wages are the statutory wages, limited to the PF wage ceiling unless *On actual wages* is chosen. |
| **ESIC** | Employee 0.75% of statutory wages, only if ESIC is applicable and wages are within the ESIC ceiling. |
| **Professional tax** | Maharashtra: men ₹175 for ₹7,501–10,000 and ₹200 above that; women ₹200 above ₹25,000; February ₹300 instead of ₹200. |
| **TDS / other recoveries** | The monthly amounts entered in the salary structure. |
| **Net pay** | Gross − total deductions (never below zero). |
| **Employer contributions** | Employer PF 12%, EDLI 0.5%, PF admin 0.5%, employer ESIC 3.25% and the monthly gratuity provision (statutory wages × 15 ÷ 26 ÷ 12). They are shown separately and are not deducted from the employee. |
| **Cost to company** | Gross + employer contributions + gratuity provision. |

Rates are not fixed in the program. **Payroll → Statutory rates** lists every PF, ESIC and gratuity rate with the date it applies from. **Change a rate** adds a new dated value, so a change (for example the PF wage ceiling moving to ₹25,000 from 17 September 2026) only affects months from that date. Older months keep the rates that applied then. A month uses the rates in force on its last day.

> **Important:** TDS is **not** worked out automatically. Enter the monthly amount from the employee's tax projection. Statutory bonus, variable pay (incentives, overtime), Labour Welfare Fund, other states' professional tax and full-and-final settlement are not included. Have a payroll professional validate the setup before using it for real salaries.

---

### 6.5 Overtime

**Employees** open **Overtime** in the sidebar and press **Request overtime**: the date worked, the start and end of the extra work, and a reason. The page shows the month's approved hours, hours waiting for approval, hours still allowed and the employee's normal pay per hour.

**Approvers** (the reporting manager, or HR when there is no manager) see the claim on **Approvals → Overtime** with the estimated pay, and approve or reject it with an optional note. Nobody can approve their own claim. An employee can cancel a pending or approved claim until payroll for that month is approved.

**Payroll** adds the approved hours for the month as an **Overtime** line on the payslip and in the gross. Overtime is not treated as wages for PF, ESIC or gratuity and is left out of the 50% rule. Professional tax is worked out on the gross including overtime. The Payroll CSV has Overtime hours and Overtime pay columns.

**Pay per hour** = (Basic, Basic + DA, or Gross, as chosen on the Master sheet) ÷ (working days × working hours), multiplied by the rate for the type of day. The type of day (working day, weekly off or holiday) comes from the employee's shift and the holiday list. The rate is fixed when the manager approves, so later changes to the policy do not change approved claims.

**Master sheet → Overtime** (admin only to change; others can view) holds the company policy: overtime on or off, what the hourly pay is based on, working days per month and hours per day, the rate for a working day, a weekly off and a holiday (the Factories Act asks for 2×), the shortest claim, the most hours in a day and in a month, and how many days after the work a claim may be raised.

On each employee's **Salary** tab, **Overtime** can be set to "Not eligible" for people who should not be paid overtime (for example senior managers). Claims are refused for them.

### 6.6 Payroll compliance (second approver, state tax, returns, one-off items)

**Second approver.** Master sheet → *Payroll approval control* (admin only). When on, the person who creates a payroll run cannot approve it, and the person who approves it cannot mark it paid. You need at least two people with payroll rights.

**Professional tax by state.** Master sheet → *Professional tax by state* holds the slabs (Maharashtra, Karnataka, Telangana, Andhra Pradesh, West Bengal, Gujarat, Madhya Pradesh, Odisha, Assam are included). These are starting values: **check them against your state's current notification** and edit anything that differs. Choose the state on each employee's Salary tab.

**UAN and ESIC number.** Stored on the employee's Bank & ID section; needed for the PF and ESIC files.

**Adjustments & calculators** (Payroll → third tab). One-off items (arrears, bonus, gratuity, leave encashment, recoveries) are added to a month and appear on that month's payslips when payroll is run or recomputed. They are paid in full and are not counted as PF/ESIC wages. Calculators: gratuity (15/26 × basic+DA × years, 5-year rule, ₹20 lakh cap), leave encashment (basic+DA ÷ 30 × days) and statutory bonus (8.33–20%, wage ceiling, eligibility limit). Items cannot be changed once the month's payroll is approved.

**Files for filing and payment.** On an approved or paid run: PF return (ECR text file), ESIC return, professional tax summary by state, and a bank transfer CSV. A check lists missing UAN, ESIC number, bank details before download. **Upload the ECR once on the EPFO portal to confirm the format is accepted.**

**Not yet included:** income-tax (TDS) calculation with declarations, Form 16 and 24Q, and automatic arrears for backdated revisions.

## 7. Chat

The chat button (bottom-right) opens WorkPilot Chat for everyone with a login.

### 7.1 Conversations

- **Direct chat:** click the *person +* icon, choose someone. The same two people always share one thread.
- **Group chat:** click the *group* icon, name the group, tick members and **Create group**. Inside a group, click the members icon to **add people** or **leave**.
- **Everyone channel:** created automatically; every active user is a member.
- A green dot means the person was active in the last minute.

### 7.2 Messages and files

- **Enter** sends; **Shift + Enter** starts a new line. Links become clickable. Use 😊 for quick emoji.
- **Attach a file** with the paperclip or drag it into the chat. Allowed: images (PNG, JPG, GIF, WebP), PDF, Word, Excel, PowerPoint, TXT, CSV and ZIP, **up to 10 MB** each. Other types (for example `.exe`) are refused.
- Images appear inline (click to enlarge). Other files appear as a card; click it to download.
- **✓** means sent and **✓✓** (blue) means seen. In a group, ✓✓ appears once anyone else has read it.
- Delete **your own** message with the bin icon; its attached file is removed too.
- Unread counts appear on the chat button, on each conversation and in the browser tab title.

Only members of a conversation can read its messages or download its files.

### 7.3 Desktop notifications

Click **Turn on** in the banner at the top of the chat list (or the bell in its header) and allow the browser's prompt. You then get a pop-up for new messages while WorkPilot is open in any tab, unless you are already looking at that conversation. Click the pop-up to jump to the chat. Turn them off any time with the same bell.

If the browser's permission was blocked earlier, open the lock icon in the address bar and allow notifications for the site.

---

## 8. How the rules work

### 8.1 Attendance

- A **shift** defines start and end time, a **grace period** (default 15 minutes), a **half-day threshold** (default 240 minutes worked) and **weekly offs**. Employees without a shift use 09:30–18:30 with Sunday off.
- **Late** = checking in after start time + grace. The late minutes are counted from the start time.
- **Half day** = a completed day with fewer worked minutes than the half-day threshold.
- A day is **absent** when there is no punch and no leave. Today shows as *pending* until the day ends. Days before joining or after leaving show as not applicable.
- Company time zone is set by `COMPANY_TZ` (default `Asia/Kolkata`).

### 8.2 Leave

- **Counting days:** weekly offs and company holidays inside the range are skipped, unless the leave type is set to count them. A half day counts 0.5 and must be a single date.
- **Balances** are created per year the first time they are needed. The annual quota is credited up front; people who join mid-year get a **pro-rata** quota. Unused leave carries forward up to the type's **carry-forward cap**.
- **Checks on apply:** enough balance (pending requests are counted), no overlap with other requests (two opposite half days on the same date are allowed), not before the joining date, and not across a year boundary (split those into two requests).
- **Approval:** the balance is checked again and deducted in one transaction. Rejecting or cancelling restores it. Types with a quota of 0 (for example *Loss of Pay*) are unlimited but still tracked.
- **Who approves:** a manager for their tree, HR for anyone. Nobody approves their own request.
- **Cancelling:** employees can cancel pending requests, or approved ones that have not started. HR can cancel past approved leave.

### 8.3 Documents

Employee documents are stored on the server's disk (`server/uploads/employees/<id>/`) and served only through authenticated downloads: the employee themselves and HR may open them. Limits: JPG, PNG or PDF, 5 MB. A profile photo is a document of type *Profile Photo* and replaces the previous one.

---

## 9. Technical reference

### 9.1 Stack

| Layer | Technology |
|---|---|
| Web app | React 19, Vite, React Router, TanStack Query |
| API (two interchangeable versions) | **Node.js** 20+ with Express 5, Zod and Knex (`server/`), **or** plain **PHP** 7.4+ (`php/`) for ordinary shared hosting. Both answer the same `/api/v1` requests, so the web app and the database are identical. |
| Database | MySQL 8 / MariaDB for real use; SQLite (`better-sqlite3`) for a no-install local trial |
| Auth | JWT access token (15 min) + refresh token in an httpOnly cookie (7 days); bcrypt password hashes |
| Files | Local disk: `server/uploads/` (Node) or `app/storage/uploads/` (PHP) |
| Email | Optional SMTP via Nodemailer in the Node version. The PHP version sends no email; in-app notifications always work |

### 9.2 Folder layout

```
DEPLOY.md           Production deployment steps
HR-SPEC.md          Original specification
DOCUMENTATION.md    This file
client/             React web app
  src/pages/        One file per screen (Dashboard, Attendance, Leave, Payroll, …)
  src/ui/           Shared components (Chat, Payslip, charts, icons, formatting)
  public/           Static files (logo.png)
  dist/             Built web app (served by the API in production)
server/
  src/controllers/  Request handlers (employees, attendance, leave, payroll, chat, …)
  src/services/     Business logic (attendance status, leave counting, scope, audit, notify)
  src/routes/       All API routes and their permissions
  src/middleware/   Authentication and error handling
  src/db/           Migrations, seeds and the demo-data script
  scripts/          create-db, seed-holidays, smoke test
  uploads/          Documents, company logo, chat files (back this up)
php/                PHP version of the server, for hosting without Node.js
  site/api/         Entry point for every /api/v1 request
  site/app/         The code (lib, controllers, routes) and config.php; closed to browsers by .htaccess
  site/check.php    Setup check page, deleted after use
  test/router.php   Local test helper (not uploaded)
deploy/             Scripts that build the upload packages (see below)
```

### 9.3 Running it

**Local trial (SQLite)**

```
cd server
npm install
npm run setup     # create tables, roles, and the first Super Admin
npm run demo      # optional sample data
npm run dev       # API on http://localhost:4000

cd client
npm install
npm run dev       # web app on http://localhost:5173 (proxies /api to :4000)
```

**The /documentation page** is generated from this file. After editing `DOCUMENTATION.md`, run `npm run docs` in `client` (it also runs automatically before `npm run build`), then rebuild or restart as usual. The generated page lives in `client/public/documentation/`; the build script and its template are in `client/scripts/`. The page is plain HTML that anyone who can reach the site can open without signing in, so keep secrets out of this file.

**Production with Node.js** — see [DEPLOY.md](DEPLOY.md): configure `server/.env`, run `npm run setup:mysql`, `npm start`, serve over HTTPS, keep it running with a process manager and back up daily. `node deploy/make-bundle.mjs` builds an upload bundle for Node hosts.

**Production on ordinary PHP + MySQL hosting (cPanel)** — no Node.js needed:

```
node deploy/make-php-bundle.mjs --site=https://hr.example.com                     # own subdomain
node deploy/make-php-bundle.mjs --base=/hr/ --site=https://example.com            # folder: https://example.com/hr/
```

Each command writes a folder (`deploy/php-subdomain` or `deploy/php-folder`) with three files: `website-files.zip` (the only thing you upload to the website folder), `hr-live-install.sql` (import in phpMyAdmin; it also creates the first admin) and `READ-ME-FIRST.md` (step-by-step guide with the first admin password). After uploading, open `check.php` to see whether the server is ready, then delete it. Settings live in `app/config.php`: database name, user and password, and the signing secret.

Both server versions use the same database. When you change the database (a new migration), update **both** `server/src/db/migrations/` and the PHP code in `php/site/app/`, then rebuild the SQL file with `deploy/make-install-sql.mjs`.

**Server scripts**

| Command (in `server`) | Purpose |
|---|---|
| `npm run dev` / `npm start` | Start the API (with or without auto-reload) |
| `npm run setup` | Run migrations and seed roles, permissions and the admin user |
| `npm run setup:mysql` | Create the MySQL database, then run `setup` |
| `npm run migrate` / `rollback` | Apply or undo migrations |
| `npm run demo` | Load sample employees, attendance, leave and payroll |
| `npm run holidays` | Add Indian holidays for 2027–2029 (existing dates are kept) |
| `npm run smoke` | End-to-end API checks (needs the API running on demo data) |

When you upgrade the code, run `npx knex migrate:latest` in `server` to add any new tables.

### 9.4 Configuration (`server/.env`)

| Variable | Meaning |
|---|---|
| `PORT` | API port (default 4000) |
| `NODE_ENV` | `production` turns on secure cookies and refuses the default secret |
| `CLIENT_ORIGIN` | The public address people use (no trailing slash) |
| `FORCE_HTTPS` | `true` once the site runs on HTTPS |
| `DB_CLIENT` | `mysql2` (default) or `sqlite3` |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MySQL connection |
| `SQLITE_FILE` | SQLite file path when using `sqlite3` |
| `JWT_SECRET` | **Required.** A long random string |
| `COMPANY_TZ` | Company time zone, e.g. `Asia/Kolkata` |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | First Super Admin created by `setup` |
| `UPLOAD_DIR` | Where uploaded files are stored (default `./uploads`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Optional email |
| `ERROR_ALERT_EMAIL` | Email me when the server hits an unexpected error (needs the email settings). On the PHP site use `'alert_email'` in `config.php`. The same error is emailed at most once every 15 minutes, and nothing a user typed is included |

Never commit or share the real `.env`.

### 9.5 Data model (main tables)

| Table | Purpose |
|---|---|
| `users`, `roles`, `permissions`, `role_permissions` | Sign-in accounts, roles and what each role may do |
| `employees` | The employee master (personal, employment, bank and ID details) |
| `departments`, `designations`, `shifts` | Master lists |
| `employee_documents` | Uploaded documents (type, file, verified by/at, expiry) |
| `employment_history` | Career events, never overwritten |
| `attendance`, `attendance_regularizations` | Daily punches and correction requests |
| `leave_types`, `leave_balances`, `leave_requests`, `holidays` | Leave setup, per-year balances, requests, holidays |
| `companies`, `platform_admins` | **Platform tables (not per company):** the list of companies with their code, table prefix, status, employee limit and subscription end, and the platform owner logins |
| *every other table* | Created once per company under a prefix such as `c2_` (the first company has none). The application switches the table names for each request, so one company's queries can only reach its own tables |
| `letter_templates`, `letters` | Letter templates (four standard ones included) and the letters issued to employees with their reference numbers |
| `helpdesk_tickets`, `helpdesk_comments`, `policies`, `policy_acks`, `assets`, `asset_assignments` | Help desk tickets and replies, company policies with versions and acknowledgements, and company assets with their issue/return history |
| `platform_2fa` | **Platform table:** the platform owner's two-step secret (encrypted) and recovery code hashes. Created automatically on first use |
| `geo_settings`, `office_locations` | The location check on/off and the office places with their allowed distance (the punch position is stored on `attendance`) |
| `test_templates`, `test_questions`, `test_attempts`, `test_answers` | HR interview tests: question bank, candidates with their access codes, and answers with marks |
| `overtime_settings`, `overtime_requests` | The company overtime policy (one row) and employee overtime claims |
| `salary_structures`, `payroll_runs`, `payslips`, `statutory_rules`, `salary_components`, `salary_structure_items`, `payslip_items` | Salary history, monthly runs, payslips, the dated PF / ESIC / gratuity rates, and the company's salary master with its custom lines |
| `payroll_settings`, `pt_slabs`, `payroll_adjustments` | Second-approver switch, professional tax slabs per state, and one-off payroll items |
| `attendance_settings`, `attendance_devices`, `attendance_reminders` | Attendance rules (one row), machine keys (stored as hashes) and the reminders already sent |
| `platform_log` | **Platform table:** the platform owner's activity log (who, what, which company, IP). Companies also have a plan label, feature switches, an own web address and a last sign-in time |
| `company_profile` | One row: logo, name, address, accent colour, signatory, footer |
| `announcements`, `notifications` | News and per-user alerts |
| `audit_logs` | Who changed what, old and new values |
| `chat_conversations`, `chat_members`, `chat_messages`, `chat_reads` | Chat threads, membership, messages (with file info) and read positions |

### 9.6 API overview

Base path: `/api/v1`. Everything except sign-in needs `Authorization: Bearer <token>`. Errors return `{ "error": "message" }` with an HTTP status (400 invalid, 401 not signed in, 403 not permitted, 404 not found, 409 conflict, 423 locked).

| Area | Main endpoints |
|---|---|
| **Auth** | `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`, `POST /auth/change-password` |
| **Users** | `GET/POST /users`, `PATCH /users/:id`, `POST /users/:id/reset-password`, `GET /roles` |
| **Employees** | `GET/POST /employees`, `GET /employees/me`, `GET /employees/tree`, `GET/PATCH /employees/:id`, `PATCH /employees/me` (self-service), `GET /employees/:id/history`, `POST /employees/:id/events` |
| **Documents** | `GET/POST /employees/:id/documents`, `GET …/:docId/download`, `POST …/:docId/verify`, `DELETE …/:docId` |
| **Master data** | `GET/POST/PATCH/DELETE` on `/departments`, `/designations`, `/shifts`, `/leave-types`, `/holidays` |
| **Company** | `GET/PUT /company`, `GET/POST/DELETE /company/logo` |
| **Attendance** | `POST /attendance/check-in`, `/check-out`, `GET /attendance/today`, `/calendar`, `/team`, `GET/POST /attendance/regularizations`, `PATCH …/:id` |
| **Leave** | `GET /leave/balances`, `/calendar`, `GET/POST /leave/requests`, `PATCH /leave/requests/:id` (approve, reject, cancel) |
| **Platform owner** (extra) | `GET /platform/overview`, `GET /platform/log`, `GET /platform/features`, `GET /platform/companies/:id/health`, `DELETE /platform/companies/:id` (code + password), `GET /auth/host-company` |
| **Attendance rules** | `GET/PUT /attendance/settings`, `GET /attendance/qr`, `GET/POST/PATCH/DELETE /attendance/devices`, `POST /device/punch` (machine key), `GET /attendance/:id/photo/in|out`, `POST /attendance/reminders/run` |
| **Payroll compliance** | `GET/PUT /payroll/settings`, `GET /payroll/pt-states`, `GET/POST/PUT/DELETE /payroll/pt-slabs`, `GET/POST/DELETE /payroll/adjustments`, `POST /payroll/calc/gratuity|leave-encashment|bonus`, `GET /payroll/runs/:id/export/ecr|esic|pt|bank` |
| **Payroll** | `GET/POST /payroll/structures`, `GET/POST /payroll/rules`, `GET/POST /payroll/components`, `PATCH/DELETE /payroll/components/:id`, `GET/POST /payroll/runs`, `GET …/:id/payslips` (add `?format=csv`), `POST …/:id/recompute`, `PATCH …/:id` (approve, pay), `DELETE …/:id`, `GET /payroll/payslips`, `GET /payroll/payslips/:id` |
| **HR tests** | `GET/POST /tests`, `GET/PATCH/DELETE /tests/:id`, `POST /tests/:id/duplicate`, `POST /tests/:id/questions`, `PATCH/DELETE /tests/questions/:qid`, `GET/POST /test-candidates`, `GET/PATCH/DELETE /test-candidates/:id`, `POST /test-candidates/:id/grade` (HR only). Candidate side, no staff login (header `X-Test-Token`): `POST /candidate-test/login`, `GET /candidate-test/session`, `POST /candidate-test/start`, `PUT /candidate-test/answers`, `POST /candidate-test/submit` |
| **Platform owner** | `POST /platform/auth/login`, `GET /platform/me`, `POST /platform/change-password`, `GET/POST /platform/companies`, `PATCH /platform/companies/:id`, `POST /platform/companies/:id/reset-admin`, `POST /platform/upgrade` (own platform token; never reads company data) |
| **Letters** | `GET/POST /letters/templates`, `PATCH|DELETE /letters/templates/:id`, `POST /letters/preview`, `GET/POST /letters`, `GET|DELETE /letters/:id` |
| **Help desk, policies, assets** | `GET/POST /helpdesk/tickets`, `GET/PATCH /helpdesk/tickets/:id`, `POST /helpdesk/tickets/:id/comments`; `GET/POST /policies`, `POST|PATCH|DELETE /policies/:id`, `GET /policies/:id/download`, `POST /policies/:id/acknowledge`, `GET /policies/:id/acks`; `GET/POST /assets`, `GET|PATCH|DELETE /assets/:id`, `POST /assets/:id/assign`, `POST /assets/:id/return`, `GET /employees/:id/assets` |
| **Data export and backups** | `GET /export[?files=1]` (company admin); platform owner: `GET /platform/companies/:id/export`, `GET/POST /platform/backups`, `GET /platform/backups/:name` |
| **Two-step sign-in** | `POST /auth/2fa/verify` (public), `GET /auth/2fa`, `POST /auth/2fa/setup`, `/enable`, `/disable`, `/recovery-codes`, `POST /users/:id/reset-2fa`; platform owner: `POST /platform/auth/verify`, `GET/POST /platform/2fa…` |
| **Password reset and email** | `POST /auth/forgot-password`, `POST /auth/reset-password` (public); platform owner: `POST /platform/test-email` |
| **Attendance location** | `GET /attendance/geo` (any signed-in user: on/off and place names), `GET /geo`, `PUT /geo/settings`, `POST /geo/locations`, `PATCH/DELETE /geo/locations/:id` (admin only); `POST /attendance/check-in` and `/check-out` accept `{ latitude, longitude, accuracy }` |
| **Overtime** | `GET/PUT /overtime/settings` (PUT: admin only), `GET /overtime/summary`, `GET/POST /overtime/requests`, `PATCH /overtime/requests/:id` (approve, reject, cancel) |
| **Communication** | `GET /notifications`, `POST /notifications/read-all`, `GET/POST/PATCH/DELETE /announcements` |
| **Dashboard & reports** | `GET /dashboard/summary`, `GET /reports/headcount`, `/attendance`, `/leave` (add `?format=csv`) |
| **Chat** | `GET /chat/people`, `/chat/unread`, `GET/POST /chat/conversations`, `GET …/:id`, `GET/POST …/:id/messages`, `POST …/:id/read`, `POST …/:id/members`, `DELETE …/:id/members/me`, `GET /chat/messages/:id/file`, `DELETE /chat/messages/:id` |
| **Audit** | `GET /audit-logs` |
| **Health** | `GET /health` (no sign-in) |

The exact permission for each route is in `server/src/routes/index.js`.

### 9.7 Security notes

- Passwords are hashed with bcrypt; at least 10 characters; accounts lock after 5 failures; sign-in is rate-limited.
- The refresh token is bound to the password, so changing the password signs out other sessions.
- Every route checks the user's permission, and team-scoped data is filtered on the server, not only hidden in the screen.
- Uploaded files are stored outside the web root, checked by type and size, and downloaded only through authenticated endpoints. Chat blocks executable file types.
- The server sets security headers (Helmet and a content-security policy). Use HTTPS in production and set `NODE_ENV=production`.
- Sensitive changes are written to the audit log.

### 9.8 Testing

- `npm test` (in `server`) runs fast unit tests of the pay, attendance, feature-switch and two-step rules. No server needed.
- `node tests/run.mjs` (in the project folder) runs the API tests against a running copy of the site. Each test makes its own company and removes it again. The same tests run against the PHP version with `API=http://localhost:8300/api/v1`, and **must pass on both**. See `tests/README.md`.
- With the API running on demo data, `npm run smoke` (in `server`) runs end-to-end checks of permissions, team scoping, leave-balance maths, approvals and payslip privacy.

### 9.9 Backups

Back up **both** of these daily: the database (for MySQL: `mysqldump hrms > hrms.sql`) and the `server/uploads/` folder (employee documents, company logo and chat files).

---

## 10. Troubleshooting and FAQ

**I can't sign in.** Check the email and password. After five wrong attempts the account is locked for 15 minutes. Ask HR to reset your password if you forgot it.

**"Not permitted" or a missing menu item.** Your role doesn't include that feature. Ask HR or the Super Admin to check your role under **Users & access**.

**My payslip isn't there.** Payslips appear only after payroll for that month is approved.

**The Edit button is missing on a card.** The **Employment** card is editable by HR only. **Personal** and **Bank & identity** are editable by you and by HR.

**A document won't upload.** Use JPG, PNG or PDF up to 5 MB. For chat, the limit is 10 MB and some types are refused.

**I didn't get a chat pop-up.** Check the bell in the chat header is on, that the browser allowed notifications for the site, and that WorkPilot is still open in a tab. Pop-ups can be delayed a few seconds, and a long-idle background tab may be slower.

**The payslip prints without colours.** In the print dialog turn on **Background graphics**.

**The payslip still shows the old logo.** Upload the new logo in **Org settings → Company**. The sidebar logo is a separate file (`client/public/logo.png`).

**The page is blank after an upgrade.** Hard-refresh (Ctrl + F5). If you serve the built app, rebuild it with `npm run build` in `client`.

**The server says tables are missing.** Run `npx knex migrate:latest` in `server`.

**Do I need to restart anything after editing `.env`?** Yes. Restart the API.

---

## 11. Known limitations

- **TDS, bonus, overtime, Labour Welfare Fund and professional tax outside Maharashtra** are not calculated. TDS is a monthly amount you enter; PF, ESIC and Maharashtra professional tax are calculated.
- **Holiday dates** for 2028–2029 and all moon-dependent festivals are from third-party calendars and should be confirmed against the official gazette each year.
- **The PHP version sends no email** (the Node version can, through SMTP). It also has no per-address sign-in rate limit; accounts still lock for 15 minutes after 5 wrong passwords.
- **Chat** updates every few seconds (it does not push instantly). Desktop pop-ups work only while WorkPilot is open in a browser tab; there is no mobile app and no push service for closed browsers.
- **Chat avatars** show initials, not uploaded photos.
- **Single company** only: there is no multi-company or multi-tenant support.
- **Not included yet:** recruitment, performance reviews, training, assets, expenses, exit management, biometric device integration and a mobile app. See [HR-SPEC.md](HR-SPEC.md) for the original scope.
- Cross-year leave must be split into one request per year.

## 12. Platform owner guide (selling WorkPilot to many companies)

One WorkPilot installation can serve many companies. **Each company has its own private set of tables**, so a company can never see, change or even query another company's people, attendance, leave, payroll, documents, chat, overtime or HR tests. Uploaded files (documents, photos, logo, chat files) are also kept in a separate folder per company.

### 12.1 Who is who

- **Platform owner** (you): signs in at **/platform** with the platform login. Creates and manages companies. Cannot read a company's data from this screen.
- **Company admin**: the first login of each company (role *Super Admin*). They open **Users &amp; access** and create their own HR Admin, Payroll Admin, Reporting Manager, Employee, Management and Auditor logins. Everything in this guide then works inside their company.
- **Company users** sign in on the normal sign-in page with the **company code**, their email and password. The same email address can exist in two different companies.

### 12.2 Creating a company

1. Sign in at **/platform**.
2. Press **New company**. Enter the company name, a short **company code** (letters, numbers and hyphens, for example `acme`), the company admin's email and a first password (at least 10 characters).
3. Optionally set an **employee limit** (0 = no limit), a **subscription end date** and private notes.
4. A box shows the sign-in page address, company code, admin email and password. Send these to the customer. They should change the password after signing in.

### 12.3 Managing companies

- **Edit**: change the name, code, employee limit, subscription end date and notes.
- **Suspend / Activate**: a suspended company cannot sign in and any signed-in users are refused on their next action. Nothing is deleted. Activating restores access.
- **Subscription end date**: after this date nobody in the company can sign in until you extend it.
- **Employee limit**: when a company reaches its limit, adding another employee is refused with a message. Employees who have exited do not count.
- **Admin password**: sets a new password (and optionally a new email) for the company's admin, for example when they forget it.
- **Update databases**: after you install a new version of WorkPilot, press this once. It adds any new tables or columns to every company.

### 12.4 Good to know

- The **company code** is not a secret; it only tells the system which company to open. The password protects the data.
- The HR test page for candidates uses the company code too: the link HR copies already contains it (`/candidate-test?c=acme`).
- A company's own **Settings** and **Master sheet** (logo, salary categories, overtime policy) are separate from every other company.
- Deleting a company is deliberately not offered here. Suspend it instead; to remove its data completely, drop that company's tables (those starting with its prefix, for example `c2_`) in phpMyAdmin.
- The first company (code `default`) keeps the original tables with no prefix, so a site that already existed keeps all its data.

### 12.5 Plans, feature switches, own web address, health and delete

- **Plan and features.** When you create or edit a company at /platform you can give it a plan label and switch these on or off: Payroll and payslips, Overtime, HR tests, Attendance location check, Help desk / policies / assets, Letters and Chat. The presets (Basic, Standard, Full) only fill in the switches; you can change any of them. A feature that is off disappears from the company's menu and the server refuses it, so it can be sold as an add-on. Everything is on unless you switch it off. Turning payroll off hides the salary master and payslips too.
- **Own web address.** Enter an address such as `hr.acme.com` for a company. Point that name at the same site first (a DNS record, and an alias or parked domain in cPanel, with an SSL certificate). On that address the sign-in page does not ask for a company code. WorkPilot does not set up DNS or certificates for you.
- **Dashboard.** The top of /platform shows companies (active, suspended), employees in total, files stored, subscriptions ending within 30 days or already ended, and companies where nobody has signed in for 30 days. Each company shows its plan, last sign-in and storage.
- **Activity log.** The *Activity log* button lists what the platform owner did: sign-ins, creating or changing a company, suspending, resetting an admin, exports and deletes, with the time and IP address.
- **Health.** *Health* shows a company's database version, missing tables, number of employees and accounts, how many signed in during the last 30 days, admins with two-step sign-in, locked accounts, payroll runs and the month's punches. It shows counts only; you cannot see their people, pay or documents.
- **Delete a company.** Suspend it, press *Export* (with files) to download its data, then *Delete*. You must type the company code and your password, and the export must be less than 24 hours old. Everything of that company, including its files, is removed and the delete cannot be undone. The first company (the original tables) cannot be deleted from here.
- **Not included yet:** invoices and payments, and customers signing themselves up with a free trial. A subscription end date already stops sign-in automatically.

## 13. Security

### 13.1 What can be uploaded

Uploads are checked by their **real content**, not by their name or the type the browser reports. Anything else is refused with a clear message.

| Where | Allowed | Size |
|---|---|---|
| Employee documents | PDF, JPG, PNG | 5 MB |
| Company logo | PNG, JPG | 2 MB |
| Chat attachments | PNG, JPG, GIF, WebP, PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), TXT, CSV | 10 MB |

Always refused: programs and scripts (.php, .js, .exe, .bat, .sh ...), HTML and SVG, ZIP and other archives, the older Office formats (.doc, .xls, .ppt) and any Office file that contains a **macro**, a program or an embedded object. A picture, PDF or text file that has script code hidden inside it is refused. A PDF that contains JavaScript or file attachments is refused (print it to a new PDF and upload that). A text file must really be text.

Files are saved under a random name with an extension chosen by WorkPilot, outside the public part of the site. When someone opens a file it is sent as a **download** (only images may show inside the chat), with headers that stop a browser from running it.

### 13.2 Protection against break-in attempts

- **Sign-in guessing:** an account locks for 15 minutes after 5 wrong passwords, and each computer is limited to 20 sign-in attempts per 15 minutes (the platform owner login: 10).
- **Candidate test codes:** 8 wrong codes for an email lock that candidate out for 15 minutes, so the 6-digit code cannot be guessed.
- **Bulk copying or deleting:** one computer can make at most 600 requests a minute and 60 deletions a minute. A stolen sign-in cannot wipe or download everything quickly.
- **Backups:** the whole database is backed up about once a day (newest 14 kept) and can be downloaded by the platform owner; companies can download their own data as CSV files.
- **Two-step sign-in:** required for company admins and the platform owner (authenticator app code after the password, one-time recovery codes). A leaked password alone cannot open these accounts.
- **Passwords:** a login handed out with a temporary password must be changed at first sign-in; at least 10 characters; very common passwords, repeated characters and passwords containing your email name are refused.
- **Sessions:** a sign-in lasts 15 minutes and renews itself; changing the password signs the person out everywhere; a suspended company is refused at once.
- **Private data:** every request is checked for permission on the server (an ordinary employee is refused on every admin route, and on every other person's record). Companies cannot see each other's data (section 12).
- **Safe database access:** all database queries use bound values, so typing SQL into a search box does nothing.
- **Browser protection:** a strict content security policy (only WorkPilot's own scripts may run), no framing, no content-type guessing, HTTPS only with HSTS, and API answers are never cached.
- **Files that must not be downloaded** (.sql, .log, .bak, .env, .md, zip ...) and hidden files are blocked by the web server rules.
- **Audit log:** every sign-in, upload, download, verification, salary change and deletion is recorded (Audit log page).

### 13.3 What you should do on the live server

1. Use **HTTPS** only (the included web server rules redirect to it).
2. Keep `jwt_secret` in `app/config.php` long and secret, and change the first admin and platform owner passwords after the first sign-in.
3. **Delete `check.php` and any `.sql` file** from the website folder once the site works (check.php also switches itself off after the first sign-in).
4. Use a database user that has rights only on this database, with a long password.
5. **Take a backup every day** (cPanel Backup, or export the database from phpMyAdmin) and keep copies away from the server. A backup is the only full protection against someone deleting data.
6. Give people the lowest role they need (see section 2) and remove logins of people who have left.
7. Keep PHP updated (cPanel, Select PHP Version).

