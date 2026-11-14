// Small versions of the renders for the cards:
// - renders/<name>.mp4 (1024 px, ~2 MB) → renders/preview/<name>.mp4 (480 px,
//   ~170 KB), with the index at the front so a browser can start playing
//   before the whole file has arrived;
// - renders/<name>.jpg (4096 px, ~2.4 MB) → renders/preview/<name>.jpg (640 px).
// The open viewer still uses the full-size picture.
// Run after render-orbits: bun run scripts/make-previews.ts
import { execFileSync } from "child_process";
import { mkdirSync, readdirSync, statSync } from "fs";
import { join } from "path";

const RENDERS_DIR = join(import.meta.dir, "..", "renders");
const PREVIEW_DIR = join(RENDERS_DIR, "preview");
const VIDEO_SIZE = 480;
const IMAGE_SIZE = 640;

mkdirSync(PREVIEW_DIR, { recursive: true });
for (const file of readdirSync(RENDERS_DIR).filter((f) => f.endsWith(".mp4"))) {
  const out = join(PREVIEW_DIR, file);
  execFileSync("ffmpeg", [
    "-v", "error", "-y",
    "-i", join(RENDERS_DIR, file),
    "-vf", `scale=${VIDEO_SIZE}:${VIDEO_SIZE}:flags=lanczos`,
    "-c:v", "libx264", "-profile:v", "main", "-preset", "slow", "-crf", "26",
    "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart",
    out,
  ]);
  console.log(`${file}: ${(statSync(out).size / 1024).toFixed(0)} KB`);
}
for (const file of readdirSync(RENDERS_DIR).filter((f) => f.endsWith(".jpg"))) {
  const out = join(PREVIEW_DIR, file);
  execFileSync("ffmpeg", [
    "-v", "error", "-y",
    "-i", join(RENDERS_DIR, file),
    "-vf", `scale=${IMAGE_SIZE}:${IMAGE_SIZE}:flags=lanczos`,
    "-q:v", "3",
    out,
  ]);
  console.log(`${file}: ${(statSync(out).size / 1024).toFixed(0)} KB`);
}
