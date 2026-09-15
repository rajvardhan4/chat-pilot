#!/usr/bin/env node
/**
 * Builds an upload-ready ZIP for Hostinger's Node.js app manager (the hPanel
 * "Node.js" tool on shared Business/Cloud plans), where build-cloud.mjs targets
 * a VPS you have root on.
 *
 *   node scripts/build-hostinger.mjs
 *
 * Why this build COMPILES and the VPS build does not
 * --------------------------------------------------
 * Everywhere else, Chat Pilot runs its TypeScript directly: Node strips the
 * types at load time, so there is no build step to forget and no generated
 * output to drift from source. That needs Node 22.18+, where type stripping is
 * on by default.
 *
 * Hostinger's shared plans run Phusion Passenger with whatever Node they offer,
 * commonly 18 or 20. Those cannot load a .ts file at all - Passenger starts the
 * app, Node rejects the syntax, the process dies, and the panel shows a 503
 * with nothing in it that mentions TypeScript.
 *
 * So for this target only, tsc emits plain JavaScript first. tsconfig.json
 * already sets rewriteRelativeImportExtensions, so `import './app.ts'` becomes
 * `import './app.js'` in the output - the emitted tree needs no patching.
 *
 * The floor is then Node 20.19, set by the mongodb driver rather than by us.
 *
 * Layout
 * ------
 * Hostinger points "Application root" at the folder holding package.json, and
 * nothing may sit above it, so this archive puts everything at the ZIP root -
 * unlike the VPS build, which nests under chat-pilot/saas/.
 *
 * The compiled tree keeps the same shape as source (src/config/env.js, not
 * dist/config/env.js) because env.ts derives ROOT by walking two levels up from
 * itself, and app.ts then looks for src/views and src/public under it. Flatten
 * the tree and the views stop resolving.
 *
 * What is left out, and why
 *   node_modules     the panel runs npm install itself
 *   .env             secrets are entered in the panel's env-var UI
 *   tests/           needs devDependencies the panel will not install
 *   data/            runtime upload storage, created on first use
 *   *.ts             compiled away; shipping both would be ambiguous
 *   devDependencies  stripped from the shipped package.json - a plain
 *                    `npm install` would otherwise pull mongodb-memory-server,
 *                    which downloads a MongoDB binary on a machine that has no
 *                    business holding one
 *   package-lock     omitted deliberately: it still pins the devDependencies
 *                    removed above, so `npm ci` against it would fail
 */
import { execFileSync } from 'node:child_process';
import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'saas');
const DIST = path.join(ROOT, 'dist', 'hostinger');
const STAGE = path.join(APP, '_build-js');

/** The floor comes from the mongodb driver, not from this app's own code. */
const NODE_FLOOR = '>=20.19.0';

const EXCLUDE_ANYWHERE = [
  /^\.git$/, /^node_modules$/, /^\.DS_Store$/, /^Thumbs\.db$/, /~$/, /\.log$/,
];

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
    const name = Buffer.from(file.rel, 'utf8');
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

function buildStamp() {
  const date = new Date().toISOString().slice(0, 10);
  try {
    const hash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return `${date}-${hash}`;
  } catch {
    return date;
  }
}

/** Copies everything under src/ that tsc does not emit: views, css, js, images. */
function copyAssets(fromDir, toDir, relFromRoot = '') {
  let count = 0;
  for (const entry of readdirSync(fromDir)) {
    if (EXCLUDE_ANYWHERE.some((re) => re.test(entry))) continue;
    const full = path.join(fromDir, entry);
    const rel = relFromRoot ? relFromRoot + '/' + entry : entry;
    if (statSync(full).isDirectory()) {
      count += copyAssets(full, toDir, rel);
    } else if (!entry.endsWith('.ts')) {
      const dest = path.join(toDir, rel);
      mkdirSync(path.dirname(dest), { recursive: true });
      cpSync(full, dest);
      count += 1;
    }
  }
  return count;
}

const START_HERE = `CHAT PILOT CLOUD - Hostinger Node.js app (compiled build)
=========================================================

Ye build PLAIN JAVASCRIPT hai. Koi .ts file nahi - Hostinger ke purane Node
par bhi chalega.

Is ZIP ko application root folder ke ANDAR extract karo. package.json seedha
usi folder me dikhna chahiye, uske upar koi aur folder nahi.


hPanel -> Node.js me settings
-----------------------------
  Node version       20.19 ya usse naya  (mongodb driver ki zaroorat hai)
  Application root   wahi folder jahan ye ZIP extract kiya
  Startup file       server.js


Environment variables
---------------------
Alag se bheji gayi .env file se saari rows panel me daalo.

  >>> PORT MAT DAALNA <<<
  Passenger khud port/socket deta hai. Aap PORT set kar doge to app galat
  jagah sunega aur panel 503 dikhayega.

  APP_URL me apna asli domain daalo.


MongoDB Atlas
-------------
Shared hosting ka outbound IP badalta rehta hai, isliye Atlas me:
  Network Access -> Add IP Address -> ALLOW ACCESS FROM ANYWHERE (0.0.0.0/0)

Ye kiye bina app start hote hi crash hoga aur 503 aayega.


Deploy ke baad ek baar (SSH se)
-------------------------------
  cd <application root>
  npm run seed

Ye default plans banata hai, aur SUPERADMIN_EMAIL/PASSWORD set hon to master
admin bhi bana deta hai.


Kuch na chale to
----------------
  node -v                  version 20.19+ hona chahiye
  cat stderr.log           asli wajah yahan likhi hoti hai

App fail hone par saaf-saaf batata hai: database nahi mila, secret missing hai,
ya port galat hai. Log ki pehli 5 lines me jawab hota hai.
`;

