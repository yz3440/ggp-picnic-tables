import { Vector3 } from "@math.gl/core";
import { Ellipsoid } from "@math.gl/geospatial";
import { LayerExtension, SolidPolygonLayer, type Layer } from "deck.gl";
import type { PicnicTable } from "../types";
import { isPlaced, tableZ } from "./deck-world";

const D2R = Math.PI / 180;
/** How high above a table's ground the box reaches: Google's model of the
 *  table and its benches, not the trees over it. */
const BOX_HEIGHT = 3;
/** The cut starts this far above the scan's ground, so Google's own ground,
 *  where it is level with the scan's, stays (with nothing under it, cutting it
 *  would leave a hole) and only what stands on it is taken away. */
const CUT_ABOVE = 0.1;
/** The box reaches this far past the scan on every side, for when Google's
 *  model of the table stands a little off the scan. */
const MARGIN = 0.2;
/** Boxes a single tile is tested against: the nearest ones. */
const MAX_BOXES = 4;

/**
 * A box standing on a table's ground: the scan's footprint (and a margin),
 * from just above the bottom of the scan up BOX_HEIGHT. Google's tiles are not drawn inside it, so their own
 * model of the table no longer stands through the scan. In Earth-centered
 * (ECEF) coordinates.
 */
export interface CarveBox {
  center: Vector3;
  /** Unit vectors along the scan's width, along its length, and up. */
  across: Vector3;
  along: Vector3;
  up: Vector3;
  halfAcross: number;
  halfAlong: number;
  /** The scan's height, from its ground to the top of the table. */
  height: number;
}

/** One box per placed table whose scan's bounds are known (scripts/read-tables.ts). */
export function carveBoxes(tables: PicnicTable[]): CarveBox[] {
  const boxes: CarveBox[] = [];
  for (const t of tables) {
    if (!isPlaced(t) || !t.bounds) continue;
    const [min, max] = t.bounds;
    // The scan's ground: the bottom of its concrete pad.
    const ground = tableZ(t) + min[1] * t.scale_y;
    const origin = Ellipsoid.WGS84.cartographicToCartesian([t.longitude!, t.latitude!, ground], new Vector3());
    const enu = Ellipsoid.WGS84.eastNorthUpToFixedFrame(origin);
    // Every scan stands up the same way (roll 90°, pitch 0°): its x runs
    // east and its −z north, before its yaw turns them.
    const yaw = t.rotation_y * D2R;
    const across = new Vector3(Math.cos(yaw), Math.sin(yaw), 0);
    const along = new Vector3(-Math.sin(yaw), Math.cos(yaw), 0);
    const cx = ((min[0] + max[0]) / 2) * t.scale_x;
    const cz = ((min[2] + max[2]) / 2) * t.scale_z;
    const center = across.clone().scale(cx).add(along.clone().scale(-cz));
    boxes.push({
      center: new Vector3(enu.transformAsPoint(center)),
      across: new Vector3(enu.transformAsVector(across)).normalize(),
      along: new Vector3(enu.transformAsVector(along)).normalize(),
      up: new Vector3(enu.transformAsVector([0, 0, 1])).normalize(),
      halfAcross: ((max[0] - min[0]) / 2) * t.scale_x + MARGIN,
      halfAlong: ((max[2] - min[2]) / 2) * t.scale_z + MARGIN,
      height: (max[1] - min[1]) * t.scale_y,
    });
  }
  return boxes;
}

/** The floors only show in the thin margin around each scan's concrete pad,
 *  so they take a muted concrete gray. */
const FLOOR_COLOR: [number, number, number] = [112, 110, 102];

/** The floor sits just under the scan's concrete pad, and covers the cut and
 *  no more. (Larger and deeper, it showed through Google's ground wherever
 *  that dips below a flat plane, which on the meadow's slopes is often.) */
const FLOOR_BELOW = 0.02;
const FLOOR_REACH = 0;

/**
 * A floor under each cut. Where Google's ground stands higher than the scan's,
 * cutting it opens a hole down to nothing; the floor closes it.
 */
