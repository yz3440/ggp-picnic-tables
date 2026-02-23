import { Database } from "bun:sqlite";
import { join } from "path";

const dbPath = join(import.meta.dir, "..", "data.sqlite");
const db = new Database(dbPath, { readonly: true });
const rows = db.query("SELECT * FROM picnic_tables").all() as {
  name: string;
}[];
db.close();

rows.sort((a, b) => {
  const numA = parseInt(a.name.replace(/\D+/g, "")) || 0;
  const numB = parseInt(b.name.replace(/\D+/g, "")) || 0;
  return numA - numB;
});

console.log(JSON.stringify(rows));
