import { COORDINATE_SYSTEM, SimpleMeshLayer, TerrainLayer, type Layer } from "deck.gl";
import type { PicnicTable } from "../types";
import { isPlaced, tableGround, tableRadius } from "./deck-world";

// The ground under the tables without Google, fetched live in the visitor's
// browser (every service here sends CORS headers):
//
// - near the tables, about 690 × 420 m: USGS 3DEP lidar heights (bare earth,
//   1 m) from The National Map, built into one mesh, under Mapbox satellite
//   imagery at zoom 18 (about 0.24 m a pixel), stitched from its tiles;
// - everywhere else: Terrain Tiles on AWS (Terrarium-encoded heights from
//   USGS 3DEP) under Mapbox satellite tiles, streamed. The heights stop at
//   zoom 15, and the imagery with them, so this part is soft up close.
//
// Without a Mapbox token (VITE_MAPBOX_TOKEN) the imagery is USGS's instead:
// a NAIP aerial photo near the tables, the orthoimagery tiles around them.

export const TERRAIN_ID = "ground-terrain";
const SURROUND_ID = "ground-surround";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN?.trim() || null;
const MAPBOX_SATELLITE = "https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90";
/** Mapbox zoom for the imagery near the tables (512 px tiles). */
const NEAR_ZOOM = 18;

export const GROUND_CREDIT = MAPBOX_TOKEN
  ? "Elevation: USGS 3DEP lidar, Terrain Tiles on AWS · Imagery © Mapbox © Maxar"
  : "Elevation: USGS 3DEP lidar, Terrain Tiles on AWS · Imagery: USDA NAIP via USGS The National Map";

const DEM_URL = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage";
const PHOTO_URL = "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage";
const SURROUND_HEIGHTS = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const SURROUND_IMAGERY = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}";

/** Ground around the tables, in meters each side of their extent. */
const PAD_EW = 260;
const PAD_NS = 180;
/** Meters per height sample and per photo pixel. */
const DEM_STEP = 1;
const PHOTO_STEP = 0.3;
/** Ellipsoid minus sea-level height in western San Francisco, used if the
 *  lidar cannot be had to measure it at the pads (it measures -32.94 there). */
const FALLBACK_OFFSET = -32.9;
/** The streamed ground sits this far down, so near the tables it is always
 *  under the lidar ground (the two agree to about half a meter)... */
const SURROUND_SINK = 4;
/** ...and the lidar ground's outer edge eases down to meet it over this many meters. */
const EDGE_RING = 50;

const M_PER_LAT = 111_320;
const D2R = Math.PI / 180;
const UNLIT = { ambient: 1, diffuse: 0, shininess: 0, specularColor: [0, 0, 0] as [number, number, number] };

interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** The services answer 502/503 now and then under load, and a cold export can
 *  time out (which the browser reports as a network error): ask again a few times. */
async function fetchRetrying(url: string, tries = 4): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    if (tries <= 1) throw e;
    await new Promise((r) => setTimeout(r, 2000));
    return fetchRetrying(url, tries - 1);
  }
  if (res.status >= 500 && tries > 1) {
    await new Promise((r) => setTimeout(r, 2000));
    return fetchRetrying(url, tries - 1);
  }
  // Errors come back as JSON with a 200.
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || type.includes("json") || type.includes("text")) throw new Error(`${res.status} ${url}`);
  return res;
}

function exportUrl(base: string, b: Bounds, width: number, height: number, extra: Record<string, string>) {
  const q = new URLSearchParams({
    bbox: [b.west, b.south, b.east, b.north].join(","),
    bboxSR: "4326",
    imageSR: "4326",
    size: `${width},${height}`,
    f: "image",
    ...extra,
  });
  return `${base}?${q}`;
}

/** Lidar heights above sea level, row by row from the north-west corner. */
async function fetchHeights(b: Bounds, cols: number, rows: number) {
  const url = exportUrl(DEM_URL, b, cols, rows, {
    format: "tiff",
    pixelType: "F32",
    compression: "LZ77",
    interpolation: "RSP_BilinearInterpolation",
  });
  const [res, { fromArrayBuffer }] = await Promise.all([fetchRetrying(url), import("geotiff")]);
  const image = await (await fromArrayBuffer(await res.arrayBuffer())).getImage();
  if (image.getWidth() !== cols || image.getHeight() !== rows) throw new Error("The lidar came back at another size");
  const [heights] = (await image.readRasters()) as unknown as Float32Array[];
  return heights;
}

