#!/usr/bin/env node
/**
 * Builds an upload-ready ZIP of Chat Pilot Cloud — for the manual upload path
 * (Hostinger File Manager, or any host without git access), as an alternative
 * to `git clone` on the server. See docs/DEPLOY.md "Upload the code".
 *
 *   node scripts/build-cloud.mjs
 *
 * What goes in, and why
 * ----------------------
 * The archive unpacks to a `chat-pilot/` folder containing `saas/` and
 * `deploy/` side by side — the exact layout docs/DEPLOY.md assumes at
 * `/var/www/chat-pilot`, so every command in that guide works unchanged
 * whether the code arrived by git or by this ZIP.
 *
 * Left out on purpose:
 *   saas/node_modules   installed on the server (`npm install --omit=dev`);
 *                       shipping it would carry native binaries built for
 *                       this machine's OS/arch, not the server's
 *   saas/data           the local dev database — the server gets its own
 *   saas/.env            real local secrets never leave this machine
 *   saas/tests            dev-only; needs devDependencies not installed
 *                          in production and a PHP toolchain the server
 *                          has no reason to carry
 *   .git, dist, _reference, wordpress-plugin
 *                        version control, build output, v1 reference
 *                        source, and the WordPress plugin (a separate
 *                        artifact — see scripts/build-plugin.mjs)
 *
 * This is the SIBLING of build-plugin.mjs, not a replacement: the plugin
 * ships to a customer's WordPress site, this ships to your own VPS. Two
 * different destinations, two different ZIPs, on purpose.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist', 'cloud');

/** What never goes in the archive, matched against each path segment. */
const EXCLUDE_ANYWHERE = [
  /^\.git$/, /^\.github$/, /^node_modules$/, /^\.DS_Store$/, /^Thumbs\.db$/, /~$/, /\.log$/,
];

/** Whole subtrees excluded by their path relative to the project root. */
const EXCLUDE_PATHS = new Set([
  'saas/data',
  'saas/.env',
  'saas/tests',
  'dist',
  '_reference',
  'wordpress-plugin',
]);

/** Only these top-level entries are considered at all. */
const INCLUDE_ROOTS = ['saas', 'deploy', 'docs', 'README.md'];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function collect(dir, relFromRoot = '') {
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    if (EXCLUDE_ANYWHERE.some((re) => re.test(entry))) continue;
    const full = path.join(dir, entry);
    const rel = relFromRoot ? relFromRoot + '/' + entry : entry;
    if (EXCLUDE_PATHS.has(rel)) continue;
    if (statSync(full).isDirectory()) out.push(...collect(full, rel));
    else out.push({ rel, data: readFileSync(full) });
  }
  return out;
}

function writeZip(target, files, archivePrefix) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(archivePrefix + '/' + file.rel, 'utf8');
    const compressed = deflateRawSync(file.data, { level: 9 });
    const crc = crc32(file.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  writeFileSync(target, Buffer.concat([...locals, centralBuf, eocd]));
}

/** dd-mmm-yyyy plus the short commit hash when this is a git checkout. */
function buildStamp() {
  const date = new Date().toISOString().slice(0, 10);
  try {
    const hash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return `${date}-${hash}`;
  } catch {
    return date;
  }
}

/* ------------------------------------------------------------------ main -- */

if (!existsSync(path.join(ROOT, 'saas', 'src'))) {
  console.error('[build-cloud] saas/src not found — run this from the project root.');
  process.exit(1);
}

const files = INCLUDE_ROOTS.flatMap((entry) => {
  const full = path.join(ROOT, entry);
  if (!existsSync(full)) return [];
  return statSync(full).isDirectory() ? collect(full, entry) : [{ rel: entry, data: readFileSync(full) }];
});

if (!existsSync(DIST)) mkdirSync(DIST, { recursive: true });

const stamp = buildStamp();
const filename = `chat-pilot-cloud-${stamp}.zip`;
const target = path.join(DIST, filename);
writeZip(target, files, 'chat-pilot');

const bytes = statSync(target).size;
console.log(`[build-cloud] ${files.length} files -> dist/cloud/${filename} (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
console.log('[build-cloud] unzip on the server as /var/www/chat-pilot, then follow docs/DEPLOY.md from "Secrets and .env" onward.');
console.log('[build-cloud] this ZIP has no node_modules and no .env — both are created on the server, not shipped.');
