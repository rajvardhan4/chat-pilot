/**
 * Standalone migration entry point (`npm run migrate`).
 *
 * "Migrating" a MongoDB database means ensuring its indexes exist — there is
 * no schema to apply. connectDb() does exactly that, idempotently, which is
 * also why every other entry point (the server, the seed script, the admin
 * CLI) calls it directly rather than needing this file first.
 */
import { connectDb, closeDb } from './mongo.ts';

await connectDb();
console.log('[chat-pilot] MongoDB indexes ensured.');
await closeDb();
