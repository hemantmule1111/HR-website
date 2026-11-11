# WorkPilot: put it live at {{SITE}}

This works on ordinary **PHP and MySQL hosting** (cPanel). You do **not** need Node.js.

You have four files:

| File | What to do with it |
|---|---|
| `{{ZIP}}` | Upload it into the website folder and extract it. This is the **only** file that goes on the website. Its name says which address it is for: never use a zip made for a different address. |
| `hr-live-install.sql` | **New site (empty database):** import it in phpMyAdmin. Never upload it to the website folder. |
| `hr-live-upgrade-multicompany.sql` | **Site that is already running with data:** import it into the existing database instead (see Part B). Never upload it to the website folder. |
| `READ-ME-FIRST.md` | This guide. Never upload it either. |

**Platform owner login** (you: creates the companies, opens `{{SITE}}platform`): `{{PLATFORM_EMAIL}}` / `{{PLATFORM_PASSWORD}}`

**First company admin login** (company code `default`): `{{ADMIN}}` / `{{PASSWORD}}` (change both passwords after you sign in).

One WorkPilot site serves many companies. Each company has its own private data and its own logins. People sign in with their **company code**, email and password.

**Already running with data?** Use `hr-live-upgrade-multicompany.sql` in Part B, and in Part C keep your existing `app/config.php` (see *Updating later*). The first admin login above only applies to a brand-new site; an existing site keeps its current logins.

Your hosting needs: PHP 7.4 or newer (8.1 or newer is best), MySQL, and a free SSL certificate. Almost every cPanel host has these.

---

## Part A: Create the address

{{IF_SUBDOMAIN}}
1. In cPanel open **Domains** (or **Subdomains**) → **Create A New Domain** (or **Create**).
2. Enter `{{HOST}}`. Turn **off** "Share document root" if you see that option, so the subdomain gets its own folder.
3. Write down the **document root** folder cPanel shows for it, for example `public_html/hr` or `hr.wpart.co.in`. This is "the website folder" below.
4. Make sure SSL is on: cPanel → **SSL/TLS Status** → select `{{HOST}}` → **Run AutoSSL**. Wait until opening `https://{{HOST}}` shows no security warning (an empty page is fine). Come back to this step if you see a warning later.
{{/IF}}
{{IF_FOLDER}}
1. In cPanel **File Manager**, open `public_html` and create a folder named `hr` if it does not exist. This is "the website folder" below.
2. Make sure your main domain has SSL on (cPanel → **SSL/TLS Status** → **Run AutoSSL**).
{{/IF}}

## Part B: The database

1. cPanel → **MySQL Databases**:
   - Create a database (cPanel puts your account name in front, for example `abc123_hr`).
   - Create a user with a strong password.
   - Under **Add User To Database**, add that user to that database and tick **ALL PRIVILEGES**. This step is often forgotten, and without it the site cannot connect.
   - Write down the full database name, user and password exactly as shown.
2. cPanel → **phpMyAdmin** → click your database → **Import**:
   - **New site:** choose `hr-live-install.sql` → **Import**. It creates every table, the roles and permissions, the platform owner login, your first company and its admin, and Indian holidays for 2027 to 2029. Import it **once, into an empty database**.
   - **Existing site:** choose `hr-live-upgrade-multicompany.sql` → **Import**. It touches no existing table or row. It only adds the platform tables and registers your current data as the first company (code `default`). **Take a database backup first** (phpMyAdmin → Export).

## Part C: Upload the website

1. In **File Manager**, open the website folder ({{DOCROOT}}). For a **new site** it must be empty. For an **existing site** first rename `app/config.php` to `config-keep.php` (you will put it back in step 5). If it contains a default page such as `index.php` or `cgi-bin` leftovers, delete them.
2. Click **Upload** and upload `{{ZIP}}`.
3. Right-click the zip → **Extract** (into the same folder, overwriting anything already there). Then delete the zip.
4. Check that it worked: the **Last Modified** time of `index.html` must be today and just now. You should now see `index.html`, `api`, `app`, `assets`, `check.php` and a hidden `.htaccess` right in the website folder (turn on **Show Hidden Files** in File Manager Settings to see `.htaccess`). If they are inside another folder instead, move them up one level.

## Part D: Your settings

{{IF_DBFILLED}}Your database details are **already filled in** to `app/config.php`. You only need to open it (File Manager → `app` → right-click `config.php` → **Edit**) if the check page in Part E says the database cannot connect.
{{/IF}}{{IF_DBEMPTY}}1. Open `app/config.php` in File Manager (right-click → **Edit**).
2. Replace the three lines:
   ```
   'db_name' => 'PUT_DATABASE_NAME_HERE',
   'db_user' => 'PUT_DATABASE_USER_HERE',
   'db_password' => 'PUT_DATABASE_PASSWORD_HERE',
   ```
   with your real database name, user and password (keep the quote marks). Everything else is already set, including a unique security key. Save.
{{/IF}}

## Part E: Check, then sign in

1. Open **{{SITE}}check.php**. Every line should say OK. If a line says FAIL, fix it using the hint beside it (the table at the bottom of this guide also helps), then refresh.
2. When everything is OK, **delete `check.php`** from the website folder. Also make sure **no `.sql` file** is left in the website folder.
3. **Existing site only:** open **{{SITE}}platform**, sign in with the platform owner login, set up two-step sign-in when asked (see Part H), and then press **Update databases** once. It adds the newer features (Indian payroll, overtime, HR tests ...) to your existing data. Then open **{{SITE}}**, enter company code `default` and sign in with your **existing** admin login.
4. **New site:** open **{{SITE}}**, enter company code `default` and sign in with `{{ADMIN}}` and the password at the top of this guide.

## Part F: After you sign in

