# Deploying WorkPilot

The Node server serves both the API and the built web app, so you run **one** process.

## What the server needs
- Node.js 20 or newer
- MySQL 8 / MariaDB 10.4+ (XAMPP's MySQL works)

## Steps

1. **Upload and unzip** the project, e.g. to `C:\apps\workpilot` (keep the `server` and `client` folders side by side; the server looks for `../client/dist`).
2. **Start MySQL** (XAMPP Control Panel → MySQL → Start).
3. **Configure:** in `server`, copy `.env.example` to `.env` and fill in:
   - `JWT_SECRET` — a long random string
   - `DB_*` — your MySQL details
   - `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` — your first admin login
   - `CLIENT_ORIGIN` — the address people will use
4. **Install and create the database** (in `server`):
   ```
   npm install --omit=dev
   npm run setup:mysql
   ```
   Optional sample data for a trial: `npm run demo` (do not load on a real system).
5. **Run:**
   ```
   npm start
   ```
   Open `http://SERVER-ADDRESS:4000`. The built web app is already included in `client/dist`; you only need to rebuild it (`cd client && npm install && npm run build`) if you change the client source.
6. **Keep it running** with a process manager so it restarts after reboots, e.g. `npm i -g pm2` then `pm2 start src/index.js --name workpilot` (run inside `server`) and `pm2 save`. On Windows consider `pm2-windows-startup` or NSSM.

## Putting it behind Apache (XAMPP) with HTTPS
Run the Node app on port 4000 and proxy to it. Enable `mod_proxy` and `mod_proxy_http`, then in your virtual host:
```
ProxyPreserveHost On
ProxyPass / http://127.0.0.1:4000/
ProxyPassReverse / http://127.0.0.1:4000/
```
Once the site is on HTTPS, set `FORCE_HTTPS=true` and `NODE_ENV=production` in `.env` and restart.

## Back up
- The MySQL database (`mysqldump hrms > hrms.sql`) daily
- `server/uploads/` (employee documents)

## After first login
Change the admin password (top-right menu → Change password). Create real users under **Users & access** and configure departments, shifts, leave types and holidays under **Org settings**.

## Important: payroll
PF, ESI, TDS and professional tax are not calculated automatically. Deductions are fixed monthly amounts entered per employee. Have a payroll professional validate this before using it for real salaries.

## Putting it in a sub-folder of a live site (for example https://wpart.co.in/hr/)
Run `node deploy/make-bundle.mjs --base=/hr/ --site=https://wpart.co.in` from the project folder. It builds the web app for that folder and writes `deploy/workpilot-hr-live.zip`, which contains the app, a `.env` template with fresh secrets, and step-by-step instructions (`READ-ME-FIRST.md`). The server reads `BASE_PATH=/hr` from `.env` and works whether the web server passes the `/hr` prefix through or strips it.

## Hosting without Node.js (ordinary PHP + MySQL hosting, e.g. cPanel)
WorkPilot also ships a PHP version of the server (`php/`), which needs no Node.js on the host. Build the upload package with `node deploy/make-php-bundle.mjs` (own subdomain) or `node deploy/make-php-bundle.mjs --base=/hr/ --site=https://example.com` (folder). It writes `deploy/php-subdomain` or `deploy/php-folder` containing `website-files.zip`, `hr-live-install.sql` and `READ-ME-FIRST.md`, which has the step-by-step instructions. See section 9.3 of DOCUMENTATION.md.
