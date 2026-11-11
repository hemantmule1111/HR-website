// Builds the upload bundle for a live server.
//   node deploy/make-bundle.mjs                                   -> site at https://hr.wpart.co.in/  (own subdomain)
//   node deploy/make-bundle.mjs --base=/hr/ --site=https://wpart.co.in   -> site in a folder: https://wpart.co.in/hr/
//   Optional: --admin-email=admin@wpart.co.in
// Output: deploy/workpilot-hr-live.zip  (the folder deploy/stage/ is the same content, unzipped)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3) || d;
const baseIn = arg('base', '/').replace(/^\/+|\/+$/g, '');
const BASE = baseIn ? `/${baseIn}/` : '/'; // "/" (own subdomain) or "/hr/" (folder)
const SITE = arg('site', 'https://hr.wpart.co.in').replace(/\/+$/, '');
const BASE_PATH = BASE === '/' ? '' : BASE.slice(0, -1); // "" or "/hr"
const stage = path.join(root, 'deploy', 'stage');
const zip = path.join(root, 'deploy', 'workpilot-hr-live.zip');

fs.rmSync(stage, { recursive: true, force: true });
fs.rmSync(zip, { force: true });
fs.mkdirSync(path.join(stage, 'server'), { recursive: true });

// 1) Web app, built for the sub-folder
console.log(`Building the web app for ${SITE}${BASE} ...`);
const vite = path.join(root, 'client', 'node_modules', 'vite', 'bin', 'vite.js');
execFileSync(process.execPath, [vite, 'build', '--outDir', path.join(stage, 'client', 'dist'), '--emptyOutDir'], {
  cwd: path.join(root, 'client'), env: { ...process.env, VITE_BASE: BASE }, stdio: 'inherit',
});
execFileSync(process.execPath, [path.join(root, 'client', 'scripts', 'build-docs.mjs'), `--base=${BASE}`, `--out=${path.join(stage, 'client', 'dist', 'documentation', 'index.html')}`], { stdio: 'inherit' });

// 2) Server (no node_modules, no .env, no local database, no uploads)
for (const item of ['src', 'scripts', 'knexfile.js', 'package.json', 'package-lock.json']) {
  fs.cpSync(path.join(root, 'server', item), path.join(stage, 'server', item), { recursive: true, filter: (p) => !p.includes('node_modules') });
}
fs.rmSync(path.join(stage, 'server', 'scripts', 'smoke.js'), { force: true });
fs.rmSync(path.join(stage, 'server', 'src', 'db', 'demo.js'), { force: true }); // sample data is for trials only

// 3) Start-up file: a plain CommonJS wrapper, which every Node host (including cPanel) can start
fs.writeFileSync(path.join(stage, 'server', 'app.cjs'), `// Start-up file for the host. Set this as the "Application startup file".
import('./src/index.js').catch((err) => {
  console.error('WorkPilot failed to start:', err);
  process.exit(1);
});
`);

// 4) Settings template (fresh secrets every time the bundle is made)
const jwt = crypto.randomBytes(48).toString('hex');
// Letters, digits, "-" and "_" only: characters like # or $ are cut off or changed when a .env file is read.
const adminPassword = `${crypto.randomBytes(9).toString("base64url")}-Z7`;
const host = new URL(SITE).hostname;
const adminEmail = arg('admin-email', `admin@${host}`);
fs.writeFileSync(path.join(stage, 'server', 'env-template.txt'), `# Rename this file to  .env  (a dot, then "env") inside the server folder, then fill in the three DB_ lines.
# Never share this file.

NODE_ENV=production
PORT=4000

# Where people open the site
CLIENT_ORIGIN=${SITE}
BASE_PATH=${BASE_PATH}
FORCE_HTTPS=true

# --- MySQL: the database you created in cPanel (names are usually prefixed with your account name) ---
DB_CLIENT=mysql2
DB_HOST=localhost
DB_PORT=3306
DB_NAME=PUT_DATABASE_NAME_HERE
DB_USER=PUT_DATABASE_USER_HERE
DB_PASSWORD=PUT_DATABASE_PASSWORD_HERE

# Already generated for you. Do not change it after people start signing in.
JWT_SECRET=${jwt}

COMPANY_TZ=Asia/Kolkata

# First Super Admin, created when you run the "setup" step. Change the password after your first sign-in.
SEED_ADMIN_EMAIL=${adminEmail}
SEED_ADMIN_PASSWORD="${adminPassword}"

# Optional: email notifications
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
MAIL_FROM=hr@${host}
`);

// 4b) The same database as a ready-made SQL file, for hosts where you cannot run the setup script
execFileSync(process.execPath, [path.join(root, 'deploy', 'make-install-sql.mjs'), `--email=${adminEmail}`, `--password=${adminPassword}`, `--platform-email=${arg('platform-email', `owner@${host}`)}`, `--platform-password=${arg('platform-password', `${adminPassword}-P`)}`], { stdio: 'inherit' });
fs.mkdirSync(path.join(stage, 'database'), { recursive: true });
fs.copyFileSync(path.join(root, 'deploy', 'hr-live-install.sql'), path.join(stage, 'database', 'hr-live-install.sql'));

// 5) Instructions
fs.writeFileSync(path.join(stage, 'READ-ME-FIRST.md'), fs.readFileSync(path.join(root, 'deploy', 'LIVE-SERVER-GUIDE.md'), 'utf8').split('{{SITE}}').join(`${SITE}${BASE}`).split('{{HOST}}').join(host).split('{{ADMIN}}').join(adminEmail)
  .split('{{APPURL}}').join(BASE_PATH ? `\`${host}\` and put \`${BASE_PATH.slice(1)}\` in the path box` : `\`${host}\` (leave the path box empty)`)
  .split('{{BASEPATH}}').join(BASE_PATH ? `BASE_PATH=${BASE_PATH}` : 'BASE_PATH (left empty)'));

// 6) Zip (tar ships with Windows 10+ and writes a zip that Linux servers open normally)
const winTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
execFileSync(fs.existsSync(winTar) ? winTar : 'tar', ['-a', '-c', '-f', zip, '-C', stage, '.']);
const kb = Math.round(fs.statSync(zip).size / 1024);
console.log(`\nBundle ready: ${path.relative(root, zip)} (${kb} KB)`);
console.log(`Admin sign-in after setup: ${adminEmail}  /  ${adminPassword}`);
