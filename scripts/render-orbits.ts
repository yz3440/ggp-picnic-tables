import puppeteer from 'puppeteer';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { execSync, execFileSync } from 'child_process';

const PROJECT_ROOT = join(import.meta.dir, '..');
const RENDERS_DIR = join(PROJECT_ROOT, 'renders');
const TMP_DIR = join(PROJECT_ROOT, '.render-tmp');
const RENDERER_PATH = join(import.meta.dir, 'orbit-renderer.html');

const FRAME_COUNT = 120;
const FPS = 30;
const CANVAS_SIZE = 1024;
const SCREENSHOT_SIZE = 4096;

const INITIAL_ROTATION: Record<string, number> = {
  'GG Table 1': -180,
  'GG Table 2': 90,
  'GG Table 6': 180,
  'GG Table 8': 180,
  'GG Table 9': 90,
  'GG Table 10': 180,
  'GG Table 11': 180,
  'GG Table 12': 180,
  'GG Table 15&16': 0,
  'GG Table 19': 180,
  'GG Table 20': 0,
};

interface TableEntry {
  id: number;
  name: string;
  model_file: string;
}

async function verifyFfmpeg() {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
  } catch {
    console.error('ffmpeg not found. Install with: brew install ffmpeg');
    process.exit(1);
  }
}

function encodeFramesToMp4(framesDir: string, outputPath: string) {
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-framerate',
      String(FPS),
      '-i',
      join(framesDir, 'frame_%04d.png'),
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '18',
      '-preset',
      'slow',
      '-movflags',
      '+faststart',
      outputPath,
    ],
    { stdio: 'pipe' },
  );
}

async function renderModel(
  page: puppeteer.Page,
  table: TableEntry,
  serverPort: number,
) {
  const modelParam = encodeURIComponent(
    `http://localhost:${serverPort}/model/${table.model_file.replace('model/', '')}`,
  );
  const rotY = INITIAL_ROTATION[table.name] ?? 0;
  const url = `file://${RENDERER_PATH}?model=${modelParam}&size=${CANVAS_SIZE}&rotY=${rotY}`;

  console.log(`  Loading model: ${table.name}`);
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60_000 });

  await page.waitForFunction('window.__modelLoaded === true', {
    timeout: 30_000,
  });

  console.log(`  Capturing ${FRAME_COUNT} frames...`);
  const frames: string[] = await page.evaluate((fc: number) => {
    return (window as any).captureOrbit(fc);
  }, FRAME_COUNT);

  console.log(`  Capturing 4K top-down screenshot...`);
  const topDownDataUrl: string = await page.evaluate((size: number) => {
    return (window as any).captureTopDown(size, 0.95);
  }, SCREENSHOT_SIZE);
  const jpegBase64 = topDownDataUrl.replace(/^data:image\/jpeg;base64,/, '');
  const jpegPath = join(RENDERS_DIR, `${table.name}.jpg`);
  writeFileSync(jpegPath, Buffer.from(jpegBase64, 'base64'));
  console.log(`  Saved: ${jpegPath}`);

  const tableFramesDir = join(TMP_DIR, table.name);
  mkdirSync(tableFramesDir, { recursive: true });

  for (let i = 0; i < frames.length; i++) {
    const base64 = frames[i].replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');
    const framePath = join(
      tableFramesDir,
      `frame_${String(i).padStart(4, '0')}.png`,
    );
    writeFileSync(framePath, buffer);
  }

  const outputPath = join(RENDERS_DIR, `${table.name}.mp4`);
  console.log(`  Encoding to MP4...`);
  encodeFramesToMp4(tableFramesDir, outputPath);

  rmSync(tableFramesDir, { recursive: true, force: true });
  console.log(`  Done: ${outputPath}`);
}

async function main() {
  await verifyFfmpeg();

  const tablesJson: TableEntry[] = await Bun.file(
    join(PROJECT_ROOT, 'picnic_tables.json'),
  ).json();
  console.log(`Found ${tablesJson.length} tables to render\n`);

  mkdirSync(RENDERS_DIR, { recursive: true });
  mkdirSync(TMP_DIR, { recursive: true });

  // Start a minimal static server for GLB files
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.startsWith('/model/')) {
        const filename = decodeURIComponent(
          url.pathname.replace('/model/', ''),
        );
        const file = Bun.file(join(PROJECT_ROOT, 'model', filename));
        if (!(await file.exists()))
          return new Response('Not found', { status: 404 });
        return new Response(file.stream(), {
          headers: {
            'Content-Type': 'model/gltf-binary',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
      return new Response('Not found', { status: 404 });
    },
  });
  const serverPort = server.port;
  console.log(`Static server on port ${serverPort}\n`);

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-gl=angle',
      '--enable-webgl',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: CANVAS_SIZE, height: CANVAS_SIZE });

  for (let i = 0; i < tablesJson.length; i++) {
    const table = tablesJson[i];
    console.log(`[${i + 1}/${tablesJson.length}] ${table.name}`);
    try {
      await renderModel(page, table, serverPort);
    } catch (err) {
      console.error(`  ERROR rendering ${table.name}:`, err);
    }
  }

  await browser.close();
  server.stop();

  rmSync(TMP_DIR, { recursive: true, force: true });
  console.log('\nAll renders complete!');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
