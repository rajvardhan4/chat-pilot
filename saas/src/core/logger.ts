/**
 * Structured logging with automatic secret redaction.
 *
 * Anything that looks like a provider key, a Chat Pilot site key, a bearer
 * token or a `key=` query parameter is masked before it can reach stdout or
 * the system_logs table.
 */
import { db, nowIso } from '../db/index.ts';
import { newId } from './crypto.ts';
import { env } from '../config/env.ts';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const REDACTIONS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-***REDACTED***'],
  [/\bAIza[0-9A-Za-z_-]{10,}/g, 'AIza***REDACTED***'],
  [/\bcp_(live|test)_[A-Za-z0-9_-]+/g, 'cp_***REDACTED***'],
  [/([?&]key=)[^&\s"']+/gi, '$1***REDACTED***'],
  [/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1***REDACTED***'],
  [/("?(?:api[_-]?key|password|token|secret|authorization)"?\s*[:=]\s*"?)[^",\s}]+/gi, '$1***REDACTED***'],
];

export function redact(input: string): string {
  let out = input;
  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);
  return out;
}

export function redactDeep(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]';
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/^(api_?key|password|token|secret|authorization|key_hash|api_key_enc)$/i.test(k)) {
        out[k] = '***REDACTED***';
      } else {
        out[k] = redactDeep(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

let minLevel: LogLevel = env.isTest ? 'error' : env.isProd ? 'info' : 'debug';

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

export interface LogScope {
  accountId?: string | null;
  websiteId?: string | null;
}

function write(level: LogLevel, message: string, context: unknown, scope: LogScope = {}): void {
  if (RANK[level] < RANK[minLevel]) return;
  const safeMessage = redact(message);
  const safeContext = context === undefined ? {} : redactDeep(context);

  if (!env.isTest) {
    const line = `[${nowIso()}] ${level.toUpperCase()} ${safeMessage}`;
    if (level === 'error') console.error(line, safeContext);
    else if (level === 'warn') console.warn(line, safeContext);
    else console.log(line, safeContext);
  }

  try {
    db.run(
      `INSERT INTO system_logs (id, account_id, website_id, level, message, context, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      newId(),
      scope.accountId ?? null,
      scope.websiteId ?? null,
      level,
      safeMessage.slice(0, 2000),
      JSON.stringify(safeContext).slice(0, 8000),
      nowIso(),
    );
  } catch {
    /* logging must never break a request */
  }
}

export const log = {
  debug: (m: string, c?: unknown, s?: LogScope) => write('debug', m, c, s),
  info: (m: string, c?: unknown, s?: LogScope) => write('info', m, c, s),
  warn: (m: string, c?: unknown, s?: LogScope) => write('warn', m, c, s),
  error: (m: string, c?: unknown, s?: LogScope) => write('error', m, c, s),
};
