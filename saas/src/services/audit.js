import { createHash } from 'node:crypto';
import { col, nowIso } from "../db/mongo.js";
import { newId } from "../core/crypto.js";
import { redactDeep } from "../core/logger.js";
/** IPs are stored hashed so audit logs are useful without retaining raw PII. */
export function hashIp(ip) {
    if (!ip)
        return '';
    return createHash('sha256').update('chat-pilot-ip:' + ip).digest('hex').slice(0, 32);
}
/**
 * Always awaited by its callers (they are async anyway, for the database
 * write that led here), but never lets a failure here surface as theirs —
 * an audit entry that could not be written must never fail the request that
 * triggered it.
 */
export async function audit(entry) {
    try {
        await col('audit_logs').insertOne({
            _id: newId(),
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
    }
    catch {
        /* auditing must never break the request path */
    }
}
export async function listAudit(opts) {
    const filter = {};
    if (opts.accountId)
        filter.account_id = opts.accountId;
    if (opts.action)
        filter.action = opts.action;
    const rows = await col('audit_logs')
        .find(filter)
        .sort({ created_at: -1 })
        .skip(opts.offset ?? 0)
        .limit(Math.min(opts.limit ?? 100, 500))
        .toArray();
    return rows.map(toAuditRow);
}
function toAuditRow(doc) {
    return {
        id: doc._id,
        account_id: doc.account_id ?? null,
        website_id: doc.website_id ?? null,
        actor_type: doc.actor_type,
        actor_id: doc.actor_id,
        action: doc.action,
        target_type: doc.target_type,
        target_id: doc.target_id,
        metadata: doc.metadata,
        created_at: doc.created_at,
    };
}
