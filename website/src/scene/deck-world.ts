import {
  AmbientLight,
  BitmapLayer,
  LightingEffect,
  type LayerExtension,
  ScenegraphLayer,
  Tile3DLayer,
  TileLayer,
  WebMercatorViewport,
  type Deck,
  type MapView,
  type MapViewState,
} from "deck.gl";
import type { PicnicTable } from "../types";
import { Vector3 } from "@math.gl/core";
import { Ellipsoid } from "@math.gl/geospatial";
import { modelUrl } from "../lib/utils";
import lightStyle from "../map-style.light.json";
import darkStyle from "../map-style.dark.json";

/** The middle of the tables. */
export const ORIGIN = { lat: 37.76922, lon: -122.48426 };
/** Ellipsoid height (m) of the meadow, as Google's tiles have it (measured by
 *  picking the open grass in the middle: 15.6–17.0 m). A table stands at
 *  GROUND + its `altitude`, so `altitude` is meters above this level. */
export const GROUND = 16.5;
export const TILES_ID = "google-3d-tiles";
export const BASEMAP_ID = "basemap";
const TILE_MEMORY_MB = 768;

// How much detail Google's 3D tiles load where. A tile is refined into finer
// ones while its error on screen, in pixels, is above the limit: lower limits
// load more detail. Near a table, tiles load to TABLE_DETAIL_SSE; everywhere
// else, to OUTSIDE_SSE, so the rest of the city stays as coarse as it can.
/** Tiles within this many meters of a table load in detail. */
export const DETAIL_RADIUS_M = 60;
/** The limit near the tables (loaders.gl's default is 8). */
const TABLE_DETAIL_SSE = 6;
/** The limit everywhere else. Very high: barely refined at all. */
const OUTSIDE_SSE = 160;

const TABLE_PREFIX = "table-";
const D2R = Math.PI / 180;
/** Meters per pixel at zoom 0 on the equator (512 px tiles). */
const MPP_Z0 = 78271.517;
/** deck's camera stands 1.5 viewport-heights from its target. */
const CAMERA_ALTITUDE = 1.5;

export const isPlaced = (t: PicnicTable) => t.longitude != null && t.latitude != null;
export const tableZ = (t: PicnicTable) => GROUND + t.altitude;
/** Ellipsoid height of the bottom of a scan (its concrete pad). */
export const tableGround = (t: PicnicTable) => tableZ(t) + (t.bounds ? t.bounds[0][1] * t.scale_y : 0);
/** About half the length of a scan; the pair 15 & 16 is twice as long. */
export const tableRadius = (t: PicnicTable) => (t.num.includes("&") ? 3.2 : 2);

/** The scans carry their light in the texture, as the tiles do: light them evenly. */
export const flatLight = new LightingEffect({
  ambient: new AmbientLight({ color: [255, 255, 255], intensity: 1 }),
});

/** Google's photorealistic 3D tiles. `onCredits` receives the data credits of
 *  the tiles on screen whenever they change. Draw it in one view only: a
 *  Tile3DLayer shared by two views keeps its tile selection on the tiles
 *  themselves, and the second view's pass undoes parts of the first's,
 *  leaving holes. */
export function tilesLayer(
  apiKey: string,
  onCredits: (text: string) => void,
  pickable = false,
  /** More Tile3DLayer props, such as the CarveExtension and its boxes (carve.ts). */
  extra: Record<string, unknown> = {},
  /** Load detail only around these points ([lon, lat, height]); elsewhere,
   *  the coarsest tiles. Without them, detail everywhere. */
  detailAround?: number[][],
) {
  return new Tile3DLayer({
    id: TILES_ID,
    data: "https://tile.googleapis.com/v1/3dtiles/root.json",
    loadOptions: { fetch: { headers: { "X-GOOG-API-KEY": apiKey } } },
    pickable,
    onTileLoad: (tile) => smoothTextures(tile.content),
    onTilesetLoad: (tileset) => {
      // loaders.gl keeps 32 MB of tiles by default, and Tile3DLayer has no prop
      // for it. Close to a table Google's fine tiles overflow that at once and
      // are evicted, leaving the coarse ones. Give them room.
      tileset.options.maximumMemoryUsage = TILE_MEMORY_MB;
      (tileset as unknown as { _cacheBytes: number })._cacheBytes = TILE_MEMORY_MB * 1024 * 1024;
      tileset.options.maximumScreenSpaceError = TABLE_DETAIL_SSE;
      if (detailAround?.length) detailOnlyAround(tileset, detailAround);
      let last = "";
      tileset.options.onTraversalComplete = (selected) => {
        const credits = new Set<string>();
        for (const tile of selected) {
          const copyright = (tile.content as { gltf?: { asset?: { copyright?: string } } } | null)?.gltf?.asset?.copyright;
          copyright?.split(";").forEach((c) => credits.add(c.trim()));
        }
        const text = [...credits].filter(Boolean).join("; ");
        if (text !== last) onCredits((last = text));
        return selected;
      };
    },
    ...extra,
  });
}

