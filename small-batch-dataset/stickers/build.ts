// SD card stickers: Cricut Print Then Cut sheets (print image + cut file) and a preview.
// Usage: npm run stickers
//        npm run stickers -- --web   (only the site's label, website/src/assets/sd-sticker.webp)

import puppeteer, { type Browser } from 'puppeteer';
import { join } from 'path';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { readTables } from '../../scripts/tables';
import type { PicnicTable } from '../../website/src/types';

const ROOT = join(import.meta.dirname, '..', '..');
const HERE = import.meta.dirname;
const OUT = join(HERE, 'out');
const ASSETS = join(OUT, 'assets');

// ---------------------------------------------------------------------------
// Dimensions (mm)
// ---------------------------------------------------------------------------
const LABEL = { w: 20, h: 25, r: 2 }; // the sticker itself, rounded rectangle
const CARD = { w: 24, h: 32, chamfer: 4, radius: 1 }; // full-size SD, for mockups only
const LABEL_ON_CARD = { x: (CARD.w - LABEL.w) / 2, y: 2.5 };

const BLEED = 1; // bleed in the preview
const SAFE = 1.5; // keep type this far inside the cut line

/** Rounded rectangle, optionally with a chamfered top-right corner (for the card). */
function outlinePath(w: number, h: number, r: number, ox = 0, oy = 0, chamfer = 0) {
  const X = (v: number) => +(ox + v).toFixed(3);
  const Y = (v: number) => +(oy + v).toFixed(3);
  const topRight = chamfer
    ? `L${X(w - chamfer)},${Y(0)} L${X(w)},${Y(chamfer)}`
    : `L${X(w - r)},${Y(0)} A${r},${r} 0 0 1 ${X(w)},${Y(r)}`;
  return [
    `M${X(r)},${Y(0)}`,
    topRight,
    `L${X(w)},${Y(h - r)}`,
    `A${r},${r} 0 0 1 ${X(w - r)},${Y(h)}`,
    `L${X(r)},${Y(h)}`,
    `A${r},${r} 0 0 1 ${X(0)},${Y(h - r)}`,
    `L${X(0)},${Y(r)}`,
    `A${r},${r} 0 0 1 ${X(r)},${Y(0)}`,
    'Z',
  ].join(' ');
}

/** Rounded rectangle with cubic-Bézier corners, for cutters that dislike SVG arcs. */
function roundedRectCubic(x: number, y: number, w: number, h: number, r: number) {
  const c = r * (1 - 0.5523); // control-point inset for a quarter circle
  const n = (v: number) => +v.toFixed(3);
  return [
    `M${n(x + r)} ${n(y)}`,
    `H${n(x + w - r)}`,
    `C${n(x + w - c)} ${n(y)} ${n(x + w)} ${n(y + c)} ${n(x + w)} ${n(y + r)}`,
    `V${n(y + h - r)}`,
    `C${n(x + w)} ${n(y + h - c)} ${n(x + w - c)} ${n(y + h)} ${n(x + w - r)} ${n(y + h)}`,
    `H${n(x + r)}`,
    `C${n(x + c)} ${n(y + h)} ${n(x)} ${n(y + h - c)} ${n(x)} ${n(y + h - r)}`,
    `V${n(y + r)}`,
    `C${n(x)} ${n(y + c)} ${n(x + c)} ${n(y)} ${n(x + r)} ${n(y)}`,
    'Z',
  ].join(' ');
}

// ---------------------------------------------------------------------------
// Data + assets
// ---------------------------------------------------------------------------
type Table = PicnicTable;

