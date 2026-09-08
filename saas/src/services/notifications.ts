/**
 * Administrative notifications.
 *
 * Two rules from the product spec are enforced here:
 *   1. Storage never depends on delivery. The record is written first; a mail
 *      failure is recorded on the row and never propagates to the caller.
 *   2. Provider-failure alerts are de-duplicated so a broken key cannot
 *      generate an email storm.
 */
import { createHash } from 'node:crypto';
import { db, nowIso } from '../db/index.ts';
import { env } from '../config/env.ts';
import { newId } from '../core/crypto.ts';
import { log, redact } from '../core/logger.ts';
import type { ConversationRow } from './conversations.ts';

const PROVIDER_ALERT_WINDOW_MINUTES = 60;

export interface NotificationInput {
  accountId?: string | null;
  websiteId?: string | null;
  type: string;
  severity?: 'info' | 'warning' | 'error';
  recipient: string;
  subject: string;
  body: string;
  dedupeKey?: string;
  dedupeWindowMinutes?: number;
  /**
   * Set only for messages whose whole purpose is to carry a one-time
   * credential (password reset). The stored copy then contains that token, so
   * the notifications table inherits the same sensitivity as an inbox: it is
   * reachable by the account owner and platform admins only, and the token is
   * single-use with a one-hour expiry.
   */
  allowSecretsInBody?: boolean;
}

function recentlySent(dedupeKey: string, windowMinutes: number): boolean {
  if (!dedupeKey) return false;
  const cutoff = new Date(Date.now() - windowMinutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');
  return Boolean(
    db.get('SELECT id FROM notifications WHERE dedupe_key = ? AND created_at > ? LIMIT 1', dedupeKey, cutoff),
  );
}

/** Records the notification, then attempts delivery. Never throws. */
export function enqueueNotification(input: NotificationInput): string | null {
  try {
    if (input.dedupeKey && recentlySent(input.dedupeKey, input.dedupeWindowMinutes ?? 60)) {
      return null;
    }
    const id = newId();
    db.run(
      `INSERT INTO notifications
         (id, account_id, website_id, type, severity, recipient, subject, body, dedupe_key, delivered, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      id, input.accountId ?? null, input.websiteId ?? null, input.type,
      input.severity ?? 'info', input.recipient,
      redact(input.subject).slice(0, 250),
      (input.allowSecretsInBody ? input.body : redact(input.body)).slice(0, 8000),
      input.dedupeKey ?? '', nowIso(),
    );

    deliver(id, input);
    return id;
  } catch (err) {
    log.error('Failed to record a notification.', { type: input.type });
    return null;
  }
}

/**
 * Delivery transport. `log` is the default and simply records the attempt;
 * an SMTP transport is the documented production configuration point.
 */
function deliver(id: string, input: NotificationInput): void {
  try {
    if (env.MAIL_TRANSPORT === 'log') {
      log.info('Notification queued (transport=log).', {
        type: input.type, recipient: input.recipient, subject: input.subject,
      }, { accountId: input.accountId ?? null, websiteId: input.websiteId ?? null });
      db.run('UPDATE notifications SET delivered = 1 WHERE id = ?', id);
      return;
    }
    // No SMTP transport is bundled. Mark undelivered with a clear reason so
    // the platform owner can see exactly what is missing.
    db.run(
      'UPDATE notifications SET delivered = 0, delivery_error = ? WHERE id = ?',
      'No mail transport configured (MAIL_TRANSPORT=' + env.MAIL_TRANSPORT + ').', id,
    );
  } catch {
    /* delivery must never break the request */
  }
}

/* ----------------------------------------------------------- triggers -- */

function accountNotificationEmail(accountId: string): string {
  const row = db.get<{ billing_email: string }>('SELECT billing_email FROM accounts WHERE id = ?', accountId);
  return row?.billing_email ?? '';
}

export function notifyNewLead(submission: {
  account_id: string;
  website_id: string;
  id: string;
  name: string;
  email: string;
  phone: string;
  page_url: string;
}): void {
  const recipient = accountNotificationEmail(submission.account_id);
  if (!recipient) return;
  enqueueNotification({
    accountId: submission.account_id,
    websiteId: submission.website_id,
    type: 'lead.created',
    severity: 'info',
    recipient,
    subject: 'New Chat Pilot lead captured',
    body: [
      'A visitor submitted your pre-chat form.',
      'Name: ' + (submission.name || '(not provided)'),
      'Email: ' + (submission.email || '(not provided)'),
      'Phone: ' + (submission.phone || '(not provided)'),
      'Page: ' + (submission.page_url || '(unknown)'),
    ].join('\n'),
  });
}

export function notifyNewConversation(conversation: ConversationRow): void {
  const recipient = accountNotificationEmail(conversation.account_id);
  if (!recipient) return;
  enqueueNotification({
    accountId: conversation.account_id,
    websiteId: conversation.website_id,
    type: 'conversation.started',
    severity: 'info',
    recipient,
    subject: 'New Chat Pilot conversation started',
    body:
      'A new conversation started on your website.\n' +
      'Source: ' + conversation.source + '\n' +
      'Visitor: ' + (conversation.visitor_name || 'Anonymous'),
    dedupeKey: 'conversation:' + conversation.id,
    dedupeWindowMinutes: 60 * 24,
  });
}

export function notifyProviderFailure(failure: {
  accountId: string;
  websiteId: string;
  provider: string;
  model: string;
  errorType: string;
  errorLabel: string;
  message: string;
  httpStatus: number;
}): void {
  const recipient = accountNotificationEmail(failure.accountId);
  const dedupeKey = createHash('sha256')
    .update([failure.websiteId, failure.provider, failure.errorType].join('|'))
    .digest('hex')
    .slice(0, 32);

  enqueueNotification({
    accountId: failure.accountId,
    websiteId: failure.websiteId,
    type: 'provider.failure',
    severity: 'error',
    recipient: recipient || env.MAIL_FROM,
    subject: 'Chat Pilot: AI provider failure (' + failure.errorLabel + ')',
    body: [
      'Chat Pilot could not generate a response using your configured AI provider.',
      'Provider: ' + failure.provider,
      'Model: ' + failure.model,
      'Category: ' + failure.errorLabel,
      'HTTP status: ' + failure.httpStatus,
      'Detail: ' + failure.message,
      '',
      'Visitors saw your configured generation-error message; no technical detail was exposed.',
    ].join('\n'),
    dedupeKey,
    dedupeWindowMinutes: PROVIDER_ALERT_WINDOW_MINUTES,
  });
}

export function listNotifications(accountId: string, limit = 50) {
  return db.all<Record<string, unknown>>(
    'SELECT * FROM notifications WHERE account_id = ? ORDER BY created_at DESC LIMIT ?',
    accountId, Math.min(limit, 200),
  );
}
