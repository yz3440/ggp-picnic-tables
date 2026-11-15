import { BitmapLayer, COORDINATE_SYSTEM, SimpleMeshLayer, TerrainLayer, TileLayer, type Layer } from "deck.gl";
// Still marked experimental in deck.gl 9.4, hence the underscore.
import { _TerrainExtension as TerrainExtension } from "@deck.gl/extensions";
import type { PicnicTable } from "../types";
import { isPlaced, tableGround, tableRadius } from "./deck-world";

// The ground under the tables without Google, fetched live in the visitor's
// browser (every service here sends CORS headers), the way Mapbox's own 3D
// maps are made: a terrain surface, with satellite imagery draped over it at
// whatever zoom the view needs.
//
// The surface, in two parts:
// - around the tables, about 1.2 × 0.86 km (all of Hellman Hollow, both
//   roads and the woods either side): USGS 3DEP lidar heights (bare earth, a
//   sample every 1.5 m) from The National Map, built into one mesh;
// - everywhere else: Terrain Tiles on AWS (Terrarium-encoded heights from
//   USGS 3DEP), streamed. These stop at zoom 15, which is plenty for shape.
// The imagery: Mapbox satellite tiles, up to zoom 19 (about 0.12 m a pixel),
// draped over both (deck.gl's TerrainExtension). Only the tiles in view load.
// Without a Mapbox token (VITE_MAPBOX_TOKEN), USGS's orthoimagery tiles
// instead, which stop at zoom 16.

export const TERRAIN_ID = "ground-terrain";
const SURROUND_ID = "ground-surround";
const IMAGERY_ID = "ground-imagery";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN?.trim() || null;
const IMAGERY = MAPBOX_TOKEN
  ? {
      url: `https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${encodeURIComponent(MAPBOX_TOKEN)}`,
      tileSize: 512,
      maxZoom: 19,
    }
  : {
      url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
      tileSize: 256,
      maxZoom: 16,
    };

export const GROUND_CREDIT = MAPBOX_TOKEN
  ? "Elevation: USGS 3DEP lidar, Terrain Tiles on AWS · Imagery © Mapbox © Maxar"
  : "Elevation: USGS 3DEP lidar, Terrain Tiles on AWS · Imagery: USGS The National Map";

const DEM_URL = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage";
const SURROUND_HEIGHTS = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

/** Ground around the tables, in meters each side of their extent. */
const PAD_EW = 500;
const PAD_NS = 400;
/** Meters per height sample. */
const DEM_STEP = 1.5;
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
/** The ground's own color, seen only where its imagery has not arrived yet: a
 *  shadowed park green rather than white. */
const UNDER = [38, 44, 36] as [number, number, number];
/** The imagery carries its own light, as the tiles and scans do: show it as it is. */
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

/** Lidar heights above sea level, row by row from the north-west corner. */
async function fetchHeights(b: Bounds, cols: number, rows: number) {
  const q = new URLSearchParams({
    bbox: [b.west, b.south, b.east, b.north].join(","),
    bboxSR: "4326",
    imageSR: "4326",
    size: `${cols},${rows}`,
    f: "image",
    format: "tiff",
    pixelType: "F32",
    compression: "LZ77",
    interpolation: "RSP_BilinearInterpolation",
  });
  const [res, { fromArrayBuffer }] = await Promise.all([fetchRetrying(`${DEM_URL}?${q}`), import("geotiff")]);
  const image = await (await fromArrayBuffer(await res.arrayBuffer())).getImage();
  if (image.getWidth() !== cols || image.getHeight() !== rows) throw new Error("The lidar came back at another size");
  const [heights] = (await image.readRasters()) as unknown as Float32Array[];
  return heights;
}

/**
 * The ground's layers: the streamed surface, the lidar surface near the
 * tables (unless the elevation service cannot be reached), and the imagery
 * draped over both.
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
  const cols = Math.round(((b.east - b.west) * mPerLon) / DEM_STEP);
  const rows = Math.round(((b.north - b.south) * M_PER_LAT) / DEM_STEP);

  let near: Layer | null = null;
  let offset = FALLBACK_OFFSET;
  try {
    const heights = await fetchHeights(b, cols, rows);
    offset = padOffset(heights, b, cols, rows, placed);
    near = nearGround(heights, b, cols, rows, lon0, lat0, mPerLon, offset, placed);
  } catch (e) {
    console.error("The lidar ground could not be loaded; showing the streamed ground only.", e);
  }

  const sink = near ? SURROUND_SINK : 0;
  const surround = new TerrainLayer({
    id: SURROUND_ID,
    // A surface for the imagery to drape over, drawn with it.
    operation: "terrain+draw",
    elevationData: SURROUND_HEIGHTS,
    elevationDecoder: { rScaler: 256, gScaler: 1, bScaler: 1 / 256, offset: -32768 + offset - sink },
    maxZoom: 15,
    meshMaxError: 1,
    color: UNDER,
    material: UNLIT,
  });
  const imagery = new TileLayer<ImageBitmap>({
    id: IMAGERY_ID,
    data: IMAGERY.url,
    tileSize: IMAGERY.tileSize,
    minZoom: 0,
    maxZoom: IMAGERY.maxZoom,
    // Pick tiles for the heights the ground is at, not sea level, so a view at
    // an angle is not left without tiles at its edges.
    zRange: [-40, 80],
    extensions: [new TerrainExtension()],
    renderSubLayers: (props) => {
      const [[west, south], [east, north]] = props.tile.boundingBox;
      return new BitmapLayer({ ...props, data: undefined, image: props.data, bounds: [west, south, east, north] });
    },
  });
  return near ? [surround, near, imagery] : [surround, imagery];
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

/** One mesh, a vertex per sample, in meters around (lon0, lat0): a surface for the imagery. */
function nearGround(
  heights: Float32Array,
  b: Bounds,
  cols: number,
  rows: number,
  lon0: number,
  lat0: number,
  mPerLon: number,
  offset: number,
  tables: PicnicTable[],
) {
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

  const positions = new Float32Array(cols * rows * 3);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      // Sample centers; row 0 is the north edge.
      const x = west + ((c + 0.5) / cols) * (east - west);
      const y = north - ((r + 0.5) / rows) * (north - south);
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = edge(x, y, settle(x, y, height(c, r)));
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
    // A surface for the imagery to drape over, drawn with it.
    operation: "terrain+draw",
    data: [0],
    mesh: {
      attributes: { positions: { value: positions, size: 3 } },
      indices: { value: indices, size: 1 },
    },
    // The mesh is already where it goes (meters around the origin), so its
    // bounds are its own: the drape covers exactly the part in view.
    _instanced: false,
    coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
    coordinateOrigin: [lon0, lat0, 0],
    getPosition: () => [0, 0, 0],
    getColor: UNDER,
    material: UNLIT,
  });
}
