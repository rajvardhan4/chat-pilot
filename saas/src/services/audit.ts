import { createHash } from 'node:crypto';
import { db, nowIso } from '../db/index.ts';
import { newId } from '../core/crypto.ts';
import { redactDeep } from '../core/logger.ts';

export type ActorType = 'user' | 'super_admin' | 'site_key' | 'system';

export interface AuditEntry {
  accountId?: string | null;
  websiteId?: string | null;
  actorType: ActorType;
  actorId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  ip?: string;
  metadata?: unknown;
}

/** IPs are stored hashed so audit logs are useful without retaining raw PII. */
export function hashIp(ip: string | undefined | null): string {
  if (!ip) return '';
  return createHash('sha256').update('chat-pilot-ip:' + ip).digest('hex').slice(0, 32);
}

export function audit(entry: AuditEntry): void {
  try {
    db.run(
      `INSERT INTO audit_logs
         (id, account_id, website_id, actor_type, actor_id, action, target_type, target_id, ip_hash, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId(),
      entry.accountId ?? null,
      entry.websiteId ?? null,
      entry.actorType,
      entry.actorId ?? '',
      entry.action,
      entry.targetType ?? '',
      entry.targetId ?? '',
      hashIp(entry.ip),
      JSON.stringify(redactDeep(entry.metadata ?? {})).slice(0, 4000),
      nowIso(),
    );
  } catch {
    /* auditing must never break the request path */
  }
}

export interface AuditRow {
  id: string;
  account_id: string | null;
  website_id: string | null;
  actor_type: string;
  actor_id: string;
  action: string;
  target_type: string;
  target_id: string;
  metadata: string;
  created_at: string;
}

export function listAudit(opts: {
  accountId?: string;
  action?: string;
  limit?: number;
  offset?: number;
}): AuditRow[] {
  const where: string[] = ['1 = 1'];
  const params: unknown[] = [];
  if (opts.accountId) {
    where.push('account_id = ?');
    params.push(opts.accountId);
  }
  if (opts.action) {
    where.push('action = ?');
    params.push(opts.action);
  }
  params.push(Math.min(opts.limit ?? 100, 500), opts.offset ?? 0);
  return db.all<AuditRow>(
    `SELECT * FROM audit_logs WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ...params,
  );
}
