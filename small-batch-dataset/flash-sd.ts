// Erases an SD card to FAT32 and copies sd-card/ onto it. macOS only.
// Usage: npm run flash-sd
// Keys: up/down select, r refresh, enter flash, q quit.

import { spawnSync } from 'child_process';
import { join } from 'path';
import { existsSync, readdirSync, statSync, writeFileSync } from 'fs';

const SRC = join(import.meta.dirname, 'sd-card');
/** FAT32 volume label: uppercase, at most 11 characters. */
const LABEL = 'GGP_TABLES';
/** Never offer disks larger than this, so an external drive can't be picked by mistake. */
const MAX_BYTES = 256e9;

interface Disk {
  id: string; // disk4
  name: string;
  bytes: number;
  protocol: string;
  volumes: string[];
}

const run = (cmd: string[]) => {
  const p = spawnSync(cmd[0], cmd.slice(1), { encoding: 'utf8' });
  return { ok: p.status === 0, out: p.stdout ?? '', err: p.stderr ?? '' };
};

const plist = (cmd: string[]): any => {
  const r = run(cmd);
  if (!r.ok) return null;
  const j = spawnSync('plutil', ['-convert', 'json', '-o', '-', '-'], { input: r.out, encoding: 'utf8' });
  return JSON.parse(j.stdout);
};

function listDisks(): Disk[] {
  const list = plist(['diskutil', 'list', '-plist', 'physical']);
  if (!list) return [];
  const disks: Disk[] = [];
  for (const d of list.AllDisksAndPartitions ?? []) {
    const info = plist(['diskutil', 'info', '-plist', d.DeviceIdentifier]);
    if (!info || info.VirtualOrPhysical === 'Virtual') continue;
    // The built-in SD slot reports Internal, so allow Secure Digital; otherwise only external removable media.
    const sd = info.BusProtocol === 'Secure Digital' || info.Protocol === 'Secure Digital';
    if (!sd && (info.Internal || !info.RemovableMedia)) continue;
    if (!info.TotalSize || info.TotalSize > MAX_BYTES) continue;
    disks.push({
      id: d.DeviceIdentifier,
      name: info.MediaName || info.IORegistryEntryName || 'Unknown',
      bytes: info.TotalSize,
      protocol: info.BusProtocol || info.Protocol || '',
      volumes: (d.Partitions ?? []).map((p: any) => p.VolumeName).filter(Boolean),
    });
  }
  return disks;
}

const gb = (b: number) => `${(b / 1e9).toFixed(1)} GB`;
const srcFiles = () => readdirSync(SRC).filter((f) => !f.startsWith('.'));

async function flash(disk: Disk, log: (s: string) => void): Promise<void> {
  log(`Erasing /dev/${disk.id} as FAT32 "${LABEL}"...`);
  const erase = run(['diskutil', 'eraseDisk', 'FAT32', LABEL, 'MBRFormat', `/dev/${disk.id}`]);
  if (!erase.ok) throw new Error(erase.err || erase.out);

  const parts = plist(['diskutil', 'list', '-plist', disk.id])?.AllDisksAndPartitions?.[0]?.Partitions ?? [];
  const part = parts.find((p: any) => p.VolumeName === LABEL) ?? parts[0];
  const mount = part && plist(['diskutil', 'info', '-plist', part.DeviceIdentifier])?.MountPoint;
  if (!mount) throw new Error('Formatted, but the volume did not mount.');

  // Keep Spotlight off the card.
  writeFileSync(join(mount, '.metadata_never_index'), '');

  const files = srcFiles();
  for (const [i, f] of files.entries()) {
    log(`Copying ${i + 1}/${files.length} ${f}`);
    // -X: no extended attributes, so no ._ files on FAT32.
    const cp = spawnSync('cp', ['-X', join(SRC, f), join(mount, f)], { encoding: 'utf8' });
    if (cp.status !== 0) throw new Error(cp.stderr);
  }
  run(['sync']);

  for (const f of files) {
    if (statSync(join(mount, f)).size !== statSync(join(SRC, f)).size) throw new Error(`Size mismatch: ${f}`);
  }
  run(['dot_clean', '-m', mount]);

  log('Ejecting...');
  const ej = run(['diskutil', 'eject', `/dev/${disk.id}`]);
  if (!ej.ok) throw new Error(ej.err || ej.out);
}

// ---- UI ----

if (!existsSync(SRC) || !srcFiles().some((f) => f.endsWith('.glb'))) {
  console.error('sd-card/ has no models. Run: npm run sd-card');
  process.exit(1);
}

let disks: Disk[] = [];
let sel = 0;
let mode: 'list' | 'confirm' | 'busy' = 'list';
let status = '';
let done = 0;

function draw() {
  const out: string[] = ['\x1b[2J\x1b[H'];
  out.push(`Golden Gate Park Picnic Tables: SD card flasher    flashed: ${done}\n`);
  out.push(`Source: ${SRC} (${srcFiles().length} files)\n\n`);
  if (disks.length === 0) out.push('  No SD cards found. Insert one and press r.\n');
  disks.forEach((d, i) => {
    const vols = d.volumes.length ? d.volumes.join(', ') : 'no volumes';
    const line = `${d.id.padEnd(7)} ${gb(d.bytes).padStart(9)}  ${d.name}  [${d.protocol}]  ${vols}`;
    out.push(i === sel ? `\x1b[7m> ${line}\x1b[0m\n` : `  ${line}\n`);
  });
  out.push('\n');
  if (mode === 'confirm') {
    const d = disks[sel];
    out.push(`\x1b[31mErase ${d.id} (${gb(d.bytes)} ${d.name}) and copy the dataset? Everything on it will be lost. [y/N]\x1b[0m\n`);
  } else if (mode === 'list') {
    out.push('up/down select   r refresh   enter flash   q quit\n');
  }
  if (status) out.push(`\n${status}\n`);
  process.stdout.write(out.join(''));
}

function refresh() {
  status = 'Scanning...';
  draw();
  disks = listDisks();
  sel = Math.min(sel, Math.max(0, disks.length - 1));
  status = '';
  draw();
}

function quit() {
  process.stdin.setRawMode(false);
  process.stdout.write('\n');
  process.exit(0);
}

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', async (buf) => {
  const k = buf.toString();
  if (k === '\x03') quit(); // ctrl-c
  if (mode === 'busy') return;

  if (mode === 'confirm') {
    if (k.toLowerCase() !== 'y') {
      mode = 'list';
      status = 'Canceled.';
      return draw();
    }
    mode = 'busy';
    const disk = disks[sel];
    try {
      await flash(disk, (s) => ((status = s), draw()));
      done++;
      status = `\x1b[32m${disk.id} done. Safe to remove. Insert the next card and press r.\x1b[0m`;
    } catch (e) {
      status = `\x1b[31mFailed on ${disk.id}: ${(e as Error).message.trim()}\x1b[0m`;
    }
    mode = 'list';
    disks = listDisks();
    sel = Math.min(sel, Math.max(0, disks.length - 1));
    return draw();
  }

  if (k === 'q') quit();
  else if (k === 'r') refresh();
  else if (k === '\x1b[A') (sel = Math.max(0, sel - 1)), draw();
  else if (k === '\x1b[B') (sel = Math.min(disks.length - 1, sel + 1)), draw();
  else if ((k === '\r' || k === '\n') && disks[sel]) (mode = 'confirm'), (status = ''), draw();
});

refresh();
