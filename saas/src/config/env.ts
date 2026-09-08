/**
 * Centralised, validated runtime configuration.
 * Nothing else in the app reads process.env directly.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Minimal .env loader (no dependency); real env vars always win. */
function loadDotEnv(): void {
  const file = path.join(ROOT, '.env');
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnv();

function str(key: string, fallback: string): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}
function num(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) ? v : fallback;
}
function bool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

const NODE_ENV = str('NODE_ENV', 'development');
const isProd = NODE_ENV === 'production';
const isTest = NODE_ENV === 'test';

/**
 * Secrets must be explicitly configured in production. Outside production we
 * generate an ephemeral value so a fresh clone boots, but we say so loudly.
 */
function secret(key: string, bytes = 32): string {
  const v = process.env[key];
  if (v && v.length >= 32) return v;
  if (isProd) {
    throw new Error(
      `Missing required secret ${key}. Generate one with:\n` +
        `  node -e "console.log(require('crypto').randomBytes(${bytes}).toString('hex'))"`,
    );
  }
  const generated = randomBytes(bytes).toString('hex');
  if (!isTest) {
    // eslint-disable-next-line no-console
    console.warn(
      `[chat-pilot] WARNING: ${key} is not set. Using a throwaway value for this process only. ` +
        `Sessions and encrypted provider keys will not survive a restart.`,
    );
  }
  return generated;
}

export const env = {
  NODE_ENV,
  isProd,
  isTest,
  isDev: !isProd && !isTest,
  PORT: num('PORT', 4000),
  APP_URL: str('APP_URL', `http://localhost:${num('PORT', 4000)}`),

  DATABASE_FILE: isTest
    ? ':memory:'
    : path.resolve(ROOT, str('DATABASE_FILE', './data/chat-pilot.sqlite')),

  ENCRYPTION_KEY: secret('ENCRYPTION_KEY'),
  SESSION_SECRET: secret('SESSION_SECRET'),
  SITE_KEY_PEPPER: secret('SITE_KEY_PEPPER'),

  FORCE_HTTPS: bool('FORCE_HTTPS', isProd),
  TRUST_PROXY: bool('TRUST_PROXY', false),

  RATE_LIMIT_CHAT_PER_MINUTE: num('RATE_LIMIT_CHAT_PER_MINUTE', 20),
  RATE_LIMIT_AUTH_PER_15MIN: num('RATE_LIMIT_AUTH_PER_15MIN', 10),
  RATE_LIMIT_API_PER_MINUTE: num('RATE_LIMIT_API_PER_MINUTE', 120),

  UPLOAD_MAX_BYTES: num('UPLOAD_MAX_BYTES', 10 * 1024 * 1024),
  UPLOAD_DIR: path.resolve(ROOT, str('UPLOAD_DIR', './data/uploads')),

  PROVIDER_TIMEOUT_MS: num('PROVIDER_TIMEOUT_MS', 20_000),

  MAIL_TRANSPORT: str('MAIL_TRANSPORT', 'log'),
  MAIL_FROM: str('MAIL_FROM', 'no-reply@chatpilot.local'),

  SUPERADMIN_EMAIL: str('SUPERADMIN_EMAIL', ''),
  SUPERADMIN_PASSWORD: str('SUPERADMIN_PASSWORD', ''),
} as const;
