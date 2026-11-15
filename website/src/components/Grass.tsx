import { useEffect, useState } from 'react';

/** Tufts, from a blade to a clump. Plain ASCII, so the site's mono font has every glyph. */
const TUFTS = [',', "'", '"', 'v', 'w', 'W', '\\/', '\\|/', '\\\\|//', '.\\|/.', ',w,'];
/** Character cell of the 12 px mono text below (JetBrains Mono is 0.6 em wide). */
const CELL_W = 7.2;
const CELL_H = 14;
/** Chance a cell starts a tuft: almost none at the top, a lawn at the bottom. */
const TOP = 0.004;
const BOTTOM = 0.16;

/** A picnic table: the top, the crossed A-frame legs, the bench through them. */
const TABLE = [
  ' ______________________ ',
  '|______________________|',
  '   \\  /          \\  /   ',
  ' ===\\/============\\/=== ',
  '    /\\            /\\    ',
  '   /  \\          /  \\   ',
];
/** Where tables stand on the lawn: across the width, and rows up from the bottom. */
const TABLES = [
  { x: 0.07, up: 1 },
  { x: 0.55, up: 2 },
  { x: 0.84, up: 1 },
];

/** A small seeded random generator, so the lawn is the same on every visit. */
function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lawn(cols: number, rows: number) {
  const random = seeded(1302);
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    const k = rows > 1 ? r / (rows - 1) : 1;
    const chance = TOP + (BOTTOM - TOP) * k * k * k;
    let line = '';
    while (line.length < cols) {
      if (random() < chance) {
        // Bigger clumps toward the bottom.
        const reach = Math.max(1, Math.round(TUFTS.length * (0.35 + 0.65 * k)));
        line += TUFTS[Math.floor(random() * reach)];
      } else line += ' ';
    }
    lines.push(line.slice(0, cols));
  }

  // Set the tables out on the lawn, with the grass cleared a cell around each.
  const width = TABLE[0].length;
  for (const { x, up } of TABLES) {
    const left = Math.round(x * cols);
    const top = rows - up - TABLE.length;
    if (left < 1 || left + width + 1 > cols || top < 1) continue;
    for (let r = top - 1; r <= top + TABLE.length; r++) {
      if (r < 0 || r >= rows) continue;
      const art = TABLE[r - top];
      const patch = art ? ` ${art} ` : ' '.repeat(width + 2);
      lines[r] = lines[r].slice(0, left - 1) + patch + lines[r].slice(left + width + 1);
    }
  }
  return lines.join('\n');
}

/**
 * ASCII grass behind the whole site, in a faint park green: sparse at the
 * top of the window, thickening into a lawn at the bottom, with a few
 * picnic tables set out on it. It shows wherever
 * the page is see-through (between the cards, behind About); the bar, the
 * ticker, the map and the viewer stay solid over it.
 */
export default function Grass() {
  const [text, setText] = useState('');

  useEffect(() => {
    const draw = () =>
      setText(lawn(Math.ceil(window.innerWidth / CELL_W), Math.ceil(window.innerHeight / CELL_H)));
    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, []);

  return (
    <pre
      aria-hidden='true'
      className='pointer-events-none fixed inset-0 -z-10 m-0 overflow-hidden text-[12px] leading-3.5 whitespace-pre text-accent/25 select-none'
    >
      {text}
    </pre>
  );
}
