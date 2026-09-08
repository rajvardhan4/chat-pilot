/**
 * Database access layer — MongoDB.
 *
 * Replaces the SQLite port (src/db/index.ts, now retired) with the same
 * *shape* of responsibility — one file owns the connection, the schema
 * (as indexes), and the primitives everything else builds on — but a
 * different *interface*, because SQLite's driver is synchronous and
 * MongoDB's is not. That is not a detail this file can hide: every caller
 * that used to say `db.get(...)` now says `await mongo.findOne(...)`, and
 * that ripples through every service, every route handler, every test.
 * There is no way to migrate a synchronous storage engine to an
 * asynchronous one and keep the call sites unaware of it.
 *
 * What this file guarantees in exchange:
 *   - one collection per SQL table, same name, so a query in Compass or
 *     `mongosh` still reads like the schema this product was designed
 *     around;
 *   - every UNIQUE constraint and every secondary index from schema.sql
 *     reappears here as a real MongoDB index, created idempotently on
 *     connect;
 *   - cascading deletes, which SQLite enforced for free via
 *     `ON DELETE CASCADE`, are reimplemented explicitly and atomically —
 *     see cascadeDeleteWebsite / cascadeDeleteConversations /
 *     cascadeDeleteForm / cascadeDeleteKnowledgeSource below. MongoDB has
 *     no foreign keys, so "delete a website" has to say out loud every
 *     collection that dies with it.
 *
 * Every document's `_id` is the same opaque id the app already generates
 * with newId() (see core/crypto.ts) — a string, not a MongoDB ObjectId.
 * That keeps every id the app already logs, signs into a URL, or hands to
 * a customer unchanged in shape, and it means a document's `_id` and its
 * old SQL `id` column are the same value.
 */
import { MongoClient, type ClientSession, type Collection } from 'mongodb';
import { env } from '../config/env.ts';

/**
 * Every document in this app has a string `_id` — the same opaque id newId()
 * already generates — never the driver's default ObjectId. Collection<T>'s
 * own `Document` default types `_id` as ObjectId, which is wrong for every
 * collection here; this is the default every `col()` call gets instead,
 * so a call site that doesn't bother naming a specific doc interface still
 * gets a string _id rather than fighting the compiler about ObjectId.
 */
export interface AppDocument {
  _id: string;
  [key: string]: unknown;
}

let client: MongoClient | null = null;
let connecting: Promise<MongoClient> | null = null;

async function connect(): Promise<MongoClient> {
  if (client) return client;
  if (connecting) return connecting;
  connecting = (async () => {
    const c = new MongoClient(env.MONGODB_URI, {
      // Fixed API version pins wire behaviour across server upgrades, so an
      // Atlas maintenance bump can't silently change a driver default under
      // production traffic.
      serverApi: { version: '1', strict: true, deprecationErrors: true },
    });
    await c.connect();
    client = c;
    connecting = null;
    return c;
  })();
  return connecting;
}

function db() {
  if (!client) throw new Error('MongoDB is not connected yet — call connectDb() at startup.');
  return client.db(env.MONGODB_DB);
}

/**
 * Typed collection accessor. Every service imports this, never MongoClient
 * directly.
 *
 * The constraint is deliberately looser than the default: a plain interface
 * like `{ _id: string; billing_email: string }` has no index signature, and
 * TypeScript does not consider an un-indexed interface assignable to one that
 * has one - so requiring `AppDocument` here would reject every narrow,
 * single-purpose projection type call sites declare inline. Requiring only
 * `{ _id: string }` accepts those while `col('name')` with no generic still
 * defaults to the fully permissive `AppDocument`.
 */
export function col<T extends { _id: string } = AppDocument>(name: CollectionName): Collection<T> {
  return db().collection<T>(name);
}

/**
 * Runs `fn` inside a MongoDB multi-document transaction, retrying the whole
 * attempt on a transient transaction error (the driver's documented pattern
 * for it) rather than surfacing a spurious failure on ordinary contention.
 *
 * Requires a replica set — a lone standalone `mongod` cannot run
 * transactions at all. Atlas is always a replica set, including the free
 * tier, so this is never a concern in production; local development and
 * tests use `mongodb-memory-server`'s replica-set mode for the same reason.
 */
export async function withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = (await connect()).startSession();
  try {
    let result: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result!;
  } finally {
    await session.endSession();
  }
}

export async function connectDb(): Promise<void> {
  await connect();
  await ensureIndexes();
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}

