import { LayerExtension, type Layer } from "deck.gl";
import park from "../data/golden-gate-park.json";

// How the 3D tiles are lit. Multipliers on their color: outside the park,
// inside it, and how much warm light the park's border adds.
const OUTSIDE = 0.45;
const INSIDE = 0.8;
const BORDER = 0.55;
const BORDER_COLOR = [1.0, 0.93, 0.78];
/** The light fades in over this many meters either side of the border line. */
const BORDER_WIDTH_M = 18;
/** Room around the park in the mask, so the outside fades to OUTSIDE cleanly. */
const MARGIN_M = 200;
const MASK_WIDTH = 4096;

const D2R = Math.PI / 180;
const [w0, s0, e0, n0] = park.bbox;
const midLat = (s0 + n0) / 2;
const mPerLon = 111320 * Math.cos(midLat * D2R);
const mPerLat = 111320;
const west = w0 - MARGIN_M / mPerLon;
const east = e0 + MARGIN_M / mPerLon;
const south = s0 - MARGIN_M / mPerLat;
const north = n0 + MARGIN_M / mPerLat;
const pxPerM = MASK_WIDTH / ((east - west) * mPerLon);
const MASK_HEIGHT = Math.round((north - south) * mPerLat * pxPerM);

/**
 * The park as a picture: red is inside (softened at the edge), green the
 * border's glow. Drawn once, from the OpenStreetMap outline.
 */
function drawMask(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = MASK_WIDTH;
  canvas.height = MASK_HEIGHT;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, MASK_WIDTH, MASK_HEIGHT);
  const path = new Path2D();
  park.ring.forEach(([lon, lat], i) => {
    const x = ((lon - west) / (east - west)) * MASK_WIDTH;
    const y = ((north - lat) / (north - south)) * MASK_HEIGHT;
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  });
  path.closePath();
  const blur = BORDER_WIDTH_M * pxPerM;
  ctx.globalCompositeOperation = "lighter";
  ctx.filter = `blur(${(blur / 2).toFixed(1)}px)`;
  ctx.fillStyle = "#f00";
  ctx.fill(path);
  ctx.filter = `blur(${blur.toFixed(1)}px)`;
  ctx.strokeStyle = "#0f0";
  ctx.lineWidth = blur;
  ctx.stroke(path);
  ctx.filter = "none";
  ctx.lineWidth = Math.max(1.5, 2 * pxPerM);
  ctx.stroke(path);
  return canvas;
}

let mask: HTMLCanvasElement | null = null;
const textures = new WeakMap<object, unknown>();

/** One mask texture per GPU device, shared by every tile. */
function maskTexture(device: { createTexture(props: object): unknown }) {
  let texture = textures.get(device);
  if (!texture) {
    mask ??= drawMask();
    texture = device.createTexture({
      data: mask,
      width: MASK_WIDTH,
      height: MASK_HEIGHT,
      sampler: { minFilter: "linear", magFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" },
    });
    textures.set(device, texture);
  }
  return texture;
}

const parkLightModule = {
  name: "parkLight",
  uniformTypes: { uvOrigin: "vec2<f32>", uvPerMeter: "vec2<f32>" } as const,
  getUniforms: (opts: Record<string, unknown> = {}) => {
    const { maskMap, ...rest } = opts;
    return maskMap ? { ...rest, parkLight_mask: maskMap } : rest;
  },
  fs: /* glsl */ `
uniform parkLightUniforms {
  vec2 uvOrigin;
  vec2 uvPerMeter;
} parkLight;

uniform sampler2D parkLight_mask;

vec3 parkLight_apply(vec3 color, vec2 uv) {
  vec2 m = (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec2(0.0) : texture(parkLight_mask, uv).rg;
  vec3 lit = color * mix(${OUTSIDE.toFixed(3)}, ${INSIDE.toFixed(3)}, m.r);
  return lit + vec3(${BORDER_COLOR.map((c) => c.toFixed(3)).join(", ")}) * m.g * ${BORDER.toFixed(3)};
}
`,
};

const deg = (v: number) => v.toFixed(8);

/**
 * Dims the ground and lights up Golden Gate Park, brightest along its border:
 * the same light on every kind of ground the viewer shows.
 *
 * By default for Google's 3D tiles: put it on the Tile3DLayer; it reaches each
 * tile's ScenegraphLayer, whose points are meter offsets east-north-up from
 * the tile's origin, and maps those onto the park mask with a per-tile offset
 * and scale. With `{ lngLat: true }`, for layers placed in longitude and
 * latitude (the satellite and terrain imagery's BitmapLayers), which reads
 * each point's own longitude and latitude instead.
 */
export class ParkLightExtension extends LayerExtension<{ lngLat?: boolean }> {
  static extensionName = "ParkLightExtension";

  getShaders(this: Layer, extension: this) {
    // deck.gl leaves opts undefined when the extension is made without any.
    const lngLat = Boolean(extension.opts?.lngLat);
    // One value carried to the fragment shader, whichever kind it is: Google's
    // tiles already use nearly every varying a GPU allows, and one more stops
    // their shader from linking (they then draw nothing).
    const position = lngLat ? "geometry.worldPosition.xy" : "geometry.position.xy / project.commonUnitsPerWorldUnit.xy";
    const uv = lngLat
      ? `vec2((parkLight_position.x - (${deg(west)})) / ${deg(east - west)}, (${deg(north)} - parkLight_position.y) / ${deg(north - south)})`
      : "parkLight.uvOrigin + parkLight_position * parkLight.uvPerMeter";
    return {
      modules: [parkLightModule],
      inject: {
        "vs:#decl": "out vec2 parkLight_position;",
        "vs:DECKGL_FILTER_GL_POSITION": `parkLight_position = ${position};`,
        "fs:#decl": "in vec2 parkLight_position;",
        "fs:DECKGL_FILTER_COLOR": `color.rgb = parkLight_apply(color.rgb, ${uv});`,
      },
    };
  }

  draw(this: Layer<{ coordinateOrigin?: number[] }>) {
    const origin = this.props.coordinateOrigin ?? [0, 0, 0];
    const [lon, lat] = origin;
    const metersPerLon = 111320 * Math.cos(lat * D2R);
    this.setShaderModuleProps({
      parkLight: {
        uvOrigin: [(lon - west) / (east - west), (north - lat) / (north - south)],
        uvPerMeter: [1 / ((east - west) * metersPerLon), -1 / ((north - south) * mPerLat)],
        maskMap: maskTexture(this.context.device as never),
      },
    });
  }
}

/** The outline's source, to credit next to the map. */
export const PARK_CREDIT = "Park outline © OpenStreetMap contributors";
