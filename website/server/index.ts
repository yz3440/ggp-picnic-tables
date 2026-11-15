import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { createReadStream, statSync } from "fs";
import { join } from "path";
import { Readable } from "stream";
import { readTables, updateTable } from "../../scripts/tables";

// model/ and renders/ sit at the repository root, beside website/.
const PROJECT_ROOT = join(import.meta.dirname, "..", "..");
const app = new Hono();

/** A file under model/ or renders/: its path and size, or null if there is none. */
function find(dir: string, filename: string) {
  if (filename.includes("..")) return null;
  const path = join(PROJECT_ROOT, dir, filename);
  try {
    const s = statSync(path);
    return s.isFile() ? { path, size: s.size } : null;
  } catch {
    return null;
  }
}

/** The file (or the bytes start to end, inclusive) as a web stream. */
const stream = (path: string, start?: number, end?: number) =>
  Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;

app.use("/api/*", cors());

app.get("/model/:filename{.+\\.glb$}", (c) => {
  const filename = decodeURIComponent(c.req.param("filename"));
  const file = find("model", filename);
  if (!file) return c.json({ error: "Not found" }, 404);
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Content-Type", "model/gltf-binary");
  c.header("Content-Length", String(file.size));
  return c.body(stream(file.path));
});

app.get("/renders/:filename{.+\\.(mp4|jpg)$}", (c) => {
  const filename = decodeURIComponent(c.req.param("filename"));
  const file = find("renders", filename);
  if (!file) return c.json({ error: "Not found" }, 404);
  const ext = filename.split(".").pop();
  c.header("Content-Type", ext === "mp4" ? "video/mp4" : "image/jpeg");
  c.header("Accept-Ranges", "bytes");
  // Video players ask for byte ranges, and stall when the whole file comes back.
  const range = c.req.header("Range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, file.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), file.size - 1) : file.size - 1;
    if (start > end || start >= file.size) {
      c.header("Content-Range", `bytes */${file.size}`);
      return c.body(null, 416);
    }
    c.header("Content-Range", `bytes ${start}-${end}/${file.size}`);
    c.header("Content-Length", String(end - start + 1));
    return c.body(stream(file.path, start, end), 206);
  }
  c.header("Content-Length", String(file.size));
  return c.body(stream(file.path));
});

app.get("/api/tables", (c) => {
  return c.json(readTables());
});

app.get("/api/tables/:id", (c) => {
  const id = Number(c.req.param("id"));
  const table = readTables().find((t) => t.id === id);
  if (!table) return c.json({ error: "Not found" }, 404);
  return c.json(table);
});

app.put("/api/tables/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  const updated = updateTable(id, body);
  if (!updated) return c.json({ error: "Not found" }, 404);
  return c.json(updated);
});

const port = Number(process.env.PORT) || 3001;
serve({ fetch: app.fetch, port }, () => console.log(`Server running on http://localhost:${port}`));