/* ------------------------------------------------------------------ main -- */

if (!existsSync(path.join(APP, 'src'))) {
  console.error('[build-hostinger] saas/src not found — run this from the project root.');
  process.exit(1);
}

// 1. Compile TypeScript -> JavaScript.
console.log('[build-hostinger] compiling TypeScript...');
rmSync(STAGE, { recursive: true, force: true });
const buildConfig = path.join(APP, 'tsconfig.build.json');
writeFileSync(buildConfig, JSON.stringify({
  extends: './tsconfig.json',
  compilerOptions: {
    noEmit: false,
    rootDir: '.',
    outDir: './_build-js',
    declaration: false,
    sourceMap: false,
  },
  include: ['src/**/*.ts', 'scripts/**/*.ts'],
  exclude: ['tests/**/*'],
}, null, 2) + '\n');

// Invoke the local compiler through node rather than through npx: npx resolves
// differently across shells on Windows, and a build that cannot find its
// compiler should say so, not fail silently.
const tsc = path.join(APP, 'node_modules', 'typescript', 'bin', 'tsc');
if (!existsSync(tsc)) {
  console.error('[build-hostinger] typescript not installed — run `npm install` in saas/ first.');
  rmSync(buildConfig, { force: true });
  process.exit(1);
}
try {
  execFileSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], { cwd: APP, stdio: 'inherit' });
} catch {
  console.error('[build-hostinger] TypeScript compilation failed — build aborted.');
  rmSync(buildConfig, { force: true });
  process.exit(1);
}

// 2. Copy everything tsc does not emit: .ejs views, css, client js, images.
const assetCount = copyAssets(path.join(APP, 'src'), path.join(STAGE, 'src'));
console.log(`[build-hostinger] copied ${assetCount} view/asset files`);

// 3. A package.json for the shipped app: compiled entry points, a Node floor
//    that matches what actually runs, and no devDependencies.
const pkg = JSON.parse(readFileSync(path.join(APP, 'package.json'), 'utf8'));
const shipped = {
  name: pkg.name,
  version: pkg.version,
  private: true,
  type: 'module',
  description: pkg.description,
  engines: { node: NODE_FLOOR },
  scripts: {
    start: 'node server.js',
    seed: 'node scripts/seed.js',
    'admin:create': 'node scripts/create-admin.js',
  },
  dependencies: pkg.dependencies,
  overrides: pkg.overrides,
};
writeFileSync(path.join(STAGE, 'package.json'), JSON.stringify(shipped, null, 2) + '\n');

// 4. Passenger asks for a .js entry point by name; give it one that does nothing
//    but hand over to the compiled server.
writeFileSync(
  path.join(STAGE, 'server.js'),
  [
    '/**',
    ' * Entry point for Hostinger / Passenger.',
    ' *',
    ' * The real server is src/server.js (compiled from src/server.ts). This file',
    ' * exists because the panel asks for a startup file by name and only accepts',
    ' * a .js one. It holds no logic, so there is nothing here to keep in sync.',
    ' */',
    "import './src/server.js';",
    '',
  ].join('\n'),
);

writeFileSync(path.join(STAGE, 'START-HERE.txt'), START_HERE);
writeFileSync(path.join(STAGE, '.gitignore'), 'node_modules/\n.env\ndata/\n');

// 5. Zip the staging tree flat.
const files = collect(STAGE);
if (!existsSync(DIST)) mkdirSync(DIST, { recursive: true });
const target = path.join(DIST, `chat-pilot-hostinger-${buildStamp()}.zip`);
writeZip(target, files);

// 6. Leave the tree behind only in the archive.
rmSync(STAGE, { recursive: true, force: true });
rmSync(buildConfig, { force: true });

const sizeMb = (statSync(target).size / 1024 / 1024).toFixed(2);
const rel = path.relative(ROOT, target).replace(/\\/g, '/');
const jsCount = files.filter((f) => f.rel.endsWith('.js')).length;

console.log(`[build-hostinger] ${files.length} files (${jsCount} compiled JS) -> ${rel} (${sizeMb} MB)`);
console.log('[build-hostinger] plain JavaScript — no .ts files, runs on Node ' + NODE_FLOOR);
console.log('[build-hostinger] extract INTO the application root  |  startup file: server.js  |  do NOT set PORT');
