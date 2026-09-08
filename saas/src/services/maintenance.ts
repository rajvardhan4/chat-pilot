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
import { db, nowIso } from '../db/index.ts';
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
export function completeInactive(): number {
  const websites = db.all<{ id: string; inactivity_timeout_minutes: number }>(
    'SELECT id, inactivity_timeout_minutes FROM websites',
  );

  let total = 0;
  for (const site of websites) {
    const minutes = Number(site.inactivity_timeout_minutes ?? 30);
    if (minutes <= 0) continue;
    const result = db.run(
      `UPDATE conversations SET status = 'completed', updated_at = ?
        WHERE website_id = ? AND status = 'active' AND last_activity_at < ?`,
      nowIso(), site.id, isoMinutesAgo(minutes),
    );
    total += result.changes;
  }
  return total;
}

/** Deletes conversation data past each website's retention window. */
export function purgeExpired(): Omit<MaintenanceReport, 'completed' | 'purgedSessions' | 'purgedLogs'> {
  const websites = db.all<{ id: string; retention_days: number }>(
    'SELECT id, retention_days FROM websites',
  );

  let purgedConversations = 0;
  let purgedSubmissions = 0;
  let purgedAiRequests = 0;

  for (const site of websites) {
    const days = Number(site.retention_days ?? 0);
    if (days <= 0) continue; // 0 means keep forever
    const cutoff = isoDaysAgo(days);

    db.tx(() => {
      // messages cascade from conversations via the foreign key.
      purgedConversations += db.run(
        'DELETE FROM conversations WHERE website_id = ? AND created_at < ?',
        site.id, cutoff,
      ).changes;

      purgedSubmissions += db.run(
        'DELETE FROM form_submissions WHERE website_id = ? AND created_at < ?',
        site.id, cutoff,
      ).changes;

      purgedAiRequests += db.run(
        'DELETE FROM ai_requests WHERE website_id = ? AND created_at < ?',
        site.id, cutoff,
      ).changes;

      db.run('DELETE FROM analytics_events WHERE website_id = ? AND created_at < ?', site.id, cutoff);
      db.run(
        'DELETE FROM visitors WHERE website_id = ? AND last_seen_at < ?',
        site.id, cutoff,
      );
    });
  }

  return { purgedConversations, purgedSubmissions, purgedAiRequests };
}

/** Drops expired portal sessions and old platform logs. */
export function purgePlatformData(): { sessions: number; logs: number } {
  const sessions = db.run('DELETE FROM sessions WHERE expires_at < ?', nowIso()).changes;
  const logs = db.run('DELETE FROM system_logs WHERE created_at < ?', isoDaysAgo(30)).changes;
  db.run('DELETE FROM password_resets WHERE expires_at < ?', nowIso());
  db.run('DELETE FROM notifications WHERE created_at < ?', isoDaysAgo(90));
  return { sessions, logs };
}

export function runMaintenance(): MaintenanceReport {
  const completed = completeInactive();
  const purged = purgeExpired();
  const platform = purgePlatformData();

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
    try {
      runMaintenance();
    } catch (err) {
      log.error('Maintenance sweep failed.', { error: err instanceof Error ? err.message : String(err) });
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
