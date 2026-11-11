// Upload safety. Nothing a user uploads is trusted: the file's real content decides what it is (not its name or the type the browser
// claims), only plain documents are accepted, and anything that could carry a script or a macro is refused.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HttpError } from './http.js';

export const MIME = {
  png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8',
};
export const IMAGE_EXT = new Set(['png', 'jpg', 'gif', 'webp']);
const LABEL = { png: 'PNG', jpg: 'JPG', gif: 'GIF', webp: 'WebP', pdf: 'PDF', docx: 'Word (.docx)', xlsx: 'Excel (.xlsx)', pptx: 'PowerPoint (.pptx)', txt: 'text (.txt)', csv: 'CSV' };

const startsWith = (b, bytes, at = 0) => bytes.every((v, i) => b[at + i] === v);
const latin = (b) => b.toString('latin1');

// Names inside an Office file (zip) that mean a macro, a program or an embedded object.
const OFFICE_BAD = /vbaProject|activeX|\/embeddings\/|\.(exe|dll|com|scr|bat|cmd|ps1|vbs|js|jse|wsf|hta|jar|lnk|php|phtml|html?|sh)\b/i;
// Script or code markers that never belong in a picture, a PDF or a text file.
const CODE_MARKER = /<\?php|<\?=|<script|<%@|<%=|<iframe|<object|<embed|<svg|<!doctype html|<html/i;
const PDF_ACTIVE = /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA|SubmitForm|ImportData)(?![A-Za-z0-9])/;

function detect(buf, ext) {
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'jpg';
  if (latin(buf.subarray(0, 6)) === 'GIF87a' || latin(buf.subarray(0, 6)) === 'GIF89a') return 'gif';
  if (latin(buf.subarray(0, 4)) === 'RIFF' && latin(buf.subarray(8, 12)) === 'WEBP') return 'webp';
  if (latin(buf.subarray(0, 5)) === '%PDF-') return 'pdf';
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) {
    const s = latin(buf);
    if (!s.includes('[Content_Types].xml')) return null;
    if (s.includes('word/')) return 'docx';
    if (s.includes('xl/')) return 'xlsx';
    if (s.includes('ppt/')) return 'pptx';
    return null;
  }
  // Plain text: no binary bytes and valid UTF-8, and the name says txt or csv.
  if (ext === 'txt' || ext === 'csv') {
    for (const c of buf) if (c === 0 || (c < 9) || (c > 13 && c < 32 && c !== 27)) return null;
    try { new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return null; }
    return ext;
  }
  return null;
}

// Returns { ext, mime } for a file on disk, or throws a friendly error.
export function inspectFile(filePath, originalName, allowed) {
  const ext = path.extname(originalName || '').slice(1).toLowerCase().replace('jpeg', 'jpg');
  const buf = fs.readFileSync(filePath);
  const kind = detect(buf, ext);
  const nice = allowed.map((k) => LABEL[k]).join(', ');
  if (!kind || !allowed.includes(kind)) throw new HttpError(400, `This file is not allowed. Only these documents can be uploaded: ${nice}.`);
  const text = latin(buf);
  if (['docx', 'xlsx', 'pptx'].includes(kind)) {
    if (OFFICE_BAD.test(text)) throw new HttpError(400, 'This Office file contains a macro, program or embedded object, so it was refused. Save a plain copy without macros and try again.');
  } else {
    if (CODE_MARKER.test(text)) throw new HttpError(400, 'This file contains script or program code, so it was refused.');
    if (kind === 'pdf' && PDF_ACTIVE.test(text)) throw new HttpError(400, 'This PDF contains scripts or attachments, so it was refused. Print it to a new PDF and try again.');
  }
  return { ext: kind, mime: MIME[kind] };
}

// Express middleware, placed right after multer: checks the saved file, renames it to a safe extension chosen from its real type.
export const guardUpload = (allowed) => (req, _res, next) => {
  if (!req.file) return next();
  try {
    const { ext, mime } = inspectFile(req.file.path, req.file.originalname, allowed);
    const safe = path.join(path.dirname(req.file.path), `${path.basename(req.file.filename, path.extname(req.file.filename))}.${ext}`);
    if (safe !== req.file.path) fs.renameSync(req.file.path, safe);
    req.file.path = safe;
    req.file.filename = path.basename(safe);
    req.file.mimetype = mime.split(';')[0];
    return next();
  } catch (e) {
    fs.rmSync(req.file.path, { force: true });
    return next(e);
  }
};

export const randomName = () => crypto.randomUUID();

// Sends a stored file with headers that stop a browser from running it, whatever it contains.
// The type comes from the extension WE chose when saving, never from the upload or from the original name.
export function sendSafe(res, fullPath, downloadName, { inlineImages = false } = {}) {
  const ext = path.extname(fullPath).slice(1).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const inline = inlineImages && IMAGE_EXT.has(ext);
  const asciiName = String(downloadName || 'file').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  res.set({
    'Content-Type': mime,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, no-store',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(downloadName || 'file')}`,
  });
  res.sendFile(fullPath);
}