/** The imagery over the lidar ground, covering exactly `b`, north up. */
async function fetchPhoto(b: Bounds, width: number, height: number) {
  if (MAPBOX_TOKEN) return mapboxPhoto(b, MAPBOX_TOKEN);
  const url = exportUrl(PHOTO_URL, b, width, height, { format: "jpg", bandIds: "0,1,2" });
  return createImageBitmap(await (await fetchRetrying(url)).blob());
}

/** Mapbox satellite tiles at NEAR_ZOOM, stitched and cut to `b`. (The tiles
 *  are Web Mercator; across these few hundred meters that is linear in
 *  latitude to within centimeters, as the mesh's texture coordinates assume.) */
async function mapboxPhoto(b: Bounds, token: string) {
  const TILE = 512;
  const n = 2 ** NEAR_ZOOM;
  const tileX = (lon: number) => ((lon + 180) / 360) * n;
  const tileY = (lat: number) => {
    const s = Math.sin(lat * D2R);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  };
  const x0 = tileX(b.west);
  const x1 = tileX(b.east);
  const y0 = tileY(b.north);
  const y1 = tileY(b.south);
  const canvas = new OffscreenCanvas(Math.round((x1 - x0) * TILE), Math.round((y1 - y0) * TILE));
  const ctx = canvas.getContext("2d")!;
  const jobs: Promise<void>[] = [];
  for (let x = Math.floor(x0); x < x1; x++) {
    for (let y = Math.floor(y0); y < y1; y++) {
      const url = MAPBOX_SATELLITE.replace("{z}", String(NEAR_ZOOM)).replace("{x}", String(x)).replace("{y}", String(y));
      jobs.push(
        fetchRetrying(`${url}?access_token=${encodeURIComponent(token)}`)
          .then((res) => res.blob())
          .then((blob) => createImageBitmap(blob))
          .then((tile) => {
            ctx.drawImage(tile, (x - x0) * TILE, (y - y0) * TILE, TILE, TILE);
            tile.close();
          }),
      );
    }
  }
  await Promise.all(jobs);
  return canvas.transferToImageBitmap();
}

/**
 * The ground's layers: the streamed surroundings and, unless the image
 * services cannot be reached, the lidar ground near the tables over them.
 */
export async function loadGround(tables: PicnicTable[]): Promise<Layer[]> {
  const placed = tables.filter(isPlaced);
  const lons = placed.map((t) => t.longitude!);
  const lats = placed.map((t) => t.latitude!);
  const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
  const lon0 = (Math.min(...lons) + Math.max(...lons)) / 2;
  const mPerLon = M_PER_LAT * Math.cos(lat0 * D2R);
  const b: Bounds = {
    west: Math.min(...lons) - PAD_EW / mPerLon,
    east: Math.max(...lons) + PAD_EW / mPerLon,
    south: Math.min(...lats) - PAD_NS / M_PER_LAT,
    north: Math.max(...lats) + PAD_NS / M_PER_LAT,
  };
  const widthM = (b.east - b.west) * mPerLon;
  const heightM = (b.north - b.south) * M_PER_LAT;
  const cols = Math.round(widthM / DEM_STEP);
  const rows = Math.round(heightM / DEM_STEP);

  let near: Layer | null = null;
  let offset = FALLBACK_OFFSET;
  try {
    const [heights, photo] = await Promise.all([
      fetchHeights(b, cols, rows),
      fetchPhoto(b, Math.round(widthM / PHOTO_STEP), Math.round(heightM / PHOTO_STEP)),
    ]);
    offset = padOffset(heights, b, cols, rows, placed);
    near = nearGround(heights, photo, b, cols, rows, lon0, lat0, mPerLon, offset, placed);
  } catch (e) {
    console.error("The lidar ground could not be loaded; showing the streamed ground only.", e);
  }

  const sink = near ? SURROUND_SINK : 0;
  const surround = new TerrainLayer({
    id: SURROUND_ID,
    elevationData: SURROUND_HEIGHTS,
    texture: MAPBOX_TOKEN ? `${MAPBOX_SATELLITE}?access_token=${encodeURIComponent(MAPBOX_TOKEN)}` : SURROUND_IMAGERY,
    elevationDecoder: { rScaler: 256, gScaler: 1, bScaler: 1 / 256, offset: -32768 + offset - sink },
    maxZoom: 15,
    meshMaxError: 1,
    material: UNLIT,
  });
  return near ? [surround, near] : [surround];
}

/**
 * Lidar heights are above sea level, the scene's above the ellipsoid
 * (Google's tiles, which the tables were placed on). Each table's pad stands
 * on that ground, so the typical difference at the pads is the offset.
 */