function prepareImages(tables: Table[]) {
  mkdirSync(ASSETS, { recursive: true });
  for (const t of tables) {
    const out = join(ASSETS, `${t.slug}-tile.jpg`);
    if (existsSync(out)) continue;
    // Center crop of the scan with no black void, for edge-to-edge tiling.
    execFileSync('magick', [
      join(ROOT, 'renders', `${t.slug}.jpg`),
      '-fuzz', '6%', '-trim', '+repage',
      '-gravity', 'center', '-crop', '74%x74%+0+0', '+repage',
      '-resize', '700x700>', '-quality', '92',
      out,
    ]);
    console.log('  prepared', t.slug);
  }
}

const fontFace = (family: string, file: string, weight = '400') => {
  const data = readFileSync(join(HERE, 'fonts', file)).toString('base64');
  return `@font-face{font-family:'${family}';src:url(data:font/ttf;base64,${data}) format('truetype');font-weight:${weight};}`;
};

const FONTS_CSS = [
  fontFace('JetBrains Mono', 'JetBrainsMono[wght].ttf', '100 800'),
].join('\n');

const BASE_CSS = `
${FONTS_CSS}
*{box-sizing:border-box;margin:0;padding:0}
body{background:#fff}
.lbl{position:relative;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.lbl *{position:absolute}
.t{color:#fff;white-space:nowrap;line-height:1.2}
`;

// ---------------------------------------------------------------------------
// Tile background + type variations
// ---------------------------------------------------------------------------
const tileImg = (t: Table) => `file://${join(ASSETS, t.slug + '-tile.jpg')}`;

function tileGrid(tables: Table[], bleed: number) {
  const cols = 3;
  const rows = Math.ceil(tables.length / cols);
  const gap = 0.3;
  const W = LABEL.w + 2 * bleed;
  const H = LABEL.h + 2 * bleed;
  const cw = (W - gap * (cols - 1)) / cols;
  const ch = (H - gap * (rows - 1)) / rows;
  return tables
    .map((t, i) => {
      const x = (i % cols) * (cw + gap);
      const y = Math.floor(i / cols) * (ch + gap);
      return `<img src="${tileImg(t)}" style="left:${x}mm;top:${y}mm;width:${cw}mm;height:${ch}mm;object-fit:cover" />`;
    })
    .join('');
}

interface Variation {
  id: string;
  font: string;
  shade: number; // black overlay opacity over the tile
  type: string; // HTML positioned in label coords (0,0 = cut line top-left)
}

const f = (family: string, weight: number, size: number, extra = '') =>
  `font-family:'${family}';font-weight:${weight};font-size:${size}pt;${extra}`;


// Text along a long edge, rotated 90° counterclockwise so both sides read
// bottom to top. Each block is pinned by the corner that sits on its edge:
// the left block grows right from the left edge, the right block grows left
// from the right edge.
const RUN = LABEL.h - 2 * SAFE;
const vertical = (side: 'left' | 'right', style: string, html: string) => {
  const anchor =
    side === 'left'
      ? `left:${SAFE}mm;top:${LABEL.h - SAFE}mm;transform-origin:0 0`
      : `left:${LABEL.w - SAFE}mm;bottom:${SAFE}mm;transform-origin:0 100%`;
  return `<div class="t" style="${anchor};width:${RUN}mm;transform:rotate(-90deg);${style}">${html}</div>`;
};
const line = (style: string, text: string) => `<span style="position:static;display:block;${style}">${text}</span>`;

// Golden Gate Park along the left edge, Picnic Tables + credit along the right, in the viewer's mono font.
const VARIATIONS: Variation[] = [
  {
    id: 'park',
    font: 'JetBrains Mono Regular / Bold',
    shade: 0.32,
    type:
      vertical('left', f('JetBrains Mono', 400, 6.3, 'line-height:1.1'), 'golden gate park') +
      vertical(
        'right',
        f('JetBrains Mono', 700, 7.8, 'line-height:1.1'),
        'picnic tables' + line(`font-weight:400;font-size:5.4pt;margin-top:.3mm`, 'yufeng zhao'),
      ),
  },
];

