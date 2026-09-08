#!/usr/bin/env node
/**
 * Test runner wrapper.
 *
 * Node's test runner isolates every test FILE in its own process by default,
 * which is exactly what src/config/env.ts relies on for per-file database
 * isolation (see MONGODB_DB there) — but it also means there is no shared
 * module state to start a database in once and hand to every file. This
 * script is that missing "once": it starts a single throwaway MongoDB
 * replica set, points every test-file process at it via MONGODB_URI, and
 * tears it down when the whole run finishes.
 *
 * `wiredTiger` is requested explicitly because mongodb-memory-server's other
 * storage engine, `ephemeralForTest`, cannot run multi-document
 * transactions at all — and this app uses them (see withTransaction in
 * src/db/mongo.ts), so a test run on the wrong engine would pass everything
 * except transactional code paths, silently.
 */
import { spawn } from 'node:child_process';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const replSet = await MongoMemoryReplSet.create({
  replSet: { count: 1, storageEngine: 'wiredTiger' },
});

const uri = replSet.getUri();
console.log('[run-tests] MongoDB replica set ready.');

const child = spawn(
  process.execPath,
  ['--no-warnings', '--test', 'tests/*.test.ts'],
  {
    stdio: 'inherit',
    env: { ...process.env, MONGODB_URI: uri },
  },
);

const code = await new Promise((resolve) => {
  child.on('exit', (exitCode, signal) => resolve(exitCode ?? (signal ? 1 : 0)));
});

await replSet.stop();
process.exit(code);
