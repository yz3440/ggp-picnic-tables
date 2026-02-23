import { Database } from "bun:sqlite";
import { readdirSync, unlinkSync, existsSync } from "fs";
import { join, basename } from "path";

const DB_PATH = join(import.meta.dir, "..", "data.sqlite");
const MODEL_DIR = join(import.meta.dir, "..", "model");

function openDb(): Database {
  try {
    const d = new Database(DB_PATH, { create: true });
    d.exec("PRAGMA journal_mode = WAL;");
    return d;
  } catch {
    console.warn("Corrupt database detected, recreating...");
    for (const suffix of ["", "-wal", "-shm"]) {
      const p = DB_PATH + suffix;
      if (existsSync(p)) unlinkSync(p);
    }
    const d = new Database(DB_PATH, { create: true });
    d.exec("PRAGMA journal_mode = WAL;");
    return d;
  }
}

const db = openDb();

db.exec(`
  CREATE TABLE IF NOT EXISTS picnic_tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    model_file TEXT NOT NULL,
    longitude REAL,
    latitude REAL,
    altitude REAL DEFAULT 0,
    rotation_x REAL DEFAULT 0,
    rotation_y REAL DEFAULT 0,
    rotation_z REAL DEFAULT 0,
    scale_x REAL DEFAULT 1,
    scale_y REAL DEFAULT 1,
    scale_z REAL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

function seed() {
  const existing = db.query("SELECT COUNT(*) as count FROM picnic_tables").get() as { count: number };
  if (existing.count > 0) return;

  const files = readdirSync(MODEL_DIR).filter((f) => f.endsWith(".glb"));
  const insert = db.prepare(
    "INSERT INTO picnic_tables (name, model_file) VALUES (?, ?)"
  );

  for (const file of files) {
    const name = basename(file, ".glb");
    insert.run(name, `model/${file}`);
  }

  console.log(`Seeded ${files.length} picnic tables`);
}

seed();

export interface PicnicTableRow {
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

export function getAllTables(): PicnicTableRow[] {
  const rows = db.query("SELECT * FROM picnic_tables").all() as PicnicTableRow[];
  return rows.sort((a, b) => {
    const numA = parseInt(a.name.replace(/\D+/g, "")) || 0;
    const numB = parseInt(b.name.replace(/\D+/g, "")) || 0;
    return numA - numB;
  });
}

export function getTable(id: number): PicnicTableRow | null {
  return db.query("SELECT * FROM picnic_tables WHERE id = ?").get(id) as PicnicTableRow | null;
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

export function updateTable(id: number, data: UpdateTablePayload): PicnicTableRow | null {
  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) return getTable(id);

  fields.push("updated_at = datetime('now')");
  values.push(id);

  db.query(`UPDATE picnic_tables SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getTable(id);
}

export default db;
