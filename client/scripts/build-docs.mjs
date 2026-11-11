// Turns ../DOCUMENTATION.md into client/public/documentation/index.html (served at /documentation).
// The page is plain, pre-rendered HTML plus one small same-origin script (docs.js), so it works under the
// server's content-security policy, which blocks inline scripts and scripts from other sites.
// Run: npm run docs   (also runs automatically before `npm run build`)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
// Options: --base=/hr/ (folder the site is served from; default /)  --out=<file> (default client/public/documentation/index.html)
const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').slice(name.length + 3);
const base = (arg('base') || process.env.VITE_BASE || '/').replace(/\/?$/, '/');
const out = arg('out') ? path.resolve(arg('out')) : path.resolve(here, '../public/documentation/index.html');

const md = fs.readFileSync(path.join(root, 'DOCUMENTATION.md'), 'utf8');
const cut = md.indexOf('\n---\n');
const updated = (md.match(/Last updated:\s*([^*\n]+?)\.?\*/) || [])[1] || new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

marked.setOptions({ gfm: true, headerIds: true, mangle: false });
let html = marked.parse(cut > -1 ? md.slice(cut + 5) : md);

// Tables scroll inside their own box on narrow screens.
html = html.replace(/<table>[\s\S]*?<\/table>/g, (t) => `<div class="table-scroll">${t}</div>`);
// Keep in-page and web links. Files in the project folder have no address on the site, so show them as names.
html = html.replace(/<a href="([^"]*)">([\s\S]*?)<\/a>/g, (m, href, text) => {
  if (href.startsWith('#')) return m;
  if (/^https?:/.test(href)) return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  return `<code>${text}</code>`;
});
// Block quotes become call-outs; "Important" ones get the warning tint.
html = html.replace(/<blockquote>\n?([\s\S]*?)<\/blockquote>/g, (m, inner) => `<div class="callout${/^\s*<p><strong>(important|warning)/i.test(inner) ? ' warn' : ''}">${inner}</div>`);

// Index and role shortcuts, built from the headings.
const heads = [...html.matchAll(/<h([23]) id="([^"]+)">([\s\S]*?)<\/h\1>/g)].map((m) => ({ level: Number(m[1]), id: m[2], text: m[3] }));
let toc = '';
let inSection = false;
for (const h of heads) {
  if (h.level === 2) {
    if (inSection) toc += '</ul></li>';
    toc += `<li class="h2"><a href="#${h.id}">${h.text}</a><ul class="kids">`;
    inSection = true;
  } else {
    toc += `<li><a href="#${h.id}">${h.text}</a></li>`;
  }
}
if (inSection) toc += '</ul></li>';

const roleMap = [['Employee', '3.'], ['Manager', '4.'], ['HR and admin', '5.'], ['Payroll', '6.'], ['IT and setup', '9.']];
const roles = roleMap
  .map(([label, prefix]) => ({ label, h: heads.find((h) => h.level === 2 && h.text.startsWith(prefix)) }))
  .filter((r) => r.h)
  .map((r) => `<a href="#${r.h.id}">${r.label}</a>`)
  .join('');

const tpl = fs.readFileSync(path.join(here, 'docs-template.html'), 'utf8');
const page = tpl.split('{{BASE}}').join(base).replace('{{UPDATED}}', () => updated).replace('{{ROLES}}', () => roles).replace('{{TOC}}', () => toc).replace('{{CONTENT}}', () => html);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log(`documentation built: ${heads.filter((h) => h.level === 2).length} sections, ${Math.round(page.length / 1024)} KB -> ${path.relative(root, out)}`);
