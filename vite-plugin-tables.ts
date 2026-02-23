import { execSync } from "child_process";
import { join } from "path";
import type { Plugin } from "vite";

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
      const scriptPath = join(process.cwd(), "scripts", "read-tables.ts");
      const json = execSync(`bun run ${scriptPath}`, {
        encoding: "utf-8",
        cwd: process.cwd(),
      }).trim();
      return `export default ${json};`;
    },
  };
}
