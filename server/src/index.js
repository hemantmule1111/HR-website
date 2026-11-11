import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import routes from './routes/index.js';
import { notFound, errorHandler } from './middleware/error.js';
import { stripBasePath } from './utils/basePath.js';
import { startScheduler } from './services/scheduler.js';

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.startsWith('change-me') || process.env.JWT_SECRET.startsWith('dev-only')) {
  if (process.env.NODE_ENV === 'production') throw new Error('Set a strong JWT_SECRET in .env');
  console.warn('WARNING: using a placeholder JWT_SECRET; set a real one in .env');
}

const app = express();
app.set('trust proxy', 1);
app.use(stripBasePath);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        frameSrc: ["'self'", 'blob:'],
        // Only enforce https upgrade when actually served over https (plain-http intranet installs would break otherwise).
        upgradeInsecureRequests: process.env.FORCE_HTTPS === 'true' ? [] : null,
      },
    },
  }),
);
app.use(cors({ origin: process.env.CLIENT_ORIGIN || false, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/api/v1/health', (_req, res) => res.json({ ok: true }));
// API answers are never stored by a browser or a proxy.
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use('/api/v1', routes);
app.use('/api', notFound);

// Serve the built web app (client/dist) from the same origin when it exists.
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');

// The documentation is a plain HTML page at /documentation (its script and styles live under /documentation/).
// Use the built copy when there is one, otherwise the source copy, so it works before the first build too.
const docPages = [path.join(dist, 'documentation', 'index.html'), path.resolve(dist, '../public/documentation/index.html')];
app.get(['/documentation', '/documentation/'], (_req, res, next) => {
  const page = docPages.find((p) => fs.existsSync(p));
  return page ? res.sendFile(page) : next();
});
app.use('/documentation', express.static(path.dirname(docPages[1]), { index: false, maxAge: '1h' }));

if (fs.existsSync(path.join(dist, 'index.html'))) {
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use(notFound);
app.use(errorHandler);

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`HRMS listening on :${port}`));
startScheduler();
