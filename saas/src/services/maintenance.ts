/**
 * Scheduled housekeeping.
 *
 * Two jobs, both carried over from the v1 Conversations settings:
 *
 *  1. Inactive conversations move from 'active' to 'completed' after the
 *     website's configured timeout, so the Conversations screen reflects what
 *     is actually live.
 *  2. Conversations past the website's retention window are deleted, along with
 *     their messages, form submissions and per-request analytics rows.
 *
 * Aggregate usage rows are deliberately NOT purged: they carry no visitor data
 * and the customer needs the history for billing and trend reporting.
 */
import { cascadeDeleteConversations, col, nowIso } from '../db/mongo.ts';
import { log } from '../core/logger.ts';

export interface MaintenanceReport {
  completed: number;
  purgedConversations: number;
  purgedSubmissions: number;
  purgedAiRequests: number;
  purgedSessions: number;
  purgedLogs: number;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
}

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');
}

/** Marks conversations idle beyond each website's timeout as completed. */
export async function completeInactive(): Promise<number> {
  const websites = await col<{ _id: string; inactivity_timeout_minutes: number }>('websites')
    .find({}, { projection: { inactivity_timeout_minutes: 1 } })
    .toArray();

  let total = 0;
  for (const site of websites) {
    const minutes = Number(site.inactivity_timeout_minutes ?? 30);
    if (minutes <= 0) continue;
    const result = await col('conversations').updateMany(
      { website_id: site._id, status: 'active', last_activity_at: { $lt: isoMinutesAgo(minutes) } },
      { $set: { status: 'completed', updated_at: nowIso() } },
    );
    total += result.modifiedCount;
  }
  return total;
}

/** Deletes conversation data past each website's retention window. */
export async function purgeExpired(): Promise<Omit<MaintenanceReport, 'completed' | 'purgedSessions' | 'purgedLogs'>> {
  const websites = await col<{ _id: string; retention_days: number }>('websites')
    .find({}, { projection: { retention_days: 1 } })
    .toArray();

  let purgedConversations = 0;
  let purgedSubmissions = 0;
  let purgedAiRequests = 0;

  for (const site of websites) {
    const days = Number(site.retention_days ?? 0);
    if (days <= 0) continue; // 0 means keep forever
    const cutoff = isoDaysAgo(days);

    // Messages cascade with their conversations (see cascadeDeleteConversations).
    purgedConversations += await cascadeDeleteConversations({ website_id: site._id, created_at: { $lt: cutoff } });

    purgedSubmissions += (await col('form_submissions').deleteMany({ website_id: site._id, created_at: { $lt: cutoff } })).deletedCount;
    purgedAiRequests += (await col('ai_requests').deleteMany({ website_id: site._id, created_at: { $lt: cutoff } })).deletedCount;

    await col('analytics_events').deleteMany({ website_id: site._id, created_at: { $lt: cutoff } });
    await col('visitors').deleteMany({ website_id: site._id, last_seen_at: { $lt: cutoff } });
  }

  return { purgedConversations, purgedSubmissions, purgedAiRequests };
}

/** Drops expired portal sessions and old platform logs. */
export async function purgePlatformData(): Promise<{ sessions: number; logs: number }> {
  const sessions = (await col('sessions').deleteMany({ expires_at: { $lt: nowIso() } })).deletedCount;
  const logs = (await col('system_logs').deleteMany({ created_at: { $lt: isoDaysAgo(30) } })).deletedCount;
  await col('password_resets').deleteMany({ expires_at: { $lt: nowIso() } });
  await col('notifications').deleteMany({ created_at: { $lt: isoDaysAgo(90) } });
  return { sessions, logs };
}

export async function runMaintenance(): Promise<MaintenanceReport> {
  const completed = await completeInactive();
  const purged = await purgeExpired();
  const platform = await purgePlatformData();

  const report: MaintenanceReport = {
    completed,
    ...purged,
    purgedSessions: platform.sessions,
    purgedLogs: platform.logs,
  };

  if (Object.values(report).some((value) => value > 0)) {
    log.info('Maintenance sweep completed.', report);
  }
  return report;
}

/**
 * Starts the periodic sweep. Returns a stop function.
 * Not started in tests, where maintenance is invoked explicitly.
 */
export function startMaintenanceSchedule(intervalMs = 15 * 60_000): () => void {
  const timer = setInterval(() => {
    runMaintenance().catch((err) => {
      log.error('Maintenance sweep failed.', { error: err instanceof Error ? err.message : String(err) });
    });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
