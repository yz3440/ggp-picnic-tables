import { Vector3 } from "@math.gl/core";
import { Ellipsoid } from "@math.gl/geospatial";
import { LayerExtension, type Layer } from "deck.gl";
import type { CarveBox } from "./carve";

/** Each table's box reaches this far above the top of the table. */
const ABOVE_TABLE = 0.3;
/** The opening grows soft over this many meters around each table's box. */
const SOFT_EDGE = 0.8;
/** Nothing lower than this above a table's ground is ghosted: the ground at
 *  the table's own level, which has nothing under it to see. */
const KEEP_BELOW = 0.3;
/** Of a ghosted surface, this share of its pixels is still drawn. */
const GHOST = 0.12;
/** The outline: drawn where a ghosted surface turns edge-on to the camera. */
const OUTLINE_COLOR = [0.86, 0.92, 0.8];
const OUTLINE_FROM = 0.72;
const OUTLINE_TO = 0.93;
/** Tables a single tile is tested against: the nearest ones. */
const MAX_TABLES = 6;

/** The tables' boxes, and whether to open them (only while a table is open).
 *  The scene changes `active`; the extension reads it on every draw, so it is
 *  one object shared for the life of the layer. */
export interface SeeThrough {
  active: boolean;
  boxes: CarveBox[];
}

const uniformTypes: Record<string, "vec3<f32>" | "vec4<f32>" | "f32"> = { camera: "vec3<f32>", count: "f32" };
for (let i = 0; i < MAX_TABLES; i++) {
  uniformTypes[`a${i}`] = "vec4<f32>";
  uniformTypes[`b${i}`] = "vec4<f32>";
}

const seeThroughModule = {
  name: "seeThrough",
  uniformTypes,
  fs: /* glsl */ `
uniform seeThroughUniforms {
  vec3 camera;
  float count;
  ${Array.from({ length: MAX_TABLES }, (_, i) => `vec4 a${i};\n  vec4 b${i};`).join("\n  ")}
} seeThrough;

// Does the line of sight from the camera through p (p at t = 1) pass through
// the box behind p? A box: a = [center x, y, cos, sin of its width's
// direction], b = [half width, half length, bottom, top], grown by \`grow\`.
bool seeThrough_hides(vec3 p, vec4 a, vec4 b, float grow) {
  vec2 u = a.zw;
  vec2 v = vec2(-a.w, a.z);
  vec2 rel = seeThrough.camera.xy - a.xy;
  vec3 o = vec3(dot(rel, u), dot(rel, v), seeThrough.camera.z);
  vec3 d3 = p - seeThrough.camera;
  vec3 d = vec3(dot(d3.xy, u), dot(d3.xy, v), d3.z);
  d = vec3(d.x >= 0.0 ? max(d.x, 1e-6) : min(d.x, -1e-6),
           d.y >= 0.0 ? max(d.y, 1e-6) : min(d.y, -1e-6),
           d.z >= 0.0 ? max(d.z, 1e-6) : min(d.z, -1e-6));
  vec3 lo = vec3(-b.x - grow, -b.y - grow, b.z);
  vec3 hi = vec3(b.x + grow, b.y + grow, b.w + grow);
  vec3 t0 = (lo - o) / d;
  vec3 t1 = (hi - o) / d;
  vec3 tn = min(t0, t1);
  vec3 tf = max(t0, t1);
  float enter = max(max(tn.x, tn.y), tn.z);
  float leave = min(min(tf.x, tf.y), tf.z);
  return leave >= enter && enter > 1.0;
}

// How ghosted a point is: 1 if it stands between the camera and a table's
// box, fading out over SOFT_EDGE around the box's outline on screen.
float seeThrough_box(vec3 p, vec4 a, vec4 b) {
  if (p.z < b.z + ${KEEP_BELOW.toFixed(2)}) return 0.0;
  float n = 0.0;
  if (seeThrough_hides(p, a, b, ${(SOFT_EDGE * 0.15).toFixed(3)})) n += 1.0;
  if (seeThrough_hides(p, a, b, ${(SOFT_EDGE * 0.5).toFixed(3)})) n += 1.0;
  if (seeThrough_hides(p, a, b, ${SOFT_EDGE.toFixed(3)})) n += 1.0;
  return n / 3.0;
}

float seeThrough_amount(vec3 p) {
  float m = 0.0;
  ${Array.from({ length: MAX_TABLES }, (_, i) => `if (seeThrough.count > ${i}.5) m = max(m, seeThrough_box(p, seeThrough.a${i}, seeThrough.b${i}));`).join("\n  ")}
  return m;
}

// A fixed noise per screen pixel, to dissolve with (screen-door transparency:
// the tiles are opaque, and drawing them see-through would get their order wrong).
float seeThrough_noise() {
  return fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
}

// Ghost a surface in front of a table: keep a fine share of its pixels, and
// draw its outline solid. The outline is where the surface turns edge-on to
// the camera (its normal, from the screen-space slope of its position, at
// right angles to the line of sight): the silhouettes of leaves and branches.
vec4 seeThrough_filter(vec4 color, vec3 p) {
  float a = seeThrough_amount(p);
  if (a <= 0.0) return color;
  vec3 n = normalize(cross(dFdx(p), dFdy(p)));
  vec3 view = normalize(p - seeThrough.camera);
  float edge = smoothstep(${OUTLINE_FROM.toFixed(2)}, ${OUTLINE_TO.toFixed(2)}, 1.0 - abs(dot(n, view)));
  float keep = mix(1.0, max(${GHOST.toFixed(2)}, edge), a);
  if (seeThrough_noise() > keep) discard;
  return vec4(mix(color.rgb, vec3(${OUTLINE_COLOR.map((c) => c.toFixed(2)).join(", ")}), edge * a * 0.85), color.a);
}
`,
};