export function carveFloorLayer(boxes: CarveBox[]) {
  const corners = (b: CarveBox) =>
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([i, j]) => {
      const p = b.center
        .clone()
        .add(b.across.clone().scale(i * (b.halfAcross + FLOOR_REACH)))
        .add(b.along.clone().scale(j * (b.halfAlong + FLOOR_REACH)))
        .add(b.up.clone().scale(-FLOOR_BELOW));
      return Ellipsoid.WGS84.cartesianToCartographic(p, new Vector3()).toArray() as [number, number, number];
    });
  return new SolidPolygonLayer<CarveBox>({
    id: "carve-floors",
    data: boxes,
    getPolygon: corners,
    getFillColor: FLOOR_COLOR,
  });
}

// Each box, in the tile's meters east-north-up: a = [center e, center n,
// cos, sin of its width's direction], b = [half width, half length, bottom, top].
const uniformTypes: Record<string, "vec4<f32>" | "f32"> = { count: "f32" };
for (let i = 0; i < MAX_BOXES; i++) {
  uniformTypes[`a${i}`] = "vec4<f32>";
  uniformTypes[`b${i}`] = "vec4<f32>";
}

const carveModule = {
  name: "carve",
  uniformTypes,
  fs: /* glsl */ `
uniform carveUniforms {
  float count;
  ${Array.from({ length: MAX_BOXES }, (_, i) => `vec4 a${i};\n  vec4 b${i};`).join("\n  ")}
} carve;

bool carve_inBox(vec3 p, vec4 a, vec4 b) {
  vec2 d = p.xy - a.xy;
  return abs(dot(d, a.zw)) < b.x && abs(dot(d, vec2(-a.w, a.z))) < b.y && p.z > b.z && p.z < b.w;
}

bool carve_inside(vec3 p) {
  ${Array.from({ length: MAX_BOXES }, (_, i) => `if (carve.count > ${i}.5 && carve_inBox(p, carve.a${i}, carve.b${i})) return true;`).join("\n  ")}
  return false;
}
`,
};

/**
 * Leaves out every pixel of Google's 3D tiles that falls inside a table's box.
 * Per pixel, so it does not depend on how coarse the tiles' triangles are.
 * Put it on the Tile3DLayer; it reaches each tile's ScenegraphLayer, whose
 * points are meter offsets east-north-up from the tile's origin.
 */
export class CarveExtension extends LayerExtension {
  static extensionName = "CarveExtension";
  static defaultProps = { carveBoxes: { type: "array", value: [], compare: false } };

  getShaders() {
    return {
      modules: [carveModule],
      inject: {
        "vs:#decl": "out vec3 carve_position;",
        // The tiles are meter offsets from the tile's origin: undo deck's
        // meters-to-common-units scale to get the point back in meters.
        "vs:DECKGL_FILTER_GL_POSITION": "carve_position = geometry.position.xyz / project.commonUnitsPerWorldUnit;",
        "fs:#decl": "in vec3 carve_position;",
        "fs:DECKGL_FILTER_COLOR": "if (carve_inside(carve_position)) discard;",
      },
    };
  }

  draw(this: Layer<{ carveBoxes?: CarveBox[]; coordinateOrigin?: number[] }>) {
    const boxes = this.props.carveBoxes ?? [];
    const origin = this.props.coordinateOrigin;
    const props: Record<string, number | number[]> = { count: 0 };
    if (origin && boxes.length) {
      // ECEF → this tile's meters east-north-up, worked out in double precision
      // so the GPU only ever sees small numbers.
      const toTile = Ellipsoid.WGS84.eastNorthUpToFixedFrame(
        Ellipsoid.WGS84.cartographicToCartesian(origin, new Vector3()),
      ).invert();
      const near = boxes
        .map((b) => ({ b, c: new Vector3(toTile.transformAsPoint(b.center)) }))
        .sort((x, y) => x.c.len() - y.c.len())
        .slice(0, MAX_BOXES);
      near.forEach(({ b, c }, i) => {
        const dir = new Vector3(toTile.transformAsVector(b.across));
        const flat = Math.hypot(dir.x, dir.y) || 1;
        props[`a${i}`] = [c.x, c.y, dir.x / flat, dir.y / flat];
        props[`b${i}`] = [b.halfAcross, b.halfAlong, c.z + CUT_ABOVE, c.z + BOX_HEIGHT];
      });
      props.count = near.length;
    }
    for (let i = props.count as number; i < MAX_BOXES; i++) {
      props[`a${i}`] = [0, 0, 1, 0];
      props[`b${i}`] = [0, 0, 0, 0];
    }
    this.setShaderModuleProps({ carve: props });
  }
}
