// Builds the SD card contents from model/: the scans and a README.txt with their placements.
// Usage: npm run sd-card

import { join } from 'path';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { MODEL_DIR, readTables } from '../scripts/tables';

const OUT = join(import.meta.dirname, 'sd-card');

/** Ellipsoid height (m) of the meadow. Must match GROUND in website/src/scene/deck-world.ts. */
const GROUND = 16.5;
const SCAN_DATE = 'February 13, 2026';

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const tables = readTables().map((t) => {
  copyFileSync(join(MODEL_DIR, t.file), join(OUT, t.file));
  return {
    num: t.num,
    file: t.file,
    longitude: t.longitude ?? 0,
    latitude: t.latitude ?? 0,
    altitude: t.altitude,
    rotation: [t.rotation_x, t.rotation_y, t.rotation_z],
    scale: [t.scale_x, t.scale_y, t.scale_z],
  };
});

const n = (v: number, d: number) => v.toFixed(d);
const scale = (s: number[]) => (s.every((v) => v === s[0]) ? String(s[0]) : s.join(','));
const pad = (cells: string[], widths: number[]) =>
  cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
const header = ['Table', 'File', 'Latitude', 'Longitude', 'Altitude', 'Pitch', 'Yaw', 'Roll', 'Scale'];
const body = tables.map((t) => [
  t.num,
  t.file,
  n(t.latitude, 7),
  n(t.longitude, 7),
  n(t.altitude, 2),
  ...t.rotation.map((v) => n(v, 1)),
  scale(t.scale),
]);
const widths = header.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)));
const table = [header, widths.map((w) => '-'.repeat(w)), ...body].map((r) => pad(r, widths)).join('\n');

writeFileSync(
  join(OUT, 'README.txt'),
  `Golden Gate Park Picnic Tables
Yufeng Zhao
https://ggp-picnic-tables.yufeng.place

${tables.length} picnic table scans (.glb, meters, +Y up), scanned ${SCAN_DATE}.

${table}

Latitude, Longitude: WGS84 degrees
Altitude: meters above ${GROUND} m ellipsoidal height
Pitch, Yaw, Roll: degrees
Scale: uniform scale factor
`.replace(/\n/g, '\r\n'),
);

console.log(`sd-card/: ${tables.length} models`);
