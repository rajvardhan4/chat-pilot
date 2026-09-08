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
import { col, nowIso } from '../db/mongo.ts';
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

async function recentlySent(dedupeKey: string, windowMinutes: number): Promise<boolean> {
  if (!dedupeKey) return false;
  const cutoff = new Date(Date.now() - windowMinutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');
  const row = await col('notifications').findOne(
    { dedupe_key: dedupeKey, created_at: { $gt: cutoff } },
    { projection: { _id: 1 } },
  );
  return Boolean(row);
}

/** Records the notification, then attempts delivery. Never throws. */
export async function enqueueNotification(input: NotificationInput): Promise<string | null> {
  try {
    if (input.dedupeKey && (await recentlySent(input.dedupeKey, input.dedupeWindowMinutes ?? 60))) {
      return null;
    }
    const id = newId();
    await col('notifications').insertOne({
      _id: id,
      account_id: input.accountId ?? null,
      website_id: input.websiteId ?? null,
      type: input.type,
      severity: input.severity ?? 'info',
      recipient: input.recipient,
      subject: redact(input.subject).slice(0, 250),
      body: (input.allowSecretsInBody ? input.body : redact(input.body)).slice(0, 8000),
      dedupe_key: input.dedupeKey ?? '',
      delivered: 0,
      delivery_error: '',
      created_at: nowIso(),
    });

    await deliver(id, input);
    return id;
  } catch {
    log.error('Failed to record a notification.', { type: input.type });
    return null;
  }
}

/**
 * Delivery transport. `log` is the default and simply records the attempt;
 * an SMTP transport is the documented production configuration point.
 */
async function deliver(id: string, input: NotificationInput): Promise<void> {
  try {
    if (env.MAIL_TRANSPORT === 'log') {
      log.info('Notification queued (transport=log).', {
        type: input.type, recipient: input.recipient, subject: input.subject,
      }, { accountId: input.accountId ?? null, websiteId: input.websiteId ?? null });
      await col('notifications').updateOne({ _id: id as never }, { $set: { delivered: 1 } });
      return;
    }
    // No SMTP transport is bundled. Mark undelivered with a clear reason so
    // the platform owner can see exactly what is missing.
    await col('notifications').updateOne(
      { _id: id as never },
      { $set: { delivered: 0, delivery_error: 'No mail transport configured (MAIL_TRANSPORT=' + env.MAIL_TRANSPORT + ').' } },
    );
  } catch {
    /* delivery must never break the request */
  }
}

/* ----------------------------------------------------------- triggers -- */

async function accountNotificationEmail(accountId: string): Promise<string> {
  const row = await col<{ _id: string; billing_email: string }>('accounts').findOne(
    { _id: accountId as never },
    { projection: { billing_email: 1 } },
  );
  return row?.billing_email ?? '';
}

export async function notifyNewLead(submission: {
  account_id: string;
  website_id: string;
  id: string;
  name: string;
  email: string;
  phone: string;
  page_url: string;
}): Promise<void> {
  const recipient = await accountNotificationEmail(submission.account_id);
  if (!recipient) return;
  await enqueueNotification({
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

export async function notifyNewConversation(conversation: ConversationRow): Promise<void> {
  const recipient = await accountNotificationEmail(conversation.account_id);
  if (!recipient) return;
  await enqueueNotification({
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

export async function notifyProviderFailure(failure: {
  accountId: string;
  websiteId: string;
  provider: string;
  model: string;
  errorType: string;
  errorLabel: string;
  message: string;
  httpStatus: number;
}): Promise<void> {
  const recipient = await accountNotificationEmail(failure.accountId);
  const dedupeKey = createHash('sha256')
    .update([failure.websiteId, failure.provider, failure.errorType].join('|'))
    .digest('hex')
    .slice(0, 32);

  await enqueueNotification({
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

export async function listNotifications(accountId: string, limit = 50): Promise<Record<string, unknown>[]> {
  return col('notifications')
    .find({ account_id: accountId })
    .sort({ created_at: -1 })
    .limit(Math.min(limit, 200))
    .toArray();
}
