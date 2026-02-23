/// <reference types="vite/client" />

declare module "virtual:tables" {
  import type { PicnicTable } from "./types";
  const tables: PicnicTable[];
  export default tables;
}
