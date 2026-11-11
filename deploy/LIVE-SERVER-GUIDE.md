# WorkPilot: put it live at {{SITE}}

This bundle contains the finished site, already built for {{SITE}}:

```
client/dist/        the web pages (already built, nothing to compile)
server/             the application (Node.js)
  app.cjs           start-up file
  env-template.txt  your settings (rename to .env, see Part E)
  src/ scripts/     the program and its database setup
database/           hr-live-install.sql: the whole database, ready to import (see Part D)
READ-ME-FIRST.md    this file
```

WorkPilot is a **Node.js** application with a **MySQL** database. Hosting that only runs PHP cannot run it. Work through Parts A to G in order.

---

## Part A: Get hosting that can run Node.js

You need either of these:

1. **A web-hosting plan with Node.js support** (easiest). In cPanel it shows as **Setup Node.js App**; some hosts have their own panel with a "Node.js" section. It must also include MySQL and a free SSL certificate.
2. **A small VPS** (a Linux server you manage yourself). More work: see "VPS option" at the end.

Before you pay, ask the host's sales chat or support this, word for word:

> I need to run a Node.js 20 (or newer) web application with a MySQL database on a subdomain, over HTTPS. Does this plan include Node.js app hosting (for example "Setup Node.js App" or Passenger), MySQL, and SSL for a subdomain? Can I upload my own files and run `npm install` from the control panel?

Do not buy until they say yes to Node.js 20 or newer. A host that says "Node.js is not supported on shared hosting" is not suitable.

Your existing website can stay exactly where it is. Only {{HOST}} will point to the new host.

---

## Part B: Point {{HOST}} to the new host

1. On the **new** host, find the server's **IP address** (cPanel shows "Shared IP Address" in the right-hand sidebar; it is also in the welcome email).
2. Open the place that manages DNS for `wpart.co.in`. This is your current host's cPanel (**Zone Editor**) or your domain registrar's DNS page.
3. Add a record: **Type A**, **Name** `{{HOST}}` (or just the first part, for example `hr`), **Value** the new IP address. Save.
4. On the new host, add the domain: cPanel → **Domains** (or **Subdomains**) → create `{{HOST}}`. Leave its folder empty.
5. Wait for DNS to update (often under an hour, sometimes a few hours). When `{{HOST}}` opens in a browser, even as an empty page or an error, DNS is ready.
6. Make sure SSL is on: cPanel → **SSL/TLS Status** → select `{{HOST}}` → **Run AutoSSL**. The address must open with https and no warning before you continue.

---

## Part C: Upload and create the Node.js app

1. In **File Manager**, make a folder next to `public_html`, for example `hr-app` (so it is `/home/YOURUSER/hr-app`). Keep it **outside** `public_html`, so nobody can open the program files in a browser.
2. Upload `workpilot-hr-live.zip` into `hr-app` and **Extract**. You should see `hr-app/server`, `hr-app/client/dist` and `hr-app/database`. Then delete the zip from the server.
3. cPanel → **Setup Node.js App** → **Create Application**:
   - **Node.js version:** 20 or newer
   - **Application mode:** Production
   - **Application root:** `hr-app/server`
   - **Application URL:** {{APPURL}}
   - **Application startup file:** `app.cjs`
4. Click **Create**, then **Run NPM Install** and wait for it to finish (a minute or two).

---

## Part D: The database

1. cPanel → **MySQL Databases**:
   - Create a database (cPanel adds your account name in front, for example `abc123_hr`).
   - Create a user with a strong password.
   - Under **Add User To Database**, add that user to that database and tick **ALL PRIVILEGES**. This step is often forgotten, and without it the site cannot connect.
   - Write down the full database name, user and password exactly as shown.
2. Create the tables. Use **one** of these ways:

   **Way 1, the setup script:** on the **Setup Node.js App** page, open your app, use **Run JS script**, choose **setup** and click **Run**. It creates all tables, the roles and permissions and your first admin account. Do this after Part E, because it needs the database details from the `.env` file. (With terminal access: `cd ~/hr-app/server && npm run setup`.)

   **Way 2, import the ready-made file:** cPanel → **phpMyAdmin**, click your (empty) database, choose **Import**, select `database/hr-live-install.sql` from this bundle and click **Import**. It also adds Indian holidays for 2027 to 2029. Import it **once, into an empty database**. If you use Way 2, skip Way 1.

Never import an export of your own test database from your computer: it is out of date and it would put your local test login on the live site.

---

## Part E: Settings

