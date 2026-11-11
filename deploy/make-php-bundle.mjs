// Builds the upload package for ordinary PHP + MySQL hosting (cPanel). No Node.js is needed on the server.
//   node deploy/make-php-bundle.mjs                                            -> own subdomain: https://hr.wpart.co.in/
//   node deploy/make-php-bundle.mjs --base=/hr/ --site=https://wpart.co.in    -> folder:        https://wpart.co.in/hr/
//   Optional: --admin-email=admin@wpart.co.in   --db-name=...  --db-user=...  --db-password=...  (fills in app/config.php for you)   --admin-password=... (instead of a random one)
// Output folder (deploy/php-subdomain or deploy/php-folder) holds exactly three files:
//   website-files-for-<address>.zip -> the ONLY thing you upload to the website folder
//   hr-live-install.sql -> import in phpMyAdmin
//   READ-ME-FIRST.md    -> step-by-step guide
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3) || d;
const baseIn = arg('base', '/').replace(/^\/+|\/+$/g, '');
const BASE = baseIn ? `/${baseIn}/` : '/';
const SITE = arg('site', 'https://hr.wpart.co.in').replace(/\/+$/, '');
const host = new URL(SITE).hostname;
const adminEmail = arg('admin-email', `admin@${host}`);
const isFolder = BASE !== '/';
const dbName = arg('db-name', ''), dbUser = arg('db-user', ''), dbPassword = arg('db-password', '');
const dbFilled = Boolean(dbName && dbUser && dbPassword);
const php = (v) => v.replace(/\\/g, '\\\\').replace(/'/g, "\\'"); // safe inside a PHP single-quoted string
// The zip is named after the address it is for, so the subdomain and folder packages can never be mixed up.
const zipName = isFolder ? `website-files-for-${host}${BASE.replace(/\//g, '-').slice(0, -1)}-folder.zip` : `website-files-for-${host}.zip`;
const outDir = path.join(root, 'deploy', isFolder ? 'php-folder' : 'php-subdomain');
const stage = path.join(root, 'deploy', 'stage-php');
const web = path.join(stage, 'website-files');

// Helper files kept next to the package (demo data, admin reset) survive a rebuild.
const keepNames = ['demo-data.sql', 'remove-demo-data.sql', 'reset-admin-password.sql'];
const kept = keepNames.filter((n) => fs.existsSync(path.join(outDir, n))).map((n) => [n, fs.readFileSync(path.join(outDir, n))]);
fs.rmSync(stage, { recursive: true, force: true });
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(web, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

// 1) The web app, built for this address
console.log(`Building the web app for ${SITE}${BASE} ...`);
const vite = path.join(root, 'client', 'node_modules', 'vite', 'bin', 'vite.js');
execFileSync(process.execPath, [vite, 'build', '--outDir', web, '--emptyOutDir'], { cwd: path.join(root, 'client'), env: { ...process.env, VITE_BASE: BASE }, stdio: 'inherit' });
execFileSync(process.execPath, [path.join(root, 'client', 'scripts', 'build-docs.mjs'), `--base=${BASE}`, `--out=${path.join(web, 'documentation', 'index.html')}`], { stdio: 'inherit' });

// 2) The PHP server code, web-server rules and the setup-check page
fs.cpSync(path.join(root, 'php', 'site'), web, { recursive: true, filter: (p) => !/config\.php$/.test(p) });
fs.rmSync(path.join(web, 'app', 'config.sample.php'), { force: true });

// 3) Settings file, ready to edit (a fresh signing secret every time)
const secret = crypto.randomBytes(48).toString('hex');
fs.writeFileSync(path.join(web, 'app', 'config.php'), `<?php
// WorkPilot settings. ${dbFilled ? 'Your database details are already filled in.' : 'Fill in the three database lines, save,'} Keep this file private.
return [
    // The database you created in cPanel (MySQL Databases). On cPanel the names usually start with your account name.
    'db_driver' => 'mysql',
    'db_host' => 'localhost',
    'db_port' => 3306,
    'db_name' => '${dbFilled ? php(dbName) : 'PUT_DATABASE_NAME_HERE'}',
    'db_user' => '${dbFilled ? php(dbUser) : 'PUT_DATABASE_USER_HERE'}',
    'db_password' => '${dbFilled ? php(dbPassword) : 'PUT_DATABASE_PASSWORD_HERE'}',

    // Already generated for you. Do not change it after people start signing in.
    'jwt_secret' => '${secret}',

    'company_tz' => 'Asia/Kolkata',

    // Where uploaded files (documents, logo, chat files) are kept. Leave empty to use app/storage/uploads.
    'upload_dir' => '',

    // Email (welcome emails, password reset, leave / payslip / subscription notices). Optional: with nothing here the host's own mail() is used,
    // which works on most cPanel hosts. For the most reliable delivery, create a mailbox in cPanel (Email Accounts), e.g. noreply@yourdomain.com,
    // and use SMTP. Then sign in at /platform and press "Test email".
    // 'mail' => [
    //     'transport' => 'smtp',                    // smtp | php | log (log writes to app/storage/mail.log instead of sending)
    //     'host' => 'mail.yourdomain.com', 'port' => 587, 'secure' => 'tls',   // tls = port 587, ssl = port 465
    //     'user' => 'noreply@yourdomain.com', 'pass' => 'the mailbox password',
    //     'from' => 'noreply@yourdomain.com', 'from_name' => 'WorkPilot',
    // ],
    // The address people open from email links (worked out automatically when empty):
    // 'app_url' => 'https://hr.wpart.co.in/',

    // Automatic daily database backup (saved in app/storage/backups, newest 14 kept; the platform owner downloads them at /platform -> Backups).
    // It runs by itself about once a day. A cPanel cron job is more reliable (see the guide). To switch the automatic one off: 'backup' => ['auto' => false],

    // Set to true only while fixing a problem: it shows the real error message in the response.
    'debug' => false,
];
`);

// 4) The database as one SQL file, with the first admin login
const adminPassword = arg('admin-password', `${crypto.randomBytes(9).toString('base64url')}-Z7`); // letters, digits, - and _ only
const platformEmail = arg('platform-email', `owner@${host}`);
const platformPassword = arg('platform-password', `${crypto.randomBytes(9).toString('base64url')}-P4`);
execFileSync(process.execPath, [path.join(root, 'deploy', 'make-install-sql.mjs'), `--email=${adminEmail}`, `--password=${adminPassword}`, `--platform-email=${platformEmail}`, `--platform-password=${platformPassword}`], { stdio: 'inherit' });
fs.copyFileSync(path.join(root, 'deploy', 'hr-live-install.sql'), path.join(outDir, 'hr-live-install.sql'));
// For a site that is already running: adds only the platform tables, leaving every existing table untouched.
fs.copyFileSync(path.join(root, 'deploy', 'hr-live-upgrade-multicompany.sql'), path.join(outDir, 'hr-live-upgrade-multicompany.sql'));

// 5) Guide
const guide = fs.readFileSync(path.join(root, 'deploy', 'LIVE-SERVER-GUIDE-PHP.md'), 'utf8')
  .replace(/\{\{IF_DBFILLED\}\}([\s\S]*?)\{\{\/IF\}\}/g, (_, t) => (dbFilled ? t : ''))
  .replace(/\{\{IF_DBEMPTY\}\}([\s\S]*?)\{\{\/IF\}\}/g, (_, t) => (dbFilled ? '' : t))
  .replace(/\{\{IF_SUBDOMAIN\}\}([\s\S]*?)\{\{\/IF\}\}/g, (_, t) => (isFolder ? '' : t))
  .replace(/\{\{IF_FOLDER\}\}([\s\S]*?)\{\{\/IF\}\}/g, (_, t) => (isFolder ? t : ''))
  .split('{{ZIP}}').join(zipName).split('{{SITE}}').join(`${SITE}${BASE}`).split('{{HOST}}').join(host).split('{{ADMIN}}').join(adminEmail).split('{{PASSWORD}}').join(adminPassword).split('{{PLATFORM_EMAIL}}').join(platformEmail).split('{{PLATFORM_PASSWORD}}').join(platformPassword)
  .split('{{DOCROOT}}').join(isFolder ? '`public_html/hr`' : 'the folder cPanel shows for the subdomain (often `public_html/hr` or `hr.wpart.co.in`)');
fs.writeFileSync(path.join(outDir, 'READ-ME-FIRST.md'), guide);

// 6) Zip the website files with the files at the top level (so extracting in the website folder just works)
const winTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
execFileSync(fs.existsSync(winTar) ? winTar : 'tar', ['-a', '-c', '-f', path.join(outDir, zipName), '-C', web, '.']);
fs.rmSync(stage, { recursive: true, force: true });
for (const [n, buf] of kept) fs.writeFileSync(path.join(outDir, n), buf);

const kb = Math.round(fs.statSync(path.join(outDir, zipName)).size / 1024);
console.log(`\nReady: ${path.relative(root, outDir)}/  (${zipName} ${kb} KB, hr-live-install.sql, READ-ME-FIRST.md)`);
console.log(`First admin login after the SQL import: ${adminEmail}  /  ${adminPassword}  (company code: default)`);
console.log(`Platform owner login (open /platform): ${platformEmail}  /  ${platformPassword}`);