/**
 * Make loaders.gl refine tiles near the given points to the tileset's limit,
 * and all others only to OUTSIDE_SSE. Tile3DLayer has no prop for this, so
 * the traverser's own test is wrapped. A tile counts as near if its bounding
 * volume comes within DETAIL_RADIUS_M of a point; the big tiles that contain
 * the tables are near, so the way down to the fine tiles there stays open.
 */
function detailOnlyAround(tileset: object, points: number[][]) {
  type Tile = {
    _screenSpaceError: number;
    boundingVolume?: { distanceTo(point: number[]): number };
    getScreenSpaceError(frameState: unknown, useParent: boolean): number;
  };
  const traverser = (tileset as { _traverser?: { shouldRefine: (tile: Tile, frameState: unknown, useParent?: boolean) => boolean } })._traverser;
  if (!traverser) return;
  const centers = points.map((p) => [...Ellipsoid.WGS84.cartographicToCartesian(p, new Vector3())]);
  const near = new WeakMap<Tile, boolean>();
  const isNear = (tile: Tile) => {
    let n = near.get(tile);
    if (n === undefined) {
      n = !tile.boundingVolume || centers.some((c) => tile.boundingVolume!.distanceTo(c) < DETAIL_RADIUS_M);
      near.set(tile, n);
    }
    return n;
  };
  const shouldRefine = traverser.shouldRefine.bind(traverser);
  traverser.shouldRefine = (tile, frameState, useParent = false) => {
    if (isNear(tile)) return shouldRefine(tile, frameState, useParent);
    const error = useParent ? tile.getScreenSpaceError(frameState, true) : tile._screenSpaceError;
    return error > OUTSIDE_SSE;
  };
}

const GL_LINEAR = 9729;

/** Google's tiles name no texture filter, and luma.gl then samples nearest
 *  pixel, which turns the ground into blocks close up. Ask for linear, before
 *  the tile's layer is made. (Not a mipmapped filter: the tiles carry none.) */
function smoothTextures(content: unknown) {
  const gltf = (content as { gltf?: { textures?: { sampler?: Record<string, number> }[] } } | null)?.gltf;
  for (const texture of gltf?.textures ?? []) {
    texture.sampler = { ...texture.sampler, magFilter: GL_LINEAR, minFilter: GL_LINEAR };
  }
}

// ---- The light map: Google's 2D roadmap tiles, styled pale. (Google's terms
// do not allow a non-Google map in the same app as their 3D tiles.)

type MapStyle = { featureType?: string; elementType?: string; stylers: Record<string, string | number>[] }[];

// The styles live in src/map-style.light.json and src/map-style.dark.json, in
// Google's map style format (featureType / elementType / stylers). Edit and
// save: the page reloads with the new style.
const LIGHT_MAP = lightStyle as MapStyle;
const DARK_MAP = darkStyle as MapStyle;

const TILE_API = "https://tile.googleapis.com";

/** Which of Google's 2D maps: the styled roadmap, light or dark, or satellite imagery. */
export type MapKind = "light" | "dark" | "satellite";

