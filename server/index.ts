import { Hono } from "hono";
import { cors } from "hono/cors";
import { join } from "path";
import { getAllTables, getTable, updateTable } from "./db";

const PROJECT_ROOT = join(import.meta.dir, "..");
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

app.get("/api/tables", (c) => {
  return c.json(getAllTables());
});

app.get("/api/tables/:id", (c) => {
  const id = Number(c.req.param("id"));
  const table = getTable(id);
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
