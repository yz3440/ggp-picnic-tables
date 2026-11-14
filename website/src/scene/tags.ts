/**
 * The editor's tags: DOM elements over a map view. Move each onto its table,
 * nudging neighbors (19 and 20 stand 4 m apart) sideways so none covers another.
 * `project` gives a tag's position in the view's pixels, or null when it is
 * off screen; `rect` is the view's size, or null when the view is hidden.
 */
export function positionTags(
  tags: Map<number, HTMLElement>,
  project: (id: number) => [number, number] | null,
  rect: { width: number; height: number } | null,
) {
  const shown: { el: HTMLElement; x: number; y: number; w: number; h: number }[] = [];
  for (const [id, el] of tags) {
    const p = rect ? project(id) : null;
    const inside = !!p && p[0] >= -10 && p[1] >= -10 && p[0] <= rect!.width + 10 && p[1] <= rect!.height + 10;
    el.style.visibility = inside ? "visible" : "hidden";
    if (!inside) continue;
    shown.push({ el, x: p![0], y: p![1], w: el.offsetWidth, h: el.offsetHeight });
  }
  shown.sort((a, b) => a.x - b.x);
  for (let i = 0; i < shown.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = shown[j];
      const b = shown[i];
      const gap = (a.w + b.w) / 2 + 2;
      if (Math.abs(b.y - a.y) < (a.h + b.h) / 2 + 2 && b.x - a.x < gap) b.x = a.x + gap;
    }
  }
  for (const t of shown) {
    t.el.style.transform = `translate(${t.x.toFixed(1)}px, ${t.y.toFixed(1)}px) translate(-50%, -50%)`;
  }
}

/** Label bottom to dot, in pixels. */
const STEM = 12;
/** Space kept between two labels. */
const GAP = 3;
/** Dots closer than this merge into one. */
const MERGE = 8;
/** Keep labels this far inside the view. */
const EDGE = 4;

const SVG = "http://www.w3.org/2000/svg";

interface Label {
  id: number;
  el: HTMLElement;
  /** The table's own position. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Where the label goes (its center). */
  lx: number;
  ly: number;
  dot: Dot;
  lit: boolean;
}
interface Dot {
  x: number;
  y: number;
  n: number;
  lit: boolean;
}

/**
 * The archive map's tags as callouts. Every table gets a dot exactly where it
 * stands; its label sits above the dot on a short leader line. Labels that
 * would cover each other share one row, spread just far enough apart and
 * moved as little as possible, so zoomed out they fan out above the park with
 * every line still running to the right place. Dots that overlap merge.
 *
 * Elements marked data-dot (the minimap's other tables) are dots themselves
 * and go exactly onto their tables. data-lit draws a label's line in the accent.
 * The lines and dots are drawn into `layer`, an SVG laid over the map.
 */
export function layoutCallouts(
  tags: Map<number, HTMLElement>,
  project: (id: number) => [number, number] | null,
  rect: { width: number; height: number } | null,
  layer: SVGSVGElement | null,
) {
  const labels: Label[] = [];
  for (const [id, el] of tags) {
    const p = rect ? project(id) : null;
    const inside = !!p && p[0] >= -10 && p[1] >= -10 && p[0] <= rect!.width + 10 && p[1] <= rect!.height + 10;
    el.style.visibility = inside ? "visible" : "hidden";
    if (!inside) continue;
    const [x, y] = p!;
    if (el.dataset.dot != null) {
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
      continue;
    }
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    labels.push({ id, el, x, y, w, h, lx: x, ly: y - STEM - h / 2, dot: null!, lit: el.dataset.lit != null });
  }
  // West to east, ties by id, so the order never flickers.
  labels.sort((a, b) => a.x - b.x || a.id - b.id);

  // Merge dots that touch (single linkage).
  const dots: Dot[] = [];
  for (const l of labels) {
    const near = dots.find((d) => Math.hypot(d.x - l.x, d.y - l.y) < MERGE);
    if (near) {
      near.x = (near.x * near.n + l.x) / (near.n + 1);
      near.y = (near.y * near.n + l.y) / (near.n + 1);
      near.n++;
      near.lit ||= l.lit;
      l.dot = near;
    } else {
      l.dot = { x: l.x, y: l.y, n: 1, lit: l.lit };
      dots.push(l.dot);
    }
  }

  // Rows: start with one label each; merge rows whose labels collide, until none do.
  let rows: Label[][] = labels.map((l) => [l]);
  for (const row of rows) placeRow(row, rect!.width);
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        if (collide(rows[i], rows[j])) {
          const row = [...rows[i], ...rows[j]].sort((a, b) => a.x - b.x || a.id - b.id);
          rows = rows.filter((_, k) => k !== i && k !== j);
          rows.push(row);
          placeRow(row, rect!.width);
          merged = true;
          break outer;
        }
      }
    }
  }

  for (const l of labels) {
    l.el.style.transform = `translate(${l.lx.toFixed(1)}px, ${l.ly.toFixed(1)}px) translate(-50%, -50%)`;
  }
  if (layer) drawCallouts(layer, labels, dots);
}

