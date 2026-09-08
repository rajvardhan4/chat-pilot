#!/usr/bin/env node
/**
 * Builds an installable Chat Pilot plugin ZIP.
 *
 *   node scripts/build-plugin.mjs              build at the current version
 *   node scripts/build-plugin.mjs --bump patch bump 2.0.0 -> 2.0.1, then build
 *   node scripts/build-plugin.mjs --bump minor bump 2.0.0 -> 2.1.0, then build
 *   node scripts/build-plugin.mjs --bump major bump 2.0.0 -> 3.0.0, then build
 *   node scripts/build-plugin.mjs --set 2.3.1  set an exact version, then build
 *
 * Why a script rather than zipping by hand
 * ----------------------------------------
 * The version lives in two places that MUST agree: the plugin header WordPress
 * reads to offer an update, and the CHAT_PILOT_VERSION constant used for asset
 * cache-busting and sent to Chat Pilot Cloud on every request. Bumping one and
 * not the other produces a site that reports the wrong version and serves stale
 * CSS after an update. This script writes both, refuses to build if they
 * disagree, and names the ZIP after the version so builds are never confused.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_DIR = path.join(ROOT, 'wordpress-plugin', 'chat-pilot');
const MAIN_FILE = path.join(PLUGIN_DIR, 'chat-pilot.php');
const DIST = path.join(ROOT, 'dist', 'plugin');

/** Files and folders that must never ship to a customer. */
const EXCLUDE = [/^\.git/, /^node_modules$/, /\.DS_Store$/, /^Thumbs\.db$/, /~$/, /\.log$/];

/* --------------------------------------------------------------- version -- */

function readVersions() {
  const source = readFileSync(MAIN_FILE, 'utf8');
  const header = /^\s*\*\s*Version:\s*(.+)$/m.exec(source);
  const constant = /define\(\s*'CHAT_PILOT_VERSION',\s*'([^']+)'\s*\)/.exec(source);
  return {
    source,
    header: header ? header[1].trim() : null,
    constant: constant ? constant[1].trim() : null,
  };
}

function writeVersion(next) {
  const { source } = readVersions();
  const updated = source
    .replace(/^(\s*\*\s*Version:\s*).+$/m, `$1${next}`)
    .replace(/(define\(\s*'CHAT_PILOT_VERSION',\s*')[^']+('\s*\))/, `$1${next}$2`);
  writeFileSync(MAIN_FILE, updated);
}

function bump(version, part) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Cannot bump a non semver version: ${version}`);
  let [major, minor, patch] = match.slice(1).map(Number);
  if (part === 'major') { major += 1; minor = 0; patch = 0; }
  else if (part === 'minor') { minor += 1; patch = 0; }
  else patch += 1;
  return `${major}.${minor}.${patch}`;
}

/* ------------------------------------------------------------------- zip -- */

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function collect(dir, base = '') {
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    if (EXCLUDE.some((re) => re.test(entry))) continue;
    const full = path.join(dir, entry);
    const rel = base ? base + '/' + entry : entry;
    if (statSync(full).isDirectory()) out.push(...collect(full, rel));
    else out.push({ rel, data: readFileSync(full) });
  }
  return out;
}

function writeZip(target, files) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const file of files) {
    // Paths inside the archive are prefixed so WordPress unpacks the plugin
    // into wp-content/plugins/chat-pilot/, which is what the update mechanism
    // and the plugin slug both expect.
    const name = Buffer.from('chat-pilot/' + file.rel, 'utf8');
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

/* ------------------------------------------------------------------ main -- */

const args = process.argv.slice(2);
const bumpIndex = args.indexOf('--bump');
const setIndex = args.indexOf('--set');

if (bumpIndex !== -1) {
  const part = args[bumpIndex + 1];
  if (!['major', 'minor', 'patch'].includes(part)) {
    console.error('--bump needs major, minor or patch');
    process.exit(1);
  }
  const current = readVersions().header;
  const next = bump(current, part);
  writeVersion(next);
  console.log(`[build] version ${current} -> ${next}`);
} else if (setIndex !== -1) {
  const next = args[setIndex + 1];
  if (!/^\d+\.\d+\.\d+$/.test(next ?? '')) {
    console.error('--set needs a version like 2.1.0');
    process.exit(1);
  }
  writeVersion(next);
  console.log(`[build] version set to ${next}`);
}

const { header, constant } = readVersions();

if (!header || !constant) {
  console.error('[build] could not read the plugin version from chat-pilot.php');
  process.exit(1);
}
if (header !== constant) {
  console.error(
    `[build] version mismatch: header says ${header}, CHAT_PILOT_VERSION says ${constant}.\n` +
      '        Both must agree. Use --set to fix them together.',
  );
  process.exit(1);
}

if (!existsSync(DIST)) mkdirSync(DIST, { recursive: true });

const files = collect(PLUGIN_DIR);
const target = path.join(DIST, `chat-pilot-${header}.zip`);
writeZip(target, files);

const bytes = statSync(target).size;
console.log(`[build] ${files.length} files -> dist/plugin/chat-pilot-${header}.zip (${(bytes / 1024).toFixed(1)} KB)`);
console.log('[build] upload this file in WordPress: Plugins -> Add New -> Upload Plugin');