1. In `hr-app/server`, rename `env-template.txt` to `.env`. In File Manager turn on **Show Hidden Files** (Settings) to see it.
2. Edit it and change:
   - `DB_NAME=` your database name
   - `DB_USER=` your database user
   - `DB_PASSWORD=` your database password. If it contains `#` or a space, put the whole password in double quotes, for example `DB_PASSWORD="ab#cd"`.
   - `JWT_SECRET=` replace the value with a new random string of 40 or more letters and numbers. Do this before anyone signs in.
3. Everything else is already set, including {{BASEPATH}}, `CLIENT_ORIGIN={{SITE}}` and `FORCE_HTTPS=true`.
4. Right-click `.env` → **Change Permissions** → `600`.

---

## Part F: Start it

1. Go back to **Setup Node.js App** and click **Restart**.
2. Open **{{SITE}}api/v1/health**. You should see `{"ok":true}`.
3. Open **{{SITE}}** and sign in as **{{ADMIN}}** with the first-admin password on the `SEED_ADMIN_PASSWORD` line of your `.env` (the same password is stored in the database file).

---

## Part G: After you sign in

1. Top-right menu → **Change password**.
2. **Org settings → Company**: upload your logo and fill in the company details (they appear on payslips).
3. **Org settings**: add departments, designations, shifts, leave types and holidays.
4. **Users & access** and **Employees**: add your people.
5. Delete the `database` folder from `hr-app`.

The documentation is built into the site at **{{SITE}}documentation**.

---

## VPS option (for people comfortable with a Linux terminal)

On Ubuntu 22.04 or newer, as root. This assumes `{{HOST}}` already points to the server's IP (Part B, step 3).

```
apt update && apt install -y nginx mariadb-server unzip certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs
mysql -e "CREATE DATABASE workpilot CHARACTER SET utf8mb4; CREATE USER 'workpilot'@'localhost' IDENTIFIED BY 'CHOOSE_A_STRONG_PASSWORD'; GRANT ALL ON workpilot.* TO 'workpilot'@'localhost';"
mkdir -p /srv/workpilot && cd /srv/workpilot && unzip /path/to/workpilot-hr-live.zip
mysql workpilot < database/hr-live-install.sql
cd server && npm install --omit=dev && mv env-template.txt .env     # then edit the DB_ lines and JWT_SECRET
```

Run it as a service: create `/etc/systemd/system/workpilot.service` containing

```
[Unit]
Description=WorkPilot
After=network.target mariadb.service
[Service]
WorkingDirectory=/srv/workpilot/server
ExecStart=/usr/bin/node app.cjs
Restart=always
User=www-data
[Install]
WantedBy=multi-user.target
```

then `chown -R www-data /srv/workpilot && systemctl enable --now workpilot`. For nginx, a site file with:

```
server { server_name {{HOST}}; client_max_body_size 12m;
  location / { proxy_pass http://127.0.0.1:4000; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; proxy_set_header X-Forwarded-For $remote_addr; } }
```

then `certbot --nginx -d {{HOST}}`.

---

## Keep safe

- **Back up daily:** the database (cPanel → Backup, or phpMyAdmin → Export) **and** the folder `server/uploads/` (employee documents, company logo and chat files).
- Never share the `.env` file.
- Employee documents are never public: they are only downloaded through the signed-in site.

## If something goes wrong

| What you see | What to do |
|---|---|
| **503 / "App is not running"** | Open the app in **Setup Node.js App**, check the Node version is 20+, click **Restart**, and read `stderr.log` in `hr-app/server`. |
| Log says **"Cannot find package"** | Click **Run NPM Install**, then **Restart**. |
| Log says **"Set a strong JWT_SECRET"** | The `.env` file is missing or misnamed. It must be called exactly `.env` inside `hr-app/server`. |
| Log says **"Access denied for user"** or **"Unknown database"** | `DB_NAME`, `DB_USER` or `DB_PASSWORD` is wrong, or the user was not added to the database with **All privileges** (Part D). |
| The browser warns the site is **not secure** | SSL is not ready yet. Run AutoSSL (Part B, step 6) and wait. |
| The address does not open at all | DNS has not updated yet (Part B). Wait, and check the A record points to the new server. |
| **Blank page**, or the page loads without styling | The files must be exactly in `hr-app/client/dist`, and the Application URL must be {{APPURL}}. Restart the app. |
| Sign-in works, then you are logged out on refresh | Open the site over **https** and make sure `FORCE_HTTPS=true` is in `.env`. |
| Import says **"Table ... already exists"** | The database is not empty. Empty it in phpMyAdmin (select all tables, then Drop) and import again, or skip the import. |

## Updating later

Upload the new bundle, extract it over the old one, keep your existing `.env` and `uploads` folder, click **Run NPM Install** if the notes say libraries changed, run **setup** once, and **Restart**.
