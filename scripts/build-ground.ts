// The ground under the tables, baked once: USGS 3DEP lidar heights (bare
// earth, 1 m) with a USGS NAIP aerial photo laid over them, for the area
// around Hellman Hollow. The viewer's "terrain" ground draws it instead of
// streaming Google's 3D tiles. Both datasets are public domain.
//
// Writes model/ground/:
//   ground.json  bounds, grid size, how to read the heights, credits
//   ground.bin   heights, little-endian Uint16 centimeters above `base`,
//                row by row from the north-west corner
//   ground.jpg   the photo, north up, covering the same bounds
//
// Run: npm run ground
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { fromArrayBuffer } from "geotiff";
import { MODEL_DIR, readTables } from "./tables";

const OUT = join(MODEL_DIR, "ground");

/** Ellipsoid height of the meadow in Google's tiles; must match GROUND in website/src/scene/deck-world.ts. */
const GROUND = 16.5;
/** Ground around the tables, in meters each side of their extent. */
const PAD_EW = 260;
const PAD_NS = 180;
/** Meters per height sample and per photo pixel. */
const DEM_STEP = 1;
const PHOTO_STEP = 0.3;

const DEM_URL = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage";
const PHOTO_URL = "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage";

const M_PER_LAT = 111_320;

async function fetchBuffer(url: string, tries = 4): Promise<ArrayBuffer> {
  const res = await fetch(url);
  // The services sometimes answer 502/503 under load: wait and ask again.
  if (res.status >= 500 && tries > 1) {
    await new Promise((r) => setTimeout(r, 3000));
    return fetchBuffer(url, tries - 1);
  }
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const type = res.headers.get("content-type") ?? "";
  // The services answer errors with JSON and a 200.
  if (type.includes("json") || type.includes("text")) throw new Error(`${url}\n${await res.text()}`);
  return res.arrayBuffer();
}

function exportUrl(base: string, bbox: number[], width: number, height: number, extra: Record<string, string>) {
  const q = new URLSearchParams({
    bbox: bbox.join(","),
    bboxSR: "4326",
    imageSR: "4326",
    size: `${width},${height}`,
    f: "image",
    ...extra,
  });
  return `${base}?${q}`;
}

async function main() {
  const tables = readTables().filter((t) => t.longitude != null && t.latitude != null);
  const lons = tables.map((t) => t.longitude!);
  const lats = tables.map((t) => t.latitude!);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const mPerLon = M_PER_LAT * Math.cos((midLat * Math.PI) / 180);
  const west = Math.min(...lons) - PAD_EW / mPerLon;
  const east = Math.max(...lons) + PAD_EW / mPerLon;
  const south = Math.min(...lats) - PAD_NS / M_PER_LAT;
  const north = Math.max(...lats) + PAD_NS / M_PER_LAT;
  const bbox = [west, south, east, north];
  const widthM = (east - west) * mPerLon;
  const heightM = (north - south) * M_PER_LAT;
  console.log(`Area ${widthM.toFixed(0)} × ${heightM.toFixed(0)} m`);

  // Heights: meters above sea level (NAVD88), one sample per DEM_STEP.
  const cols = Math.round(widthM / DEM_STEP);
  const rows = Math.round(heightM / DEM_STEP);
  const dem = await fetchBuffer(
    exportUrl(DEM_URL, bbox, cols, rows, {
      format: "tiff",
      pixelType: "F32",
      interpolation: "RSP_BilinearInterpolation",
    }),
  );
  const image = await (await fromArrayBuffer(dem)).getImage();
  if (image.getWidth() !== cols || image.getHeight() !== rows) throw new Error("DEM came back at another size");
  const [raster] = (await image.readRasters()) as unknown as Float32Array[];
  console.log(`Heights ${cols} × ${rows}`);

  /** Height at a point, bilinear between sample centers. */
  const sample = (lon: number, lat: number) => {
    const x = ((lon - west) / (east - west)) * cols - 0.5;
    const y = ((north - lat) / (north - south)) * rows - 0.5;
    const x0 = Math.max(0, Math.min(cols - 2, Math.floor(x)));
    const y0 = Math.max(0, Math.min(rows - 2, Math.floor(y)));
    const fx = x - x0;
    const fy = y - y0;
    const at = (c: number, r: number) => raster[r * cols + c];
    return (
      at(x0, y0) * (1 - fx) * (1 - fy) +
      at(x0 + 1, y0) * fx * (1 - fy) +
      at(x0, y0 + 1) * (1 - fx) * fy +
      at(x0 + 1, y0 + 1) * fx * fy
    );
  };

  // Lidar heights are above sea level, the scene's are above the ellipsoid
  // (Google's tiles). Line them up on the tables: each table's pad was placed
  // on Google's ground, so the typical difference at the pads is the offset.
  const pads = tables.map((t) => {
    const pad = GROUND + t.altitude + (t.bounds ? t.bounds[0][1] * t.scale_y : 0);
    return { num: t.num, pad, lidar: sample(t.longitude!, t.latitude!) };
  });
  const diffs = pads.map((p) => p.pad - p.lidar).sort((a, b) => a - b);
  const offset = diffs[Math.floor(diffs.length / 2)];
  console.log(`Offset (median at the pads) ${offset.toFixed(2)} m`);
  for (const p of pads) {
    const off = p.pad - (p.lidar + offset);
    console.log(`  table ${p.num.padEnd(5)} pad ${off >= 0 ? "+" : ""}${off.toFixed(2)} m from the lidar ground`);
  }

  // Store as centimeters above the lowest point, in the scene's heights.
  let base = Infinity;
  for (const h of raster) if (h + offset < base) base = h + offset;
  base = Math.floor(base);
  const cm = new Uint16Array(raster.length);
  for (let i = 0; i < raster.length; i++) cm[i] = Math.round((raster[i] + offset - base) * 100);

  // The photo: RGB of the 4-band NAIP, one pixel per PHOTO_STEP.
  const photo = await fetchBuffer(
    exportUrl(PHOTO_URL, bbox, Math.round(widthM / PHOTO_STEP), Math.round(heightM / PHOTO_STEP), {
      format: "jpg",
      bandIds: "0,1,2",
    }),
  );

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "ground.bin"), new Uint8Array(cm.buffer));
  writeFileSync(join(OUT, "ground.jpg"), new Uint8Array(photo));
  writeFileSync(
    join(OUT, "ground.json"),
    JSON.stringify(
      {
        bounds: { west, south, east, north },
        cols,
        rows,
        /** height = base + value / 100, meters above the ellipsoid, as the scene's. */
        base,
        offset: +offset.toFixed(3),
        credit: "Elevation: USGS 3DEP lidar · Imagery: USDA NAIP via USGS The National Map",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`Wrote ${OUT}: ground.bin ${(cm.byteLength / 1e6).toFixed(1)} MB, ground.jpg ${(photo.byteLength / 1e6).toFixed(1)} MB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
