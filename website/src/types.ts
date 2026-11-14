/** One scan in model/, placed by model/tables.json (scripts/tables.ts). */
export interface PicnicTable {
  id: number;
  /** The table number: "7", or "15&16" for the pair. */
  num: string;
  /** "ggp-picnic-table-07.glb" */
  file: string;
  /** "ggp-picnic-table-07": also the name of its renders. */
  slug: string;
  longitude: number | null;
  latitude: number | null;
  altitude: number;
  rotation_x: number;
  rotation_y: number;
  rotation_z: number;
  scale_x: number;
  scale_y: number;
  scale_z: number;
  /** Quarter turn about the scan's up axis in its renders (scripts/render-orbits.ts). */
  render_rotation: number;
  /** Model-space bounds of the scan, [min, max]. */
  bounds: [number[], number[]] | null;
}

export interface UpdateTablePayload {
  longitude?: number | null;
  latitude?: number | null;
  altitude?: number;
  rotation_x?: number;
  rotation_y?: number;
  rotation_z?: number;
  scale_x?: number;
  scale_y?: number;
  scale_z?: number;
}
