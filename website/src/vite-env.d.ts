/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google Maps key with the Map Tiles API enabled (Photorealistic 3D Tiles). */
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
}

declare module "virtual:tables" {
  import type { PicnicTable } from "./types";
  const tables: PicnicTable[];
  export default tables;
}
