import { ZodError } from 'zod';
import { alertError } from '../services/alerts.js';

export function notFound(_req, res) {
  res.status(404).json({ error: 'Not found' });
}

export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Validation failed', details: err.issues });
  }
  if (err.name === 'MulterError') return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 5 MB' : err.message });
  if (err.code === 'ER_DUP_ENTRY' || err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Already exists' });
  const status = err.status || 500;
  if (status === 500) { console.error(err); alertError(err, req); }
  res.status(status).json({ error: status === 500 ? 'Server error' : err.message, ...(['PASSWORD_CHANGE_REQUIRED', 'TWO_FACTOR_SETUP_REQUIRED'].includes(err.code) ? { code: err.code } : {}) });
}