function labelHtml(v: Variation, tables: Table[], bleed = BLEED) {
  const W = LABEL.w + 2 * bleed;
  const H = LABEL.h + 2 * bleed;
  return `<div class="lbl" style="width:${W}mm;height:${H}mm;background:#000">
    ${tileGrid(tables, bleed)}
    <div style="left:0;top:0;width:${W}mm;height:${H}mm;background:rgba(0,0,0,${v.shade})"></div>
    <div style="left:${bleed}mm;top:${bleed}mm;width:${LABEL.w}mm;height:${LABEL.h}mm">${v.type}</div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const page = (body: string, extraCss = '') =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}${extraCss}</style></head><body>${body}</body></html>`;

async function openHtml(browser: Browser, name: string, html: string, scale = 1) {
  const dir = join(OUT, '.html');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.html`);
  writeFileSync(file, html);
  const p = await browser.newPage();
  await p.setViewport({ width: 800, height: 600, deviceScaleFactor: scale });
  await p.goto(`file://${file}`, { waitUntil: 'networkidle0' });
  await p.evaluate(() => document.fonts.ready);
  return p;
}

// ---------------------------------------------------------------------------
// Cricut sticker sheets: one print image + one cut file per Print Then Cut
// area. Every sticker carries real artwork CRICUT_BLEED past its cut line.
// ---------------------------------------------------------------------------
const CRICUT_BLEED = 1.5; // Print Then Cut usually drifts 0.5-1 mm
const CRICUT_GAP = 2 * CRICUT_BLEED; // neighboring bleeds meet, never overlap
const CRICUT_DPI = 600;
const IN = 25.4;
const CRICUT_AREAS = [
  // Letter, Joy Xtra and older Design Space; works on every Print Then Cut machine.
  { id: 'letter-6.75x9.25', w: 6.75 * IN, h: 9.25 * IN },
  // Letter, newer Design Space on Explore / Maker / Venture.
  { id: 'letter-7.44x9.94', w: 7.44 * IN, h: 9.94 * IN },
];

function cricutLayout(area: { w: number; h: number }) {
  const b = CRICUT_BLEED;
  const g = CRICUT_GAP;
  const fit = (w: number, h: number) => ({
    cols: Math.floor((area.w - 2 * b + g) / (w + g)),
    rows: Math.floor((area.h - 2 * b + g) / (h + g)),
  });
  const upright = fit(LABEL.w, LABEL.h);
  const sideways = fit(LABEL.h, LABEL.w);
  const rotated = sideways.cols * sideways.rows > upright.cols * upright.rows;
  const { cols, rows } = rotated ? sideways : upright;
  const cw = rotated ? LABEL.h : LABEL.w; // cut size on the sheet
  const ch = rotated ? LABEL.w : LABEL.h;
  const slots: { x: number; y: number }[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) slots.push({ x: b + c * (cw + g), y: b + r * (ch + g) });
  // The image is exactly the artwork's bounding box; the cut lines sit
  // CRICUT_BLEED inside it on every side, so centring one on the other aligns them.
  const W = cols * cw + (cols - 1) * g + 2 * b;
  const H = rows * ch + (rows - 1) * g + 2 * b;
  return { rotated, cols, rows, cw, ch, slots, W, H };
}

async function renderCricutSheets(browser: Browser, tables: Table[]) {
  const dir = join(OUT, 'cricut');
  mkdirSync(dir, { recursive: true });
  const b = CRICUT_BLEED;
  const v = VARIATIONS[0];
  const art = labelHtml(v, tables, b);
  const fmt = (mm: number) => `${mm.toFixed(2)} mm / ${(mm / IN).toFixed(3)} in`;

  for (const area of CRICUT_AREAS) {
    const L = cricutLayout(area);
    const sw = L.cw + 2 * b;
    const sh = L.ch + 2 * b;
    // Sideways slots hold the upright artwork turned 90°.
    const fit = (html: string) =>
      L.rotated
        ? `<div style="position:absolute;left:0;top:0;transform-origin:0 0;transform:translate(${sw}mm,0) rotate(90deg)">${html}</div>`
        : html;
    const body = `<div class="sheet" style="position:relative;width:${L.W}mm;height:${L.H}mm;background:#000">
      ${L.slots.map((s) => `<div style="position:absolute;left:${s.x - b}mm;top:${s.y - b}mm;width:${sw}mm;height:${sh}mm">${fit(art)}</div>`).join('')}
    </div>`;
    const p = await openHtml(browser, `cricut-${area.id}`, page(body, 'body{background:transparent}'), CRICUT_DPI / 96);
    const el = await p.$('.sheet');
    const png = join(OUT, '.html', `${area.id}.png`);
    await el!.screenshot({ path: png as `${string}.png`, omitBackground: true });
    await p.close();
    const px = (mm: number) => Math.round((mm / IN) * CRICUT_DPI);
    execFileSync('magick', [png, '-resize', `${px(L.W)}x${px(L.H)}!`, '-units', 'PixelsPerInch', '-density', String(CRICUT_DPI), png]);
    execFileSync('magick', [png, '-background', 'white', '-flatten', '-quality', '95', '-units', 'PixelsPerInch', '-density', String(CRICUT_DPI), join(dir, `${v.id}-${area.id}-print.jpg`)]);
    // Boosted copy for a printer that drops magenta: more saturation, then the
    // green midtones pulled down (more magenta) and red lifted. Whites stay white.
    execFileSync('magick', [
      png, '-background', 'white', '-flatten',
      '-modulate', '100,160,100',
      '-channel', 'G', '-gamma', '0.75', '-channel', 'R', '-gamma', '1.12', '+channel',
      '-quality', '95', '-units', 'PixelsPerInch', '-density', String(CRICUT_DPI),
      join(dir, `${v.id}-${area.id}-print-boosted.jpg`),
    ]);

    // Cut file in the plainest SVG Design Space reads: one filled path per
    // sticker, corners as cubic curves (no arcs), units of 1/72 in, which is
    // what Design Space assumes, so it imports at the right size.
    const PT = 72 / IN;
    const W = +((L.W - 2 * b) * PT).toFixed(3);
    const H = +((L.H - 2 * b) * PT).toFixed(3);
    const paths = L.slots.map((s) => roundedRectCubic((s.x - b) * PT, (s.y - b) * PT, L.cw * PT, L.ch * PT, LABEL.r * PT));
    writeFileSync(
      join(dir, `${v.id}-${area.id}-cut.svg`),
      `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
${paths.map((d) => `<path fill="#000000" d="${d}"/>`).join('\n')}
</svg>
`,
    );

    console.log(
      `  cricut ${area.id}: ${L.slots.length} stickers (${L.cols}x${L.rows}${L.rotated ? ', sideways' : ''}), ` +
        `image ${(L.W / IN).toFixed(3)} x ${(L.H / IN).toFixed(3)} in, cut ${((L.W - 2 * b) / IN).toFixed(3)} x ${((L.H - 2 * b) / IN).toFixed(3)} in`,
    );
  }
}

const PX_PER_MM = 96 / 25.4;
const clipPx = () =>
  outlinePath(LABEL.w * PX_PER_MM, LABEL.h * PX_PER_MM, LABEL.r * PX_PER_MM, BLEED * PX_PER_MM, BLEED * PX_PER_MM);

async function renderOverview(browser: Browser, tables: Table[]) {
  const dir = join(OUT, 'previews');
  mkdirSync(dir, { recursive: true });
  const clip = clipPx();
  const figure = (v: Variation) => `<figure>
    <div class="flat"><div style="position:absolute;left:${-BLEED}mm;top:${-BLEED}mm;clip-path:path('${clip}')">${labelHtml(v, tables)}</div></div>
    <div class="card">
      <svg width="${CARD.w}mm" height="${CARD.h}mm" viewBox="0 0 ${CARD.w} ${CARD.h}" style="position:absolute;left:0;top:0">
        <path d="${outlinePath(CARD.w, CARD.h, CARD.radius, 0, 0, CARD.chamfer)}" fill="#2b2b2e"/>
      </svg>
      <div style="position:absolute;left:${LABEL_ON_CARD.x - BLEED}mm;top:${LABEL_ON_CARD.y - BLEED}mm;clip-path:path('${clip}')">${labelHtml(v, tables)}</div>
    </div>
    <figcaption>${v.id}<br/>${v.font}</figcaption>
  </figure>`;
  const body = `<main>
    <h1>Golden Gate Park Picnic Tables · ${LABEL.w} × ${LABEL.h} mm</h1>
    <div class="row">${VARIATIONS.map(figure).join('')}</div>
  </main>`;
  const css = `
    body{background:#e9e7e1;color:#222;font-family:'JetBrains Mono'}
    main{padding:10mm;width:${4 * (LABEL.w + CARD.w + 16) + 20}mm}
    h1{font-weight:500;font-size:11pt;margin-bottom:8mm;text-transform:uppercase;letter-spacing:.05em}
    .row{display:flex;flex-wrap:wrap;gap:9mm 10mm}
    figure{display:grid;grid-template-columns:auto auto;gap:3mm 4mm;align-items:start}
    .flat{position:relative;width:${LABEL.w}mm;height:${LABEL.h}mm;filter:drop-shadow(0 .3mm .5mm rgba(0,0,0,.2))}
    .card{position:relative;width:${CARD.w}mm;height:${CARD.h}mm;filter:drop-shadow(0 .6mm .8mm rgba(0,0,0,.25))}
    figcaption{grid-column:1/3;font-size:6pt;color:#777;line-height:1.5}
  `;
  const p = await openHtml(browser, 'overview', page(body, css), 3);
  const el = await p.$('main');
  await el!.screenshot({ path: join(dir, 'overview.png') });
  await p.close();
  console.log('  overview -> out/previews/overview.png');
}

// The label alone, cut to its rounded corners, for the turning SD card on the
// site's About page (website/src/components/SdCard.tsx).
const WEB_STICKER = join(ROOT, 'website', 'src', 'assets', 'sd-sticker.webp');

async function renderWebSticker(browser: Browser, tables: Table[]) {
  mkdirSync(join(ROOT, 'website', 'src', 'assets'), { recursive: true });
  const clip = outlinePath(LABEL.w * PX_PER_MM, LABEL.h * PX_PER_MM, LABEL.r * PX_PER_MM);
  const body = `<div class="web" style="position:relative;width:${LABEL.w}mm;height:${LABEL.h}mm;clip-path:path('${clip}')">
    <div style="position:absolute;left:${-BLEED}mm;top:${-BLEED}mm">${labelHtml(VARIATIONS[0], tables)}</div>
  </div>`;
  const p = await openHtml(browser, 'web-sticker', page(body, 'body{background:transparent}'), 8);
  const png = join(OUT, '.html', 'web-sticker.png');
  const el = await p.$('.web');
  await el!.screenshot({ path: png as `${string}.png`, omitBackground: true });
  await p.close();
  execFileSync('magick', [png, '-quality', '86', WEB_STICKER]);
  console.log('  web sticker -> website/src/assets/sd-sticker.webp');
}

// ---------------------------------------------------------------------------
async function main() {
  const tables = readTables();
  prepareImages(tables);

  const webOnly = process.argv.includes('--web');

  const browser = await puppeteer.launch({ headless: true, protocolTimeout: 180_000 });
  try {
    await renderWebSticker(browser, tables);
    if (webOnly) return;
    await renderOverview(browser, tables);
    await renderCricutSheets(browser, tables);
  } finally {
    await browser.close();
  }
}

main();
