import { createHash } from 'node:crypto';
import { col, nowIso } from '../db/mongo.ts';
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

/**
 * Always awaited by its callers (they are async anyway, for the database
 * write that led here), but never lets a failure here surface as theirs —
 * an audit entry that could not be written must never fail the request that
 * triggered it.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await col('audit_logs').insertOne({
      _id: newId() as never,
      account_id: entry.accountId ?? null,
      website_id: entry.websiteId ?? null,
      actor_type: entry.actorType,
      actor_id: entry.actorId ?? '',
      action: entry.action,
      target_type: entry.targetType ?? '',
      target_id: entry.targetId ?? '',
      ip_hash: hashIp(entry.ip),
      metadata: JSON.stringify(redactDeep(entry.metadata ?? {})).slice(0, 4000),
      created_at: nowIso(),
    });
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

export async function listAudit(opts: {
  accountId?: string;
  action?: string;
  limit?: number;
  offset?: number;
}): Promise<AuditRow[]> {
  const filter: Record<string, unknown> = {};
  if (opts.accountId) filter.account_id = opts.accountId;
  if (opts.action) filter.action = opts.action;

  const rows = await col('audit_logs')
    .find(filter)
    .sort({ created_at: -1 })
    .skip(opts.offset ?? 0)
    .limit(Math.min(opts.limit ?? 100, 500))
    .toArray();
  return rows.map(toAuditRow);
}

function toAuditRow(doc: Record<string, unknown>): AuditRow {
  return {
    id: doc._id as string,
    account_id: (doc.account_id as string | null) ?? null,
    website_id: (doc.website_id as string | null) ?? null,
    actor_type: doc.actor_type as string,
    actor_id: doc.actor_id as string,
    action: doc.action as string,
    target_type: doc.target_type as string,
    target_id: doc.target_id as string,
    metadata: doc.metadata as string,
    created_at: doc.created_at as string,
  };
}
