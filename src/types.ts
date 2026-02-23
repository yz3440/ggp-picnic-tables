export interface PicnicTable {
  id: number;
  name: string;
  model_file: string;
  longitude: number | null;
  latitude: number | null;
  altitude: number;
  rotation_x: number;
  rotation_y: number;
  rotation_z: number;
  scale_x: number;
  scale_y: number;
  scale_z: number;
  created_at: string;
  updated_at: string;
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
