import { Hono } from "hono";
import { cors } from "hono/cors";
import { join } from "path";
import { readTables, updateTable } from "../../scripts/tables";

// model/ and renders/ sit at the repository root, beside website/.
const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const app = new Hono();

app.use("/api/*", cors());

app.get("/model/:filename{.+\\.glb$}", async (c) => {
  const filename = decodeURIComponent(c.req.param("filename"));
  const file = Bun.file(join(PROJECT_ROOT, "model", filename));
  if (!(await file.exists())) return c.json({ error: "Not found" }, 404);
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Content-Type", "model/gltf-binary");
  c.header("Content-Length", String(file.size));
  return c.body(file.stream());
});

app.get("/renders/:filename{.+\\.(mp4|jpg)$}", async (c) => {
  const filename = decodeURIComponent(c.req.param("filename"));
  const file = Bun.file(join(PROJECT_ROOT, "renders", filename));
  if (!(await file.exists())) return c.json({ error: "Not found" }, 404);
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
    return c.body(file.slice(start, end + 1).stream(), 206);
  }
  c.header("Content-Length", String(file.size));
  return c.body(file.stream());
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
console.log(`Server running on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
