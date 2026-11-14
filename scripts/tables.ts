// The tables: one per model/*.glb, placed by model/tables.json.
// Used by the site build (website/vite-plugin-tables.ts), the editor server, the
// render scripts and small-batch-dataset/.

import { closeSync, openSync, readdirSync, readFileSync, readSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { PicnicTable, UpdateTablePayload } from "../website/src/types";

export const MODEL_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "model");
const PLACEMENTS = join(MODEL_DIR, "tables.json");

interface Placement {
  longitude: number | null;
  latitude: number | null;
  altitude: number;
  rotation: [number, number, number];
  scale: [number, number, number];
  /** Quarter turn about the scan's up axis before rendering (scripts/render-orbits.ts). */
  render_rotation: number;
}

const DEFAULT: Placement = {
  longitude: null,
  latitude: null,
  altitude: 0,
  rotation: [0, 0, 90],
  scale: [1, 1, 1],
  render_rotation: 0,
};

const readPlacements = (): Record<string, Placement> => JSON.parse(readFileSync(PLACEMENTS, "utf8"));

/** "ggp-picnic-table-15-16.glb" -> [15, 16] */
const numbers = (file: string) => file.match(/(\d+(?:-\d+)*)\.glb$/)![1].split("-").map(Number);

export function readTables(): PicnicTable[] {
  const placements = readPlacements();
  return readdirSync(MODEL_DIR)
    .filter((f) => f.endsWith(".glb"))
    .sort((a, b) => numbers(a)[0] - numbers(b)[0])
    .map((file, i) => {
      const p = { ...DEFAULT, ...placements[file] };
      return {
        id: i + 1,
        num: numbers(file).join("&"),
        file,
        slug: file.replace(/\.glb$/, ""),
        longitude: p.longitude,
        latitude: p.latitude,
        altitude: p.altitude,
        rotation_x: p.rotation[0],
        rotation_y: p.rotation[1],
        rotation_z: p.rotation[2],
        scale_x: p.scale[0],
        scale_y: p.scale[1],
        scale_z: p.scale[2],
        render_rotation: p.render_rotation,
        bounds: glbBounds(join(MODEL_DIR, file)),
      };
    });
}

/** Saves the editor's changes to one table into model/tables.json. */
export function updateTable(id: number, data: UpdateTablePayload): PicnicTable | null {
  const t = readTables().find((t) => t.id === id);
  if (!t) return null;
  const next = { ...t, ...data };
  const placements = readPlacements();
  placements[t.file] = {
    longitude: next.longitude,
    latitude: next.latitude,
    altitude: next.altitude,
    rotation: [next.rotation_x, next.rotation_y, next.rotation_z],
    scale: [next.scale_x, next.scale_y, next.scale_z],
    render_rotation: next.render_rotation,
  };
  const sorted = Object.fromEntries(Object.entries(placements).sort(([a], [b]) => numbers(a)[0] - numbers(b)[0]));
  // Keep each array on one line.
  const json = JSON.stringify(sorted, null, 2).replace(/\[\s+([^[\]]*?)\s+\]/g, (_, s) => `[${s.split(/,\s+/).join(", ")}]`);
  writeFileSync(PLACEMENTS, json + "\n");
  return next;
}

/** Model-space bounds of a scan, [min, max], from its glb's POSITION accessors.
 *  The scans have no node transforms, so these are the scan's own bounds. */
function glbBounds(path: string): [number[], number[]] | null {
  try {
    // Read only the glb's JSON chunk, not the whole file.
    const fd = openSync(path, "r");
    const head = Buffer.alloc(20);
    readSync(fd, head, 0, 20, 0);
    const chunk = Buffer.alloc(head.readUInt32LE(12));
    readSync(fd, chunk, 0, chunk.length, 20);
    closeSync(fd);
    const gltf = JSON.parse(chunk.toString("utf8"));
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const mesh of gltf.meshes ?? []) {
      for (const p of mesh.primitives ?? []) {
        const a = gltf.accessors[p.attributes.POSITION];
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i], a.min[i]);
          max[i] = Math.max(max[i], a.max[i]);
        }
      }
    }
    return Number.isFinite(min[0]) ? [min, max] : null;
  } catch {
    return null;
  }
}
