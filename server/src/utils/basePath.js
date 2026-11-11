// The site may live in a sub-folder of its domain (for example https://example.com/hr/ -> BASE_PATH=/hr).
// Empty means the site is at the domain root.
const raw = (process.env.BASE_PATH || '').trim();
export const BASE_PATH = raw && raw !== '/' ? `/${raw.replace(/^\/+|\/+$/g, '')}` : '';

// Works whether the web server forwards the full path (/hr/api/...) or strips the folder first (/api/...).
export function stripBasePath(req, _res, next) {
  if (BASE_PATH && (req.url === BASE_PATH || req.url.startsWith(`${BASE_PATH}/`) || req.url.startsWith(`${BASE_PATH}?`))) {
    req.url = req.url.slice(BASE_PATH.length) || '/';
  }
  next();
}
