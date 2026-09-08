#!/usr/bin/env node
/**
 * Starts a throwaway MongoDB on this machine, for local development only.
 *
 *   npm run mongo:local
 *
 * Prints a connection string; paste it into saas/.env as MONGODB_URI and start
 * the app in another terminal. Data lives in memory: stopping this process
 * throws the whole database away, which is the point - it is a scratch pad,
 * not storage. Anything you want to keep belongs in a real MongoDB (Atlas).
 *
 * It is a replica set with a single member, not a standalone mongod, because
 * the app uses transactions (see withTransaction in src/db/mongo.ts) and
 * MongoDB only offers those on a replica set or a sharded cluster. Every Atlas
 * cluster is a replica set, free tier included, so this matches production.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const replset = await MongoMemoryReplSet.create({
  replSet: { count: 1, storageEngine: 'wiredTiger' },
});

console.log('\n  Local MongoDB is running. Put this in saas/.env:\n');
console.log('    MONGODB_URI=' + replset.getUri());
console.log('    MONGODB_DB=chatpilot\n');
console.log('  Leave this terminal open. Ctrl+C stops it and discards the data.\n');

const stop = async () => { await replset.stop(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
await new Promise(() => {});
