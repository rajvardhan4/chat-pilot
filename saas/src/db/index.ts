/**
 * Database access layer.
 *
 * A thin, typed wrapper over node:sqlite. Everything above this file speaks
 * `db.get / db.all / db.run / db.tx` only, so swapping the engine (Postgres,
 * better-sqlite3) means rewriting this file alone.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export type SqlValue = string | number | bigint | null | Uint8Array;
export type Row = Record<string, unknown>;

let handle: DatabaseSync | null = null;

function open(): DatabaseSync {
  if (handle) return handle;
  if (env.DATABASE_FILE !== ':memory:') {
    mkdirSync(path.dirname(env.DATABASE_FILE), { recursive: true });
  }
  const db = new DatabaseSync(env.DATABASE_FILE);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  handle = db;
  return db;
}

/** Normalises undefined -> null so callers can pass optional values freely. */
function normalise(params: unknown[]): SqlValue[] {
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (typeof p === 'number' || typeof p === 'bigint' || typeof p === 'string') return p;
    if (p instanceof Uint8Array) return p;
    return String(p);
  });
}

export const db = {
  raw: open,

  exec(sql: string): void {
    open().exec(sql);
  },

  run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
    const stmt = open().prepare(sql);
    const res = stmt.run(...normalise(params));
    return { changes: Number(res.changes), lastInsertRowid: res.lastInsertRowid };
  },

  get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
    const stmt = open().prepare(sql);
    const row = stmt.get(...normalise(params));
    return row === undefined ? undefined : (row as T);
  },

  all<T = Row>(sql: string, ...params: unknown[]): T[] {
    const stmt = open().prepare(sql);
    return stmt.all(...normalise(params)) as T[];
  },

  /** Scalar helper: SELECT COUNT(*) ... */
  scalar<T = number>(sql: string, ...params: unknown[]): T | undefined {
    const row = db.get<Record<string, T>>(sql, ...params);
    if (!row) return undefined;
    const first = Object.values(row)[0];
    return first as T;
  },

  /** Runs `fn` inside a transaction, rolling back on any throw. */
  tx<T>(fn: () => T): T {
    const conn = open();
    conn.exec('BEGIN');
    try {
      const result = fn();
      conn.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        conn.exec('ROLLBACK');
      } catch {
        /* connection already rolled back */
      }
      throw err;
    }
  },

  close(): void {
    if (handle) {
      handle.close();
      handle = null;
    }
  },
};

/**
 * Additive column migrations for databases created by an earlier schema
 * version. Each entry is applied only when the column is missing, so this is
 * safe to run on every boot.
 */
const COLUMN_MIGRATIONS: Array<{ table: string; column: string; definition: string }> = [
  { table: 'widget_settings', column: 'prechat_enabled', definition: 'INTEGER NOT NULL DEFAULT 1' },
  { table: 'accounts', column: 'monthly_budget_cents', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'accounts', column: 'budget_alert_percent', definition: 'INTEGER NOT NULL DEFAULT 80' },
  { table: 'websites', column: 'inactivity_timeout_minutes', definition: 'INTEGER NOT NULL DEFAULT 30' },
  { table: 'websites', column: 'retention_days', definition: 'INTEGER NOT NULL DEFAULT 90' },
];

function applyColumnMigrations(): void {
  for (const migration of COLUMN_MIGRATIONS) {
    const columns = db.all<{ name: string }>(`PRAGMA table_info(${migration.table})`);
    if (!columns.length) continue; // table not created yet
    if (columns.some((c) => c.name === migration.column)) continue;
    db.exec(
      `ALTER TABLE ${migration.table} ADD COLUMN ${migration.column} ${migration.definition}`,
    );
  }
}

/** Applies schema.sql. Idempotent (every statement is CREATE ... IF NOT EXISTS). */
export function migrate(): void {
  const sql = readFileSync(path.join(HERE, 'schema.sql'), 'utf8');
  const conn = open();
  conn.exec(sql);
  applyColumnMigrations();
  const version = '2026-09-07-001';
  const exists = db.get('SELECT version FROM schema_migrations WHERE version = ?', version);
  if (!exists) {
    db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', version, nowIso());
  }
}

export function nowIso(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export function toBool(v: unknown): boolean {
  return v === 1 || v === true || v === '1';
}
