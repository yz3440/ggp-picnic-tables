import type { PicnicTable } from "../types";

export function renderUrl(table: PicnicTable, ext: "jpg" | "mp4") {
  return `/renders/${table.slug}.${ext}`;
}

/** The small versions of the renders the cards use (scripts/make-previews.ts). */
export function previewUrl(table: PicnicTable, ext: "jpg" | "mp4") {
  return `/renders/preview/${table.slug}.${ext}`;
}

export function modelUrl(table: PicnicTable) {
  return `/model/${table.file}`;
}

export function tableNum(table: PicnicTable) {
  return table.num;
}

export function padNum(n: string | number) {
  return String(n).padStart(2, "0");
}

/** "table 07", or "tables 15 & 16" for the pair, numbered like the files. */
export function tableTitle(table: PicnicTable) {
  const n = tableNum(table);
  return n.includes("&") ? `tables ${n.split("&").map(padNum).join(" & ")}` : `table ${padNum(n)}`;
}

/** The map tag: "07", "15–16". */
export function tableTag(table: PicnicTable) {
  return tableNum(table).split("&").map(padNum).join("–");
}

/** The address of an open table: #table-7, #table-15-16. */
export function tableSlug(table: PicnicTable) {
  return tableNum(table).replace(/\D+/g, "-");
}

const minus = (s: string) => s.replace("-", "−");

export function formatCoords(table: PicnicTable) {
  if (table.latitude == null || table.longitude == null) return "Not placed";
  return `${minus(table.latitude.toFixed(5))}, ${minus(table.longitude.toFixed(5))}`;
}

export function formatDegrees(deg: number) {
  return `${minus(deg.toFixed(1))}°`;
}