/**
 * Ghosts the 3D tiles that stand between the camera and the tables, as games
 * do when a wall hides the player: each table gets a rectangular opening, its
 * own box seen from the camera, through which trees and roofs in the way turn
 * see-through with only their outlines drawn solid. Put it on the Tile3DLayer
 * with a `seeThrough` object; it reaches each tile's ScenegraphLayer, whose
 * points are meter offsets east-north-up from the tile's origin.
 */
export class SeeThroughExtension extends LayerExtension {
  static extensionName = "SeeThroughExtension";
  static defaultProps = { seeThrough: { type: "object", value: null, compare: false } };

  getShaders() {
    return {
      modules: [seeThroughModule],
      inject: {
        "vs:#decl": "out vec3 seeThrough_position;",
        "vs:DECKGL_FILTER_GL_POSITION": "seeThrough_position = geometry.position.xyz / project.commonUnitsPerWorldUnit;",
        "fs:#decl": "in vec3 seeThrough_position;",
        "fs:DECKGL_FILTER_COLOR": "color = seeThrough_filter(color, seeThrough_position);",
      },
    };
  }

  draw(
    this: Layer<{ seeThrough?: SeeThrough | null; coordinateOrigin?: number[] }>,
    { shaderModuleProps }: { shaderModuleProps: { project?: { viewport?: unknown } } },
  ) {
    const st = this.props.seeThrough;
    const origin = this.props.coordinateOrigin;
    // The viewport of the view being drawn.
    const viewport = shaderModuleProps.project?.viewport as
      | { cameraPosition: number[]; unprojectPosition(p: number[]): number[] }
      | undefined;
    const props: Record<string, number | number[]> = { count: 0, camera: [0, 0, 0] };
    if (st?.active && st.boxes.length && origin && viewport) {
      // Everything into this tile's meters east-north-up, in double precision.
      const toTile = Ellipsoid.WGS84.eastNorthUpToFixedFrame(
        Ellipsoid.WGS84.cartographicToCartesian(origin, new Vector3()),
      ).invert();
      const [lon, lat, z] = viewport.unprojectPosition(viewport.cameraPosition);
      props.camera = [...toTile.transformAsPoint(Ellipsoid.WGS84.cartographicToCartesian([lon, lat, z], new Vector3()))];
      const near = st.boxes
        .map((b) => ({ b, c: new Vector3(toTile.transformAsPoint(b.center)) }))
        .sort((x, y) => x.c.len() - y.c.len())
        .slice(0, MAX_TABLES);
      near.forEach(({ b, c }, i) => {
        const dir = new Vector3(toTile.transformAsVector(b.across));
        const flat = Math.hypot(dir.x, dir.y) || 1;
        props[`a${i}`] = [c.x, c.y, dir.x / flat, dir.y / flat];
        props[`b${i}`] = [b.halfAcross, b.halfAlong, c.z, c.z + b.height + ABOVE_TABLE];
      });
      props.count = near.length;
    }
    for (let i = props.count as number; i < MAX_TABLES; i++) {
      props[`a${i}`] = [0, 0, 1, 0];
      props[`b${i}`] = [0, 0, 0, 0];
    }
    this.setShaderModuleProps({ seeThrough: props });
  }
}
