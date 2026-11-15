import { BitmapLayer, TerrainLayer, TileLayer, type Layer } from "deck.gl";
// Still marked experimental in deck.gl, hence the underscore.
import { _TerrainExtension as TerrainExtension } from "@deck.gl/extensions";
import type { PicnicTable } from "../types";
import { ParkLightExtension } from "./park-light";

// The ground under the tables without Google, fetched live in the visitor's
// browser, the way Mapbox's own 3D maps are made: Mapbox Terrain-DEM heights
// (up to zoom 14) as the surface, with Mapbox satellite imagery (up to zoom 19,
// about 0.12 m a pixel) draped over it at whatever zoom the view needs
// (deck.gl's TerrainExtension). Only the tiles in view load.
//
// Mapbox's heights are smoothed here: a table may sit above or under its
// ground. Tables are placed by hand in the editor, as for Google's tiles.

export const TERRAIN_ID = "ground-terrain";
const IMAGERY_ID = "ground-imagery";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN?.trim() || null;
const token = MAPBOX_TOKEN ? `?access_token=${encodeURIComponent(MAPBOX_TOKEN)}` : "";
const HEIGHTS = `https://api.mapbox.com/v4/mapbox.mapbox-terrain-dem-v1/{z}/{x}/{y}.pngraw${token}`;
const IMAGERY = `https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90${token}`;

export const GROUND_CREDIT = "Elevation and imagery © Mapbox © Maxar";

/** Mapbox's heights are above sea level, the scene's above the ellipsoid
 *  (Google's tiles): the difference in western San Francisco. */
const ELLIPSOID_OFFSET = -32.94;

/** The ground's own color, seen only where its imagery has not arrived yet: a
 *  shadowed park green rather than white. */
const UNDER = [38, 44, 36] as [number, number, number];
/** The imagery carries its own light, as the tiles and scans do: show it as it is. */
const UNLIT = { ambient: 1, diffuse: 0, shininess: 0, specularColor: [0, 0, 0] as [number, number, number] };

/** The ground's layers: the terrain surface and the imagery draped over it. None without a Mapbox token. */
export async function loadGround(_tables: PicnicTable[]): Promise<Layer[]> {
  if (!MAPBOX_TOKEN) {
    console.error("No VITE_MAPBOX_TOKEN: the terrain ground needs Mapbox.");
    return [];
  }
  const surface = new TerrainLayer({
    id: TERRAIN_ID,
    // A surface for the imagery to drape over, drawn with it.
    operation: "terrain+draw",
    elevationData: HEIGHTS,
    // Mapbox Terrain-RGB: height = -10000 + (R·65536 + G·256 + B) · 0.1
    elevationDecoder: { rScaler: 6553.6, gScaler: 25.6, bScaler: 0.1, offset: -10000 + ELLIPSOID_OFFSET },
    tileSize: 512,
    maxZoom: 14,
    meshMaxError: 1,
    color: UNDER,
    material: UNLIT,
  });
  const imagery = new TileLayer<ImageBitmap>({
    id: IMAGERY_ID,
    data: IMAGERY,
    tileSize: 512,
    minZoom: 0,
    maxZoom: 19,
    // Pick tiles for the heights the ground is at, not sea level, so a view at
    // an angle is not left without tiles at its edges.
    zRange: [-40, 80],
    // Lit like the 3D tiles: the park bright, its border warm, the city dim.
    extensions: [new TerrainExtension(), new ParkLightExtension({ lngLat: true })],
    renderSubLayers: (props) => {
      const [[west, south], [east, north]] = props.tile.boundingBox;
      return new BitmapLayer({ ...props, data: undefined, image: props.data, bounds: [west, south, east, north] });
    },
  });
  return [surface, imagery];
}