export function nowIso(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export function toBool(v: unknown): boolean {
  return v === true || v === 1 || v === '1';
}

/* --------------------------------------------------------------- schema -- */

/**
 * Every collection this product uses. Kept as a union type, not a bare
 * string, so a typo in a collection name is a compile error rather than a
 * query that silently returns nothing against a collection that doesn't
 * exist.
 */
export type CollectionName =
  | 'users' | 'accounts' | 'account_members' | 'sessions' | 'password_resets'
  | 'plans' | 'subscriptions'
  | 'websites' | 'website_domains' | 'site_api_credentials'
  | 'ai_provider_credentials' | 'ai_provider_configs' | 'ai_provider_models'
  | 'knowledge_sources' | 'knowledge_documents' | 'uploaded_files'
  | 'ai_instructions' | 'widget_settings'
  | 'forms' | 'form_fields' | 'visitors' | 'form_submissions'
  | 'conversations' | 'messages'
  | 'ai_requests' | 'usage_records' | 'analytics_events'
  | 'notifications' | 'audit_logs' | 'system_logs' | 'platform_settings'
  | 'schema_migrations';

/**
 * One entry per index. `unique` mirrors a SQL `UNIQUE` constraint exactly —
 * getting one of these wrong is a data-integrity bug, not a performance one,
 * so this list is the single source of truth for what schema.sql used to
 * enforce.
 */
const INDEXES: Array<{
  collection: CollectionName;
  key: Record<string, 1 | -1>;
  unique?: boolean;
  name: string;
}> = [
  // -------------------------------------------------------------- identity
  { collection: 'users', key: { email_normalized: 1 }, unique: true, name: 'uniq_email_normalized' },
  { collection: 'users', key: { platform_role: 1 }, name: 'idx_role' },
  { collection: 'accounts', key: { slug: 1 }, unique: true, name: 'uniq_slug' },
  { collection: 'accounts', key: { status: 1 }, name: 'idx_status' },
  { collection: 'account_members', key: { account_id: 1, user_id: 1 }, unique: true, name: 'uniq_account_user' },
  { collection: 'account_members', key: { user_id: 1 }, name: 'idx_user' },
  { collection: 'sessions', key: { user_id: 1 }, name: 'idx_user' },
  { collection: 'password_resets', key: { token_hash: 1 }, unique: true, name: 'uniq_token_hash' },

  // ------------------------------------------------------- plans / billing
  { collection: 'plans', key: { slug: 1 }, unique: true, name: 'uniq_slug' },
  { collection: 'subscriptions', key: { account_id: 1 }, name: 'idx_account' },

  // --------------------------------------------------------------websites
  { collection: 'websites', key: { account_id: 1, primary_domain: 1 }, unique: true, name: 'uniq_account_domain' },
  { collection: 'websites', key: { account_id: 1 }, name: 'idx_account' },
  { collection: 'websites', key: { primary_domain: 1 }, name: 'idx_domain' },
  { collection: 'website_domains', key: { website_id: 1, domain: 1 }, unique: true, name: 'uniq_website_domain' },
  { collection: 'website_domains', key: { domain: 1 }, name: 'idx_domain' },

  // --------------------------------------------------------- site api keys
  { collection: 'site_api_credentials', key: { key_id: 1 }, unique: true, name: 'uniq_key_id' },
  { collection: 'site_api_credentials', key: { website_id: 1 }, name: 'idx_website' },
  { collection: 'site_api_credentials', key: { key_hash: 1 }, name: 'idx_key_hash' },

  // ------------------------------------------------------------- providers
  { collection: 'ai_provider_credentials', key: { website_id: 1, provider: 1 }, unique: true, name: 'uniq_website_provider' },
  { collection: 'ai_provider_credentials', key: { account_id: 1 }, name: 'idx_account' },
  { collection: 'ai_provider_configs', key: { website_id: 1 }, unique: true, name: 'uniq_website' },
  { collection: 'ai_provider_models', key: { website_id: 1, provider: 1, model_id: 1 }, unique: true, name: 'uniq_website_provider_model' },

  // ------------------------------------------------------------ knowledge
  { collection: 'knowledge_sources', key: { website_id: 1, type: 1 }, name: 'idx_website_type' },
  { collection: 'knowledge_documents', key: { website_id: 1, status: 1 }, name: 'idx_website_status' },
  { collection: 'knowledge_documents', key: { source_id: 1 }, name: 'idx_source' },

  // ------------------------------------------------------------- widget
  { collection: 'ai_instructions', key: { website_id: 1 }, unique: true, name: 'uniq_website' },
  { collection: 'widget_settings', key: { website_id: 1 }, unique: true, name: 'uniq_website' },

  // --------------------------------------------------------------- forms
  { collection: 'forms', key: { website_id: 1 }, name: 'idx_website' },
  { collection: 'form_fields', key: { form_id: 1 }, name: 'idx_form' },
  { collection: 'visitors', key: { website_id: 1, visitor_key: 1 }, unique: true, name: 'uniq_website_visitor' },
  { collection: 'form_submissions', key: { website_id: 1 }, name: 'idx_website' },
  { collection: 'form_submissions', key: { website_id: 1, session_key: 1 }, name: 'idx_website_session' },

  // --------------------------------------------------------- conversations
  { collection: 'conversations', key: { website_id: 1, session_key: 1 }, unique: true, name: 'uniq_website_session' },
  { collection: 'conversations', key: { website_id: 1, created_at: 1 }, name: 'idx_website_created' },
  { collection: 'conversations', key: { website_id: 1, status: 1 }, name: 'idx_website_status' },
  { collection: 'messages', key: { conversation_id: 1, seq: 1 }, name: 'idx_conversation_seq' },

  // ----------------------------------------------------------- ai requests
  { collection: 'ai_requests', key: { website_id: 1, created_at: 1 }, name: 'idx_website_created' },
  { collection: 'ai_requests', key: { account_id: 1, created_at: 1 }, name: 'idx_account_created' },
  { collection: 'usage_records', key: { website_id: 1, period: 1 }, unique: true, name: 'uniq_website_period' },
  { collection: 'usage_records', key: { account_id: 1, period: 1 }, name: 'idx_account_period' },
  { collection: 'analytics_events', key: { website_id: 1, created_at: 1 }, name: 'idx_website_created' },

  // -------------------------------------------------------------- ops/audit
  { collection: 'notifications', key: { dedupe_key: 1, created_at: 1 }, name: 'idx_dedupe' },
  { collection: 'audit_logs', key: { account_id: 1, created_at: 1 }, name: 'idx_account_created' },
  { collection: 'audit_logs', key: { action: 1, created_at: 1 }, name: 'idx_action_created' },
  { collection: 'system_logs', key: { created_at: 1 }, name: 'idx_created' },
];

/** Creates every index in INDEXES. Idempotent — safe on every boot. */
async function ensureIndexes(): Promise<void> {
  for (const spec of INDEXES) {
    await col(spec.collection).createIndex(spec.key, { unique: Boolean(spec.unique), name: spec.name });
  }
}

/* ------------------------------------------------------- cascade deletes --
 *
 * SQLite enforced these for free via ON DELETE CASCADE. MongoDB does not, so
 * each parent-delete site that used to rely on it now calls one of these —
 * every one runs inside a transaction, so a website (or a conversation, or a
 * form, or a knowledge source) and everything under it disappear atomically,
 * exactly as the foreign-key cascade did.
 */

/** Deletes a website and every document that belonged to it, atomically. */
export async function cascadeDeleteWebsite(websiteId: string): Promise<void> {
  await withTransaction(async (session) => {
    const conversationIds = await col('conversations')
      .find({ website_id: websiteId }, { session, projection: { _id: 1 } })
      .map((d) => d._id as string)
      .toArray();

    const byWebsite: CollectionName[] = [
      'website_domains', 'site_api_credentials',
      'ai_provider_credentials', 'ai_provider_configs', 'ai_provider_models',
      'knowledge_sources', 'knowledge_documents', 'uploaded_files',
      'ai_instructions', 'widget_settings',
      'forms', 'form_fields', 'visitors', 'form_submissions',
      'conversations', 'ai_requests', 'usage_records', 'analytics_events',
    ];
    for (const collection of byWebsite) {
      await col(collection).deleteMany({ website_id: websiteId }, { session });
    }
    if (conversationIds.length) {
      await col('messages').deleteMany({ conversation_id: { $in: conversationIds } }, { session });
    }
    await col('websites').deleteOne({ _id: websiteId as never }, { session });
  });
}

/** Deletes conversations matching `filter` and every message under them. */
export async function cascadeDeleteConversations(
  filter: Record<string, unknown>,
): Promise<number> {
  return withTransaction(async (session) => {
    const ids = await col('conversations')
      .find(filter, { session, projection: { _id: 1 } })
      .map((d) => d._id as string)
      .toArray();
    if (!ids.length) return 0;
    await col('messages').deleteMany({ conversation_id: { $in: ids } }, { session });
    const result = await col('conversations').deleteMany({ _id: { $in: ids as never[] } }, { session });
    return result.deletedCount;
  });
}

/** Deletes a form and its fields; matching submissions are cascaded too. */
export async function cascadeDeleteForm(
  formId: string,
  websiteId: string,
  accountId: string,
): Promise<boolean> {
  return withTransaction(async (session) => {
    const existing = await col('forms').findOne(
      { _id: formId as never, website_id: websiteId, account_id: accountId },
      { session },
    );
    if (!existing) return false;
    await col('form_fields').deleteMany({ form_id: formId }, { session });
    await col('form_submissions').deleteMany({ form_id: formId }, { session });
    await col('forms').deleteOne({ _id: formId as never }, { session });
    return true;
  });
}

/** Deletes a knowledge source and every document under it. */
export async function cascadeDeleteKnowledgeSource(
  sourceId: string,
  websiteId: string,
  accountId: string,
): Promise<boolean> {
  return withTransaction(async (session) => {
    const existing = await col('knowledge_sources').findOne(
      { _id: sourceId as never, website_id: websiteId, account_id: accountId },
      { session },
    );
    if (!existing) return false;
    await col('knowledge_documents').deleteMany({ source_id: sourceId }, { session });
    await col('knowledge_sources').deleteOne({ _id: sourceId as never }, { session });
    return true;
  });
}
