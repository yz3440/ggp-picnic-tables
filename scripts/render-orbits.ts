import puppeteer, { type Page } from 'puppeteer';
import { join } from 'path';
import { createReadStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { execSync, execFileSync } from 'child_process';
import { readTables } from './tables';
import type { PicnicTable } from '../website/src/types';

const PROJECT_ROOT = join(import.meta.dirname, '..');
const RENDERS_DIR = join(PROJECT_ROOT, 'renders');
const TMP_DIR = join(PROJECT_ROOT, '.render-tmp');
const RENDERER_PATH = join(import.meta.dirname, 'orbit-renderer.html');

const FRAME_COUNT = 120;
const FPS = 30;
const CANVAS_SIZE = 1024;
const SCREENSHOT_SIZE = 4096;

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
  page: Page,
  table: PicnicTable,
  serverPort: number,
) {
  const modelParam = encodeURIComponent(
    `http://localhost:${serverPort}/model/${table.file}`,
  );
  const rotY = table.render_rotation;
  const url = `file://${RENDERER_PATH}?model=${modelParam}&size=${CANVAS_SIZE}&rotY=${rotY}`;

  console.log(`  Loading model: ${table.file}`);
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
  const jpegPath = join(RENDERS_DIR, `${table.slug}.jpg`);
  writeFileSync(jpegPath, Buffer.from(jpegBase64, 'base64'));
  console.log(`  Saved: ${jpegPath}`);

  const tableFramesDir = join(TMP_DIR, table.slug);
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

  const outputPath = join(RENDERS_DIR, `${table.slug}.mp4`);
  console.log(`  Encoding to MP4...`);
  encodeFramesToMp4(tableFramesDir, outputPath);

  rmSync(tableFramesDir, { recursive: true, force: true });
  console.log(`  Done: ${outputPath}`);
}

async function main() {
  await verifyFfmpeg();

  const tablesJson = readTables();
  console.log(`Found ${tablesJson.length} tables to render\n`);

  mkdirSync(RENDERS_DIR, { recursive: true });
  mkdirSync(TMP_DIR, { recursive: true });

  // Start a minimal static server for GLB files
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname.startsWith('/model/')) {
      const filename = decodeURIComponent(url.pathname.replace('/model/', ''));
      const path = join(PROJECT_ROOT, 'model', filename);
      if (!filename.includes('..') && existsSync(path)) {
        res.writeHead(200, {
          'Content-Type': 'model/gltf-binary',
          'Access-Control-Allow-Origin': '*',
        });
        createReadStream(path).pipe(res);
        return;
      }
    }
    res.writeHead(404).end('Not found');
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const serverPort = (server.address() as AddressInfo).port;
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
    console.log(`[${i + 1}/${tablesJson.length}] ${table.slug}`);
    try {
      await renderModel(page, table, serverPort);
    } catch (err) {
      console.error(`  ERROR rendering ${table.slug}:`, err);
    }
  }

  await browser.close();
  server.close();

  rmSync(TMP_DIR, { recursive: true, force: true });
  console.log('\nAll renders complete!');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