function padOffset(heights: Float32Array, b: Bounds, cols: number, rows: number, tables: PicnicTable[]) {
  const sample = (lon: number, lat: number) => {
    const x = ((lon - b.west) / (b.east - b.west)) * cols - 0.5;
    const y = ((b.north - lat) / (b.north - b.south)) * rows - 0.5;
    const x0 = Math.max(0, Math.min(cols - 2, Math.floor(x)));
    const y0 = Math.max(0, Math.min(rows - 2, Math.floor(y)));
    const fx = x - x0;
    const fy = y - y0;
    const at = (c: number, r: number) => heights[r * cols + c];
    return (
      at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy
    );
  };
  const diffs = tables.map((t) => tableGround(t) - sample(t.longitude!, t.latitude!)).sort((a, c) => a - c);
  return diffs.length ? diffs[Math.floor(diffs.length / 2)] : FALLBACK_OFFSET;
}

/** One mesh, a vertex per sample, in meters around (lon0, lat0), the photo laid over it. */
function nearGround(
  heights: Float32Array,
  photo: ImageBitmap,
  b: Bounds,
  cols: number,
  rows: number,
  lon0: number,
  lat0: number,
  mPerLon: number,
  offset: number,
  tables: PicnicTable[],
) {
  const dx = ((b.east - b.west) / cols) * mPerLon;
  const dy = ((b.north - b.south) / rows) * M_PER_LAT;
  const height = (c: number, r: number) =>
    heights[Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))] + offset;

  // Each scan brings its own concrete pad. The lidar ground is within a few
  // decimeters of it but sometimes above, and would cover it: press the ground
  // under each pad just below it, easing back to the lidar over a few meters.
  const pads = tables.map((t) => ({
    x: (t.longitude! - lon0) * mPerLon,
    y: (t.latitude! - lat0) * M_PER_LAT,
    z: tableGround(t) - 0.04,
    inner: tableRadius(t) + 0.5,
    outer: tableRadius(t) + 3,
  }));
  const settle = (x: number, y: number, z: number) => {
    for (const p of pads) {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d >= p.outer || z <= p.z) continue;
      const k = d <= p.inner ? 1 : 1 - (d - p.inner) / (p.outer - p.inner);
      z = z - (z - p.z) * k * k * (3 - 2 * k);
    }
    return z;
  };
  // Ease the outer ring down to the streamed ground around it (SURROUND_SINK).
  const west = (b.west - lon0) * mPerLon;
  const east = (b.east - lon0) * mPerLon;
  const south = (b.south - lat0) * M_PER_LAT;
  const north = (b.north - lat0) * M_PER_LAT;
  const edge = (x: number, y: number, z: number) => {
    const d = Math.min(x - west, east - x, y - south, north - y);
    if (d >= EDGE_RING) return z;
    const k = 1 - Math.max(0, d) / EDGE_RING;
    return z - SURROUND_SINK * k * k * (3 - 2 * k);
  };

  const n = cols * rows;
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const texCoords = new Float32Array(n * 2);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      // Sample centers; row 0 is the north edge.
      const x = west + ((c + 0.5) / cols) * (east - west);
      const y = north - ((r + 0.5) / rows) * (north - south);
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = edge(x, y, settle(x, y, height(c, r)));
      const gx = (height(c + 1, r) - height(c - 1, r)) / (2 * dx);
      const gy = (height(c, r - 1) - height(c, r + 1)) / (2 * dy);
      const len = Math.hypot(gx, gy, 1);
      normals[i * 3] = -gx / len;
      normals[i * 3 + 1] = -gy / len;
      normals[i * 3 + 2] = 1 / len;
      texCoords[i * 2] = (c + 0.5) / cols;
      texCoords[i * 2 + 1] = (r + 0.5) / rows;
    }
  }
  const indices = new Uint32Array((cols - 1) * (rows - 1) * 6);
  let k = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const i = r * cols + c;
      indices.set([i, i + cols, i + 1, i + 1, i + cols, i + cols + 1], k);
      k += 6;
    }
  }

  return new SimpleMeshLayer({
    id: TERRAIN_ID,
    data: [0],
    mesh: {
      attributes: {
        positions: { value: positions, size: 3 },
        normals: { value: normals, size: 3 },
        texCoords: { value: texCoords, size: 2 },
      },
      indices: { value: indices, size: 1 },
    },
    texture: photo,
    coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
    coordinateOrigin: [lon0, lat0, 0],
    getPosition: () => [0, 0, 0],
    getColor: [255, 255, 255],
    // The photo carries its own light, as the tiles and scans do: show it as it is.
    material: UNLIT,
  });
}
