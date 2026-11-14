import type { Plugin } from "vite";
import { MODEL_DIR, readTables } from "../scripts/tables";
import { join } from "path";

/** `import tables from "virtual:tables"`: the tables from model/ at build time. */
export function tablesPlugin(): Plugin {
  const VIRTUAL_ID = "virtual:tables";
  const RESOLVED_ID = "\0" + VIRTUAL_ID;
  return {
    name: "picnic-tables",
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    load(id) {
      if (id !== RESOLVED_ID) return;
      this.addWatchFile(join(MODEL_DIR, "tables.json"));
      return `export default ${JSON.stringify(readTables())};`;
    },
  };
}
