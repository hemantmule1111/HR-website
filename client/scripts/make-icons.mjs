// Draws the app icons (public/icon-192.png, icon-512.png, icon-maskable-512.png) with no image library:  node scripts/make-icons.mjs
import fs from 'node:fs'
import zlib from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public')
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (type, data) => { const t = Buffer.from(type); const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([l, t, data, c]) }

const distSeg = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))); return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) }
const W = [[0.24, 0.3], [0.37, 0.7], [0.5, 0.42], [0.63, 0.7], [0.76, 0.3]] // the letter W, in unit coordinates

function icon(size, { rounded = true, scale = 1 } = {}) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size, v = (y + 0.5) / size
      const cu = (u - 0.5) / scale + 0.5, cv = (v - 0.5) / scale + 0.5
      let d = 9
      for (let i = 0; i < W.length - 1; i++) d = Math.min(d, distSeg(cu, cv, ...W[i], ...W[i + 1]))
      const ink = Math.max(0, Math.min(1, (0.055 - d) * size * scale)) // soft edge
      const r = 0.18, q = Math.max(Math.abs(u - 0.5) - (0.5 - r), Math.abs(v - 0.5) - (0.5 - r))
      const inside = !rounded || Math.hypot(Math.max(Math.abs(u - 0.5) - (0.5 - r), 0), Math.max(Math.abs(v - 0.5) - (0.5 - r), 0)) <= r || q <= 0
      const g = (u + v) / 2 // a gentle diagonal gradient from indigo to violet
      const bg = [79 + 40 * g, 70 - 10 * g, 229 + 10 * g]
      const o = y * (size * 4 + 1) + 1 + x * 4
      raw[o] = bg[0] * (1 - ink) + 255 * ink; raw[o + 1] = bg[1] * (1 - ink) + 255 * ink; raw[o + 2] = bg[2] * (1 - ink) + 255 * ink; raw[o + 3] = inside ? 255 : 0
    }
  }
  const head = Buffer.alloc(13); head.writeUInt32BE(size, 0); head.writeUInt32BE(size, 4); head[8] = 8; head[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
fs.writeFileSync(path.join(out, 'icon-192.png'), icon(192))
fs.writeFileSync(path.join(out, 'icon-512.png'), icon(512))
fs.writeFileSync(path.join(out, 'icon-maskable-512.png'), icon(512, { rounded: false, scale: 0.72 })) // full-bleed with the letter inside the safe area
console.log('icons written to', out)