1. Top-right menu → **Change password** (and change the platform owner password at **{{SITE}}platform** the same way you were given it: keep it private).
   To add another customer company: **{{SITE}}platform** → **New company**. Send them the sign-in details the box shows.
2. **Org settings → Company**: upload your logo and fill in the company details (they appear on payslips).
3. **Org settings**: add departments, designations, shifts, leave types and holidays.
4. **Users & access** and **Employees**: add your people.

## Part G: Email (recommended)

WorkPilot emails welcome messages (with the temporary password), password-reset links, leave and payslip notices and subscription reminders. Out of the box it uses your host's own mail function, which works on most cPanel hosts.

1. Sign in at **{{SITE}}platform** and press **Test email**. Enter your own address. If it arrives (check spam too), you are done.
2. If it says it could not send, or it lands in spam: in cPanel open **Email Accounts** and create `noreply@{{HOST}}`. Then open `app/config.php`, remove the `//` in front of the `'mail' => [ ... ]` block, fill in the mailbox details (the mail server name is shown in cPanel under *Connect Devices*), save, and press **Test email** again.
3. Staff can now use **Forgot password?** on the sign-in page.

## Part H: Two-step sign-in and backups

1. **Two-step sign-in is required** for the platform owner and for every company admin. The first time you sign in at **{{SITE}}platform** you are asked to set it up: install an authenticator app on your phone (Google Authenticator, Microsoft Authenticator or Authy), scan the QR code, type the 6-digit code, and **save the 8 recovery codes** somewhere safe (they are shown only once). Company admins are asked the same at their next sign-in.
2. **Backups:** the whole database (every company) is saved automatically about once a day in `app/storage/backups` (newest 14 kept; uploaded files every Sunday). Open **{{SITE}}platform → Backups** to download them. **Download a copy regularly and keep it away from this server.** For a backup that does not depend on a visitor, add a cPanel cron job: cPanel → **Cron Jobs** → once a day → command `/usr/local/bin/php /home/YOURACCOUNT/<website folder>/app/cron-backup.php`.
3. **Restoring:** phpMyAdmin → an empty database → **Import** → choose the `.sql.gz` file.
4. Each company admin can download their own company's data (CSV files in a ZIP) from **Master sheet → Your company data**. You can export any company from the platform page (**Export**).

The documentation is built into the site at **{{SITE}}documentation**.

---

## Keep safe

- **Back up daily:** the database (cPanel → Backup, or phpMyAdmin → Export) **and** the folder `app/storage/uploads` (employee documents, company logo and chat files).
- Never share `app/config.php`. Do not leave `.sql` files or `check.php` on the server.
- Uploads accept only PDF, images and plain documents (Word, Excel, PowerPoint without macros, TXT, CSV). Scripts, programs, ZIP and macro files are refused.
- Sign-in is limited to 20 tries per 15 minutes per computer, and 5 wrong passwords lock an account for 15 minutes.
- Employee documents are never public: they are only downloaded through the signed-in site, and the `app` folder cannot be opened from a browser.
- Email is optional. If it is not set up, notifications still appear inside the site (the bell and chat), but forgotten passwords then need an admin to reset them (Users & access).

## If something goes wrong

Run **{{SITE}}check.php** first: it names the problem in most cases.

| What you see | What to do |
|---|---|
| **500 Internal Server Error** on every page | The `.htaccess` file may be wrong for your host. In cPanel → **MultiPHP Manager** make sure the site uses PHP 7.4 or newer. If it still fails, rename `.htaccess` to `.htaccess-off` and tell your host's support that the site needs `mod_rewrite`. |
| Pages open, but sign-in says **"Server error"** or **"Cannot connect to the database"** | The database name, user or password in `app/config.php` is wrong, or the user was not added to the database with **All privileges** (Part B). |
| Sign-in says **"Set jwt_secret in app/config.php"** | The `jwt_secret` line in `app/config.php` is missing or was changed to a short value. It must be a long random string. |
| Sign-in says **"Enter your company code"** or **"We could not find that company code"** | Type the company code (for the first company: `default`). The platform owner sees every company's code at {{SITE}}platform. |
| **Table ... doesn't exist** / **Unknown column** after updating | Sign in at {{SITE}}platform and press **Update databases**. |
| **Table ... doesn't exist** / **Unknown column** | The SQL file was not imported, or only partly. Empty the database in phpMyAdmin (select all tables, then Drop) and import `hr-live-install.sql` again. |
| Opening `/api/v1/health` shows a page instead of `{"ok":true}` | `.htaccess` is missing or ignored. Check that it is in the website folder (hidden file), and that your host allows `.htaccess` rewrite rules. |
| You can sign in, but a few seconds later you are asked to sign in again | The site must be opened with **https**. Run AutoSSL (Part A) and use the https address. |
| Uploads fail ("File is larger than…") | Your host's PHP limit is lower than 10 MB. In cPanel → **MultiPHP INI Editor** raise `upload_max_filesize` and `post_max_size` to 12M and 14M. |
| Uploads fail with **"Could not create the upload folder"** | Make the folder `app/storage` writable: File Manager → right-click it → **Change Permissions** → `755` (or `775`). |
| Blank white page | Hard-refresh (Ctrl + F5). Make sure `index.html` and the `assets` folder are in the website folder. |

## Updating later

1. In File Manager rename your `app/config.php` to `config-keep.php`.
2. Upload and extract the new zip over the website folder, then delete the zip.
3. Delete the new `app/config.php` that came with it and rename `config-keep.php` back to `config.php`. Your uploaded files in `app/storage` are untouched.
4. Sign in at **{{SITE}}platform** and press **Update databases** once. It adds any new tables or columns to every company. If the notes mention an SQL file, import it in phpMyAdmin first.
