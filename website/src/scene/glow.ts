import { IconLayer } from "deck.gl";
import type { PicnicTable } from "../types";
import { isPlaced, tableZ } from "./deck-world";

// The tables start to glow once they are too small to make out: the glow
// fades in between these two zooms (each zoom step halves the distance).
// At zoom 19.5 a table is about 40 px long; at 17.5, about 10.
const GLOW_FROM_ZOOM = 19.5;
const GLOW_FULL_ZOOM = 17.5;
/** The glow's size on screen, in pixels: largest as it comes in, then
 *  smaller further out, so the tables stay apart instead of running together. */
const GLOW_SIZE = 46;
const GLOW_MIN_SIZE = 18;
const GLOW_COLOR: [number, number, number] = [255, 226, 160];

/** How strongly the tables glow at a zoom: 0 close in, 1 far out. */
export function glowStrength(zoom: number) {
  const k = (GLOW_FROM_ZOOM - zoom) / (GLOW_FROM_ZOOM - GLOW_FULL_ZOOM);
  return Math.min(1, Math.max(0, k));
}

/** The glow's size at a zoom, in pixels. */
export function glowSize(zoom: number) {
  const grow = GLOW_SIZE * (0.6 + 0.4 * glowStrength(zoom));
  const shrink = GLOW_SIZE * Math.pow(2, (zoom - GLOW_FULL_ZOOM) * 0.4);
  return Math.round(Math.max(GLOW_MIN_SIZE, Math.min(grow, shrink)));
}

let sprite: HTMLCanvasElement | null = null;

/** A soft round light, white in the middle and fading to nothing. */
function glowSprite() {
  if (sprite) return sprite;
  const size = 128;
  sprite = document.createElement("canvas");
  sprite.width = sprite.height = size;
  const ctx = sprite.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.18, "rgba(255,255,255,0.85)");
  g.addColorStop(0.45, "rgba(255,255,255,0.3)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return sprite;
}

/**
 * A glow around each table, drawn over the tiles (trees included) and added to
 * what is behind it, so the tables can be found from far out. Drawn before the
 * scans, so a scan in view stays on top of its own glow.
 */
export function glowLayer(tables: PicnicTable[], strength: number, size: number) {
  return new IconLayer<PicnicTable>({
    id: "table-glow",
    data: tables.filter(isPlaced),
    visible: strength > 0.01,
    iconAtlas: glowSprite() as never,
    iconMapping: { glow: { x: 0, y: 0, width: 128, height: 128, mask: true } },
    getIcon: () => "glow",
    getPosition: (t) => [t.longitude!, t.latitude!, tableZ(t) + 0.6],
    getColor: [...GLOW_COLOR, Math.round(255 * strength)],
    getSize: size,
    sizeUnits: "pixels",
    billboard: true,
    updateTriggers: { getColor: strength, getSize: size },
    parameters: {
      depthCompare: "always",
      depthWriteEnabled: false,
      blendColorSrcFactor: "src-alpha",
      blendColorDstFactor: "one",
      blendAlphaSrcFactor: "one",
      blendAlphaDstFactor: "one",
    },
  });
}