/** A Map Tiles session for one kind of map; tiles are requested with it. */
export async function createMapSession(apiKey: string, kind: MapKind): Promise<string> {
  const retina = window.devicePixelRatio > 1;
  const satellite = kind === "satellite";
  const res = await fetch(`${TILE_API}/v1/createSession?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mapType: satellite ? "satellite" : "roadmap",
      language: "en-US",
      region: "US",
      scale: retina ? "scaleFactor2x" : "scaleFactor1x",
      highDpi: retina,
      // Styles apply to the roadmap only.
      ...(!satellite && { styles: kind === "dark" ? DARK_MAP : LIGHT_MAP }),
    }),
  });
  if (!res.ok) throw new Error(`Map Tiles session failed: ${res.status}`);
  return (await res.json()).session as string;
}

/** Google's credit line for a map ("Map data ©… Google", "Imagery ©… Airbus"),
 *  which must show with it. */
export async function mapCopyright(apiKey: string, session: string, tables: PicnicTable[], zoom = 17): Promise<string> {
  const placed = tables.filter(isPlaced);
  const lats = placed.map((t) => t.latitude!);
  const lons = placed.map((t) => t.longitude!);
  const q = new URLSearchParams({
    session,
    key: apiKey,
    zoom: String(zoom),
    north: String(Math.max(...lats) + 0.002),
    south: String(Math.min(...lats) - 0.002),
    east: String(Math.max(...lons) + 0.003),
    west: String(Math.min(...lons) - 0.003),
  });
  const res = await fetch(`${TILE_API}/tile/v1/viewport?${q}`);
  return res.ok ? ((await res.json()).copyright as string) : "";
}

/** The open viewer's satellite imagery, when it shows that instead of the 3D
 *  tiles. Its id must not start with BASEMAP_ID, which is the map pane's. */
export const GROUND_MAP_ID = "ground-map";

/** Google's satellite imagery has detail to zoom 21 at the tables; closer in,
 *  deck enlarges the zoom-21 tiles. The roadmap goes to 20. */
const MAX_TILE_ZOOM: Record<MapKind, number> = { light: 20, dark: 20, satellite: 21 };

/** One of Google's 2D maps. `z` lifts it to that ellipsoid height (the viewer
 *  lays its imagery at the open table's ground; the flat map pane leaves it at 0). */
export function basemapLayer(
  apiKey: string,
  session: string,
  kind: MapKind,
  { idPrefix = BASEMAP_ID, z = 0, extensions = [] as LayerExtension[] } = {},
) {
  return new TileLayer({
    extensions,
    // A new id per kind, so another kind's tiles are not reused.
    id: `${idPrefix}-${kind}`,
    data: `${TILE_API}/v1/2dtiles/{z}/{x}/{y}?session=${encodeURIComponent(session)}&key=${encodeURIComponent(apiKey)}`,
    minZoom: 0,
    maxZoom: MAX_TILE_ZOOM[kind],
    tileSize: 256,
    // Pick tiles for the height the map is drawn at, not sea level: raised and
    // seen at an angle, the edges of the view are otherwise left without tiles.
    zRange: [z, z],
    renderSubLayers: (props) => {
      const [[west, south], [east, north]] = props.tile.boundingBox;
      return new BitmapLayer({
        ...props,
        data: undefined,
        image: props.data,
        bounds: [
          [west, south, z],
          [west, north, z],
          [east, north, z],
          [east, south, z],
        ],
      });
    },
    updateTriggers: { renderSubLayers: z },
  });
}

/** The light map is flat and north up. */
function flatState(longitude: number, latitude: number, zoom: number): MapViewState {
  return { longitude, latitude, zoom, pitch: 0, bearing: 0, maxPitch: 0, maxZoom: 20, minZoom: 12 };
}

/** The light map far enough out that every table is inside the middle 80%. */
export function mapOverview(tables: PicnicTable[], width: number, height: number): MapViewState {
  const placed = tables.filter(isPlaced);
  const lons = placed.map((t) => t.longitude!);
  const lats = placed.map((t) => t.latitude!);
  const lon = placed.length ? (Math.min(...lons) + Math.max(...lons)) / 2 : ORIGIN.lon;
  const lat = placed.length ? (Math.min(...lats) + Math.max(...lats)) / 2 : ORIGIN.lat;
  for (let zoom = 20; zoom > 12; zoom -= 0.05) {
    const vp = new WebMercatorViewport({ ...flatState(lon, lat, zoom), width, height });
    const fits = placed.every((t) => {
      const [x, y] = vp.project([t.longitude!, t.latitude!]);
      return x > width * 0.1 && x < width * 0.9 && y > height * 0.1 && y < height * 0.9;
    });
    if (fits) return flatState(lon, lat, zoom);
  }
  return flatState(lon, lat, 16);
}

/** The light map close in on one table (the minimap). */
export function mapFocus(t: PicnicTable): MapViewState {
  return flatState(t.longitude!, t.latitude!, 18.5);
}

/** One ScenegraphLayer per scan (each is its own glTF). The editor's numbers
 *  were set in this layer's convention, so they apply as they are. */
export function tableLayers(tables: PicnicTable[], pickable = false) {
  return tables.filter(isPlaced).map(
    (t) =>
      new ScenegraphLayer<PicnicTable>({
        id: TABLE_PREFIX + t.id,
        data: [t],
        scenegraph: modelUrl(t),
        getPosition: (d) => [d.longitude!, d.latitude!, tableZ(d)],
        getOrientation: (d) => [d.rotation_x, d.rotation_y, d.rotation_z],
        getScale: (d) => [d.scale_x, d.scale_y, d.scale_z],
        _lighting: "flat",
        pickable,
      }),
  );
}

/** The table id of a picked layer, if it is a scan. */
export function tableIdOfLayer(layerId: string | undefined) {
  return layerId?.startsWith(TABLE_PREFIX) ? Number(layerId.slice(TABLE_PREFIX.length)) : null;
}

export interface Look {
  lon: number;
  lat: number;
  /** Ellipsoid height of the point looked at. */
  z: number;
  /** Degrees clockwise from north. */
  heading: number;
  /** Degrees above the horizon. */
  elevation: number;
  /** Meters from the point. */
  distance: number;
}

/** A deck MapView state that looks at a point from a distance, for a view `heightPx` tall. */
export function viewStateFor(look: Look, heightPx: number): MapViewState {
  const metersPerPixel = look.distance / (CAMERA_ALTITUDE * Math.max(1, heightPx));
  return {
    longitude: look.lon,
    latitude: look.lat,
    zoom: Math.log2((MPP_Z0 * Math.cos(look.lat * D2R)) / metersPerPixel),
    pitch: 90 - look.elevation,
    bearing: look.heading,
    position: [0, 0, look.z],
    maxPitch: 85,
    // Close enough to read the writing: at 27 an 800 px tall view spans about 40 cm.
    maxZoom: 27,
    // Low enough for the viewer's own zoom-out limit (archive-scene.ts).
    minZoom: 9,
  };
}

/** How much larger than the render the page draws it (the cards and the
 *  viewer's still both use `scale-[1.35]`), and how much room the render left
 *  around the scan (scripts/orbit-renderer.html frames its bounding sphere × 1.15). */
const RENDER_ZOOM = 1.35;
const RENDER_PADDING = 1.15;

/**
 * The view of the table's render (renders/*.jpg): straight down, centered on
 * the scan, turned and scaled to match the picture as the viewer shows it
 * (`object-contain` in a `width` × `height` box, then RENDER_ZOOM).
 *
 * The render turns the model about its up axis by φ = render_rotation − 90°
 * and looks straight down, its screen's right along the scene's +x and its up
 * along −z; so the top of the picture is the model's (sin φ, 0, −cos φ). In
 * ScenegraphLayer's convention (roll 90°, pitch 0°) the model's x points
 * (cos yaw, sin yaw) east-north and its z (sin yaw, −cos yaw); together, the
 * top of the picture is the compass bearing φ − yaw.
 */
export function renderView(t: PicnicTable, width: number, height: number): MapViewState {
  const yaw = t.rotation_y * D2R;
  const bearing = t.render_rotation - 90 - t.rotation_y;
  let lon = t.longitude!;
  let lat = t.latitude!;
  let z = tableZ(t) + 0.45;
  let radius = tableRadius(t);
  if (t.bounds) {
    const [min, max] = t.bounds;
    const half = [0, 1, 2].map((i) => ((max[i] - min[i]) / 2) * [t.scale_x, t.scale_y, t.scale_z][i]);
    radius = Math.hypot(...half);
    const cx = ((min[0] + max[0]) / 2) * t.scale_x;
    const cy = ((min[1] + max[1]) / 2) * t.scale_y;
    const cz = ((min[2] + max[2]) / 2) * t.scale_z;
    const east = cx * Math.cos(yaw) + cz * Math.sin(yaw);
    const north = cx * Math.sin(yaw) - cz * Math.cos(yaw);
    lon += east / (111320 * Math.cos(lat * D2R));
    lat += north / 111320;
    z = tableZ(t) + cy;
  }
  // The picture's side on screen, and the meters it spans.
  const side = RENDER_ZOOM * Math.min(width, height);
  const metersPerPixel = (2 * radius * RENDER_PADDING) / side;
  // viewStateFor works from a distance: invert its meters-per-pixel rule.
  const distance = metersPerPixel * CAMERA_ALTITUDE * height;
  return viewStateFor({ lon, lat, z, heading: bearing, elevation: 90, distance }, height);
}

export function lookAtTable(t: PicnicTable, heading: number, elevation: number, distance: number): Look {
  return { lon: t.longitude!, lat: t.latitude!, z: tableZ(t) + 0.45, heading, elevation, distance };
}

/** Screen position (in the view's pixels) of the point a table's tag marks:
 *  just above the scan in 3D, or the table's spot on the flat map. */
export function tagProjector(viewState: MapViewState, width: number, height: number, flat = false) {
  const vp = new WebMercatorViewport({ ...viewState, width, height });
  return (t: PicnicTable): [number, number] | null => {
    const [x, y, depth] = vp.project([t.longitude!, t.latitude!, flat ? 0 : tableZ(t) + 1.2]);
    return depth > 0 && depth < 1 ? [x, y] : null;
  };
}

/** Ease between two view states (bearing the short way round). */
export function mixViewStates(a: MapViewState, b: MapViewState, k: number): MapViewState {
  const lerp = (x: number, y: number) => x + (y - x) * k;
  const db = ((((b.bearing ?? 0) - (a.bearing ?? 0)) % 360) + 540) % 360 - 180;
  const az = a.position?.[2] ?? 0;
  const bz = b.position?.[2] ?? 0;
  return {
    ...b,
    longitude: lerp(a.longitude, b.longitude),
    latitude: lerp(a.latitude, b.latitude),
    zoom: lerp(a.zoom, b.zoom),
    pitch: lerp(a.pitch ?? 0, b.pitch ?? 0),
    bearing: (a.bearing ?? 0) + db * k,
    position: [0, 0, lerp(az, bz)],
  };
}

type Picker = Pick<Deck<MapView>, "pickObject">;

/** The tiles under a screen point: longitude, latitude, height. Only the tiles
 *  are drawn for the pick, so the scans never get in the way. */
export function pickTiles(deck: Picker, x: number, y: number): [number, number, number] | null {
  const c = deck.pickObject({ x, y, radius: 0, layerIds: [TILES_ID], unproject3D: true })?.coordinate;
  return c && c.length >= 3 ? (c as [number, number, number]) : null;
}

/**
 * The ground's height round a point, from what the camera can see: picks on
 * two rings, 2.5 and 3.5 m out, so Google's own model of a table (or a bench)
 * at the point itself is stepped over. Picks well above `nearZ` (tree canopy
 * seen past the point) are dropped, and the lower quartile of the rest is
 * taken, since anything left standing on the ground only reads higher.
 * Null if too little ground is in view.
 */
export function groundAround(
  deck: Picker,
  viewState: MapViewState,
  width: number,
  height: number,
  lon: number,
  lat: number,
  nearZ: number,
): number | null {
  const vp = new WebMercatorViewport({ ...viewState, width, height });
  const heights: number[] = [];
  for (const radius of [2.5, 3.5]) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8 + radius / 10) * Math.PI * 2;
      const point: [number, number, number] = [
        lon + (Math.cos(a) * radius) / (111320 * Math.cos(lat * D2R)),
        lat + (Math.sin(a) * radius) / 111320,
        nearZ,
      ];
      const [x, y] = vp.project(point);
      if (x < 0 || y < 0 || x > width || y > height) continue;
      const hit = pickTiles(deck, x, y);
      if (hit && hit[2] < nearZ + 1.5) heights.push(hit[2]);
    }
  }
  if (heights.length < 4) return null;
  heights.sort((a, b) => a - b);
  return heights[Math.floor(heights.length / 4)];
}

/** An altitude (meters above GROUND), to the centimeter. */
export const altitudeOf = (ground: number) => Math.round((ground - GROUND) * 100) / 100;

export function hexToRgba(hex: string): [number, number, number, number] {
  const m = hex.trim().match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16), 255] : [0, 0, 0, 255];
}