/**
 * Lay a row out: one height, above its highest dot, and each label as close
 * to its own table as it can be without touching the next. Minimizing the
 * squared shift under the spacing constraints is pooling adjacent violators.
 */
function placeRow(row: Label[], width: number) {
  const h = Math.max(...row.map((l) => l.h));
  // A crowded row stands higher, so its lines fan out legibly.
  const stem = STEM + Math.min(28, 3 * (row.length - 1));
  const top = Math.min(...row.map((l) => l.dot.y));
  let ly = top - stem - h / 2;
  if (ly - h / 2 < EDGE) ly = Math.max(...row.map((l) => l.dot.y)) + stem + h / 2;

  const offset: number[] = [0];
  for (let k = 1; k < row.length; k++) offset[k] = offset[k - 1] + (row[k - 1].w + row[k].w) / 2 + GAP;
  const blocks: { value: number; weight: number; end: number }[] = [];
  row.forEach((l, k) => {
    let block = { value: l.x - offset[k], weight: 1, end: k };
    while (blocks.length && blocks[blocks.length - 1].value > block.value) {
      const prev = blocks.pop()!;
      const weight = prev.weight + block.weight;
      block = { value: (prev.value * prev.weight + block.value * block.weight) / weight, weight, end: block.end };
    }
    blocks.push(block);
  });
  let k = 0;
  for (const b of blocks) for (; k <= b.end; k++) row[k].lx = b.value + offset[k];

  // Keep the whole row in view.
  const left = row[0].lx - row[0].w / 2;
  const right = row[row.length - 1].lx + row[row.length - 1].w / 2;
  const shift = left < EDGE ? EDGE - left : right > width - EDGE ? Math.max(width - EDGE - right, EDGE - left) : 0;
  for (const l of row) {
    l.lx += shift;
    l.ly = ly;
  }
}

function collide(a: Label[], b: Label[]) {
  for (const p of a)
    for (const q of b)
      if (Math.abs(p.lx - q.lx) < (p.w + q.w) / 2 + GAP && Math.abs(p.ly - q.ly) < (p.h + q.h) / 2 + GAP) return true;
  return false;
}

/** Lines first, then dots over them; the lit ones last, on top. Elements are reused frame to frame. */
function drawCallouts(layer: SVGSVGElement, labels: Label[], dots: Dot[]) {
  const lines = [...labels].sort((a, b) => Number(a.lit) - Number(b.lit));
  const marks = [...dots].sort((a, b) => Number(a.lit) - Number(b.lit));
  const need = lines.length + marks.length;
  while (layer.childElementCount < need) layer.appendChild(document.createElementNS(SVG, "path"));
  while (layer.childElementCount > need) layer.lastElementChild!.remove();
  const kids = layer.children;
  lines.forEach((l, i) => {
    const bottom = l.ly + (l.dot.y < l.ly ? -l.h / 2 : l.h / 2);
    const el = kids[i];
    el.setAttribute("d", `M${l.lx.toFixed(1)} ${bottom.toFixed(1)}L${l.dot.x.toFixed(1)} ${l.dot.y.toFixed(1)}`);
    el.setAttribute("class", l.lit ? "fill-none stroke-accent" : "fill-none stroke-foreground/70");
  });
  marks.forEach((d, i) => {
    const s = d.n > 1 ? 4 : 3;
    const el = kids[lines.length + i];
    el.setAttribute("d", `M${(d.x - s).toFixed(1)} ${(d.y - s).toFixed(1)}h${2 * s}v${2 * s}h${-2 * s}z`);
    el.setAttribute("class", d.lit ? "fill-accent stroke-background" : "fill-foreground stroke-background");
  });
}
