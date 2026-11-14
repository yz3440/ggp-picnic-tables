import type { PicnicTable, UpdateTablePayload } from "../../types";

const BASE = "/api";

export async function fetchTables(): Promise<PicnicTable[]> {
  const res = await fetch(`${BASE}/tables`);
  if (!res.ok) throw new Error("Failed to fetch tables");
  return res.json();
}

export async function fetchTable(id: number): Promise<PicnicTable> {
  const res = await fetch(`${BASE}/tables/${id}`);
  if (!res.ok) throw new Error("Failed to fetch table");
  return res.json();
}

export async function updateTable(
  id: number,
  data: UpdateTablePayload
): Promise<PicnicTable> {
  const res = await fetch(`${BASE}/tables/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update table");
  return res.json();
}
