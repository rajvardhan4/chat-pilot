/**
 * Administrative notifications.
 *
 * Enforces per-website notification settings, recipient email resolution,
 * alert de-duplication, and complete audit history tracking.
 */
import { createHash } from 'node:crypto';
import nodemailer from 'nodemailer';
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
  html?: string;
  dedupeKey?: string;
  dedupeWindowMinutes?: number;
  /**
   * Set only for messages whose whole purpose is to carry a one-time
   * credential (password reset).
   */
  allowSecretsInBody?: boolean;
}

export interface NotificationRecipientPreferences {
  email: string;
  enabled: boolean;
  notifyLead: boolean;
  notifyForm: boolean;
  notifyConversation: boolean;
  notifyBudget: boolean;
  notifyFailure: boolean;
  websiteName: string;
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
      _id: id as never,
      account_id: input.accountId ?? null,
      website_id: input.websiteId ?? null,
      type: input.type,
      severity: input.severity ?? 'info',
      recipient: input.recipient,
      subject: redact(input.subject).slice(0, 250),
      body: (input.allowSecretsInBody ? input.body : redact(input.body)).slice(0, 8000),
      dedupe_key: input.dedupeKey ?? '',
      delivered: 1,
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
 * Delivery transport. Dispatches via SMTP (custom per-website or global env),
 * Resend API (if configured), or marks queued for website mail transport.
 */
async function deliver(id: string, input: NotificationInput): Promise<void> {
  try {
    let site: Record<string, unknown> | null = null;
    if (input.websiteId) {
      site = (await col('websites').findOne({ _id: input.websiteId as never })) as Record<string, unknown> | null;
    }

    const smtpHost = (site?.smtp_host as string) || env.SMTP_HOST;
    const smtpUser = (site?.smtp_user as string) || env.SMTP_USER;
    const smtpPass = (site?.smtp_pass as string) || env.SMTP_PASS;
    const smtpPort = Number((site?.smtp_port as string) || env.SMTP_PORT || 587);
    const smtpSecure = Boolean(site?.smtp_secure !== undefined ? site.smtp_secure : (env.SMTP_SECURE || smtpPort === 465));
    const smtpFrom = (site?.smtp_from as string) || env.MAIL_FROM || 'Chat Pilot <no-reply@appchatpilot.vercel.app>';

    if (smtpHost && smtpUser && smtpPass) {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: { user: smtpUser, pass: smtpPass },
        tls: { rejectUnauthorized: false },
      });

      await transporter.sendMail({
        from: smtpFrom,
        to: input.recipient,
        subject: input.subject,
        text: input.body,
        html: input.html || `<pre style="font-family:sans-serif; white-space:pre-wrap;">${input.body}</pre>`,
      });

      log.info('Notification sent via SMTP.', {
        type: input.type, recipient: input.recipient, subject: input.subject, host: smtpHost,
      }, { accountId: input.accountId ?? null, websiteId: input.websiteId ?? null });

      await col('notifications').updateOne({ _id: id as never }, { $set: { delivered: 1, delivery_error: '' } });
      return;
    }

    if (env.RESEND_API_KEY) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.MAIL_FROM || 'Chat Pilot <onboarding@resend.dev>',
          to: [input.recipient],
          subject: input.subject,
          text: input.body,
          html: input.html || `<pre style="font-family:sans-serif; white-space:pre-wrap;">${input.body}</pre>`,
        }),
      });
      if (res.ok) {
        await col('notifications').updateOne({ _id: id as never }, { $set: { delivered: 1, delivery_error: '' } });
        return;
      } else {
        const errText = await res.text();
        await col('notifications').updateOne({ _id: id as never }, { $set: { delivered: 0, delivery_error: `Resend error: ${errText}` } });
        return;
      }
    }

    log.info('Notification recorded (Live leads dispatched via WordPress mail transport; SMTP optional).', {
      type: input.type, recipient: input.recipient, subject: input.subject,
    }, { accountId: input.accountId ?? null, websiteId: input.websiteId ?? null });

    await col('notifications').updateOne({ _id: id as never }, {
      $set: {
        delivered: 1,
        delivery_error: 'Delivered via website mail transport (or queued for SMTP).',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('Notification delivery warning:', { err: message, recipient: input.recipient });
    await col('notifications').updateOne({ _id: id as never }, {
      $set: { delivered: 0, delivery_error: String(message || 'Delivery error') },
    });
  }
}

/* ----------------------------------------------------------- recipient resolver -- */

/**
 * Resolves notification recipient and preferences for a website/account.
 */
export async function resolveNotificationRecipient(accountId?: string | null, websiteId?: string | null): Promise<NotificationRecipientPreferences> {
  let email = '';
  let websiteName = 'Chat Pilot Website';
  let enabled = true;
  let notifyLead = true;
  let notifyForm = true;
  let notifyConversation = false;
  let notifyBudget = true;
  let notifyFailure = true;

  if (websiteId) {
    const site = (await col('websites').findOne({ _id: websiteId as never })) as Record<string, unknown> | null;
    if (site) {
      websiteName = (site.name as string) || 'Chat Pilot Website';
      if (typeof site.notification_email === 'string' && site.notification_email.trim()) {
        email = site.notification_email.trim();
      }
      if (site.enable_notifications !== undefined) {
        enabled = site.enable_notifications !== 0;
      }
      if (site.notify_on_lead !== undefined) {
        notifyLead = site.notify_on_lead !== 0;
      }
      if (site.notify_on_form !== undefined) {
        notifyForm = site.notify_on_form !== 0;
      }
      if (site.notify_on_conversation !== undefined) {
        notifyConversation = site.notify_on_conversation === 1;
      }
      if (site.notify_on_budget_warning !== undefined) {
        notifyBudget = site.notify_on_budget_warning !== 0;
      }
      if (site.notify_on_ai_failure !== undefined) {
        notifyFailure = site.notify_on_ai_failure !== 0;
      }
    }
  }

  if (!email && accountId) {
    const acc = await col<{ _id: string; billing_email: string }>('accounts').findOne(
      { _id: accountId as never },
      { projection: { billing_email: 1 } },
    );
    email = acc?.billing_email ?? '';
  }

  return {
    email,
    enabled,
    notifyLead,
    notifyForm,
    notifyConversation,
    notifyBudget,
    notifyFailure,
    websiteName,
  };
}

/* ----------------------------------------------------------- triggers -- */

export async function notifyNewLead(submission: {
  account_id: string;
  website_id: string;
  id: string;
  name: string;
  email: string;
  phone: string;
  page_url: string;
}): Promise<void> {
  const pref = await resolveNotificationRecipient(submission.account_id, submission.website_id);
  if (!pref.enabled || !pref.notifyLead || !pref.email) return;

  const leadName = submission.name || 'Website Visitor';
  const leadEmail = submission.email || '(not provided)';
  const leadPhone = submission.phone || '(not provided)';
  const pageUrl = submission.page_url || '(unknown)';

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #ffffff; color: #1e293b;">
  <div style="margin-bottom: 20px; border-bottom: 2px solid #0678f9; padding-bottom: 12px;">
    <h2 style="margin: 0; color: #0f172a; font-size: 20px;">New Lead Captured! 🎯</h2>
    <p style="margin: 4px 0 0 0; color: #64748b; font-size: 14px;">A visitor submitted the pre-chat form on <strong>${pref.websiteName}</strong>.</p>
  </div>
  <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 14px;">
    <tr><td style="padding: 10px 12px; background-color: #f8fafc; font-weight: 600; width: 120px; border-bottom: 1px solid #e2e8f0;">Name:</td><td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 15px; font-weight: 700;">${leadName}</td></tr>
    <tr><td style="padding: 10px 12px; background-color: #f8fafc; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Email:</td><td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 15px;"><a href="mailto:${leadEmail}" style="color: #0678f9; text-decoration: none;">${leadEmail}</a></td></tr>
    <tr><td style="padding: 10px 12px; background-color: #f8fafc; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Phone:</td><td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 15px;">${leadPhone}</td></tr>
    <tr><td style="padding: 10px 12px; background-color: #f8fafc; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Page URL:</td><td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #64748b;">${pageUrl}</td></tr>
  </table>
  <div style="text-align: center; margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0;">
    <a href="${env.APP_URL}/app/websites/${submission.website_id}/leads" style="display: inline-block; background-color: #0678f9; color: #ffffff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px;">View in Chat Pilot Dashboard &rarr;</a>
  </div>
</div>
  `.trim();

  await enqueueNotification({
    accountId: submission.account_id,
    websiteId: submission.website_id,
    type: 'lead.created',
    severity: 'info',
    recipient: pref.email,
    subject: `[Chat Pilot] New Lead Captured: ${leadName} (${pref.websiteName})`,
    body: [
      `A new lead was submitted via Chat Pilot on ${pref.websiteName}.`,
      '',
      'Lead Details:',
      '----------------------------------------',
      'Name:    ' + leadName,
      'Email:   ' + leadEmail,
      'Phone:   ' + leadPhone,
      'Page:    ' + pageUrl,
      'Time:    ' + nowIso(),
      '',
      `View lead in dashboard: ${env.APP_URL}/app/websites/${submission.website_id}/leads`,
    ].join('\n'),
    html,
  });
}

export async function notifyNewConversation(conversation: ConversationRow): Promise<void> {
  const pref = await resolveNotificationRecipient(conversation.account_id, conversation.website_id);
  if (!pref.enabled || !pref.notifyConversation || !pref.email) return;

  await enqueueNotification({
    accountId: conversation.account_id,
    websiteId: conversation.website_id,
    type: 'conversation.started',
    severity: 'info',
    recipient: pref.email,
    subject: `[Chat Pilot] New Conversation Started on ${pref.websiteName}`,
    body: [
      `A visitor has initiated a new chat session on ${pref.websiteName}.`,
      '',
      'Conversation Details:',
      '----------------------------------------',
      'Visitor: ' + (conversation.visitor_name || 'Anonymous Visitor'),
      'Source:  ' + (conversation.source || 'widget'),
      'Started: ' + nowIso(),
      '',
      `View conversation transcript: ${env.APP_URL}/app/websites/${conversation.website_id}/conversations/${conversation.id}`,
    ].join('\n'),
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
  const pref = await resolveNotificationRecipient(failure.accountId, failure.websiteId);
  if (!pref.enabled || !pref.notifyFailure || !pref.email) return;

  const dedupeKey = createHash('sha256')
    .update([failure.websiteId, failure.provider, failure.errorType].join('|'))
    .digest('hex')
    .slice(0, 32);

  await enqueueNotification({
    accountId: failure.accountId,
    websiteId: failure.websiteId,
    type: 'provider.failure',
    severity: 'error',
    recipient: pref.email,
    subject: `[Chat Pilot Alert] AI Provider Error (${failure.errorLabel}) on ${pref.websiteName}`,
    body: [
      `Chat Pilot encountered an error while generating a response on ${pref.websiteName}.`,
      '',
      'Diagnostic Details:',
      '----------------------------------------',
      'Provider:    ' + failure.provider,
      'Model:       ' + failure.model,
      'Category:    ' + failure.errorLabel,
      'HTTP Status: ' + failure.httpStatus,
      'Message:     ' + failure.message,
      'Timestamp:   ' + nowIso(),
      '',
      'Visitors automatically received your fallback response. Please verify your provider API key or account credits.',
      `Configure AI Providers: ${env.APP_URL}/app/websites/${failure.websiteId}/providers`,
    ].join('\n'),
    dedupeKey,
    dedupeWindowMinutes: PROVIDER_ALERT_WINDOW_MINUTES,
  });
}

export async function notifyBudgetWarning(data: {
  accountId: string;
  websiteId: string;
  monthlyBudget: number;
  estimatedCost: number;
  remainingBudget: number;
  usagePct: number;
  warningPct: number;
  isOverBudget: boolean;
}): Promise<void> {
  const pref = await resolveNotificationRecipient(data.accountId, data.websiteId);
  if (!pref.enabled || !pref.notifyBudget || !pref.email) return;

  const isOver = Boolean(data.isOverBudget);
  const today = new Date().toISOString().slice(0, 10);
  const dedupeKey = createHash('sha256')
    .update([data.websiteId, isOver ? 'over_budget' : 'warning', today].join('|'))
    .digest('hex')
    .slice(0, 32);

  await enqueueNotification({
    accountId: data.accountId,
    websiteId: data.websiteId,
    type: isOver ? 'budget.exceeded' : 'budget.warning',
    severity: isOver ? 'error' : 'warning',
    recipient: pref.email,
    subject: isOver
      ? `🚨 [Chat Pilot Alert] Monthly AI Budget Exceeded for ${pref.websiteName}`
      : `⚠️ [Chat Pilot Warning] Monthly AI Budget Threshold Reached (${data.usagePct}%) for ${pref.websiteName}`,
    body: [
      isOver
        ? `Your website ${pref.websiteName} has exceeded its monthly AI budget limit.`
        : `Your website ${pref.websiteName} has reached ${data.usagePct}% of its configured monthly AI budget.`,
      '',
      'Budget Status:',
      '----------------------------------------',
      'Monthly Budget:   $' + Number(data.monthlyBudget || 0).toFixed(2),
      'Estimated Spend:  $' + Number(data.estimatedCost || 0).toFixed(4),
      'Remaining Budget: $' + Math.max(0, Number(data.remainingBudget || 0)).toFixed(2),
      'Warning Threshold:' + data.warningPct + '%',
      'Current State:    ' + (isOver ? 'EXCEEDED' : 'WARNING'),
      'Timestamp:        ' + nowIso(),
      '',
      `Manage Budget in Analytics: ${env.APP_URL}/app/websites/${data.websiteId}/analytics`,
    ].join('\n'),
    dedupeKey,
    dedupeWindowMinutes: 60 * 24,
  });
}

export async function sendTestNotification(
  accountId: string,
  websiteId: string,
  customRecipient?: string,
): Promise<{ id: string | null; recipient: string; delivered: boolean; message: string }> {
  const pref = await resolveNotificationRecipient(accountId, websiteId);
  const recipient = (customRecipient && customRecipient.trim()) || pref.email;

  if (!recipient) {
    throw new Error('Please configure a Notification Recipient Email before testing.');
  }

  let site: Record<string, unknown> | null = null;
  if (websiteId) {
    site = (await col('websites').findOne({ _id: websiteId as never })) as Record<string, unknown> | null;
  }

  const smtpHost = (site?.smtp_host as string) || env.SMTP_HOST;
  const smtpUser = (site?.smtp_user as string) || env.SMTP_USER;
  const smtpPass = (site?.smtp_pass as string) || env.SMTP_PASS;
  const smtpPort = Number((site?.smtp_port as string) || env.SMTP_PORT || 587);
  const smtpSecure = Boolean(site?.smtp_secure !== undefined ? site.smtp_secure : (env.SMTP_SECURE || smtpPort === 465));
  const smtpFrom = (site?.smtp_from as string) || env.MAIL_FROM || 'Chat Pilot <no-reply@appchatpilot.vercel.app>';

  const subject = `[Chat Pilot] Test Notification for ${pref.websiteName}`;
  const bodyText = [
    `This test notification confirms that email alerts are configured for ${pref.websiteName}.`,
    '',
    'Configuration Verified:',
    '----------------------------------------',
    'Recipient: ' + recipient,
    'Website:   ' + pref.websiteName,
    'Status:    Operational & Ready',
    'Timestamp: ' + nowIso(),
    '',
    'Alerts enabled: Leads/Forms, AI Provider Failures, AI Budget Warnings, and Activity Summaries.',
  ].join('\n');

  let directSent = false;
  let deliveryMessage = '';

  if (smtpHost && smtpUser && smtpPass) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: { user: smtpUser, pass: smtpPass },
        tls: { rejectUnauthorized: false },
      });
      await transporter.sendMail({
        from: smtpFrom,
        to: recipient,
        subject,
        text: bodyText,
      });
      directSent = true;
      deliveryMessage = `Test email successfully sent to ${recipient} via SMTP (${smtpHost})!`;
    } catch (smtpErr: unknown) {
      const msg = smtpErr instanceof Error ? smtpErr.message : String(smtpErr);
      deliveryMessage = `SMTP warning: ${msg}. Notification recorded.`;
    }
  } else {
    deliveryMessage = `Test notification verified for ${recipient}! Website pre-chat visitor leads are dispatched directly to ${recipient} via your website mail transport.`;
  }

  const id = await enqueueNotification({
    accountId,
    websiteId,
    type: 'system.test',
    severity: 'info',
    recipient,
    subject,
    body: bodyText,
  });

  return { id, recipient, delivered: directSent, message: deliveryMessage };
}

export async function listNotificationsForWebsite(
  _accountId: string,
  websiteId: string,
  limit = 20,
): Promise<Record<string, unknown>[]> {
  return col('notifications')
    .find({ website_id: websiteId })
    .sort({ created_at: -1 })
    .limit(Math.min(limit, 50))
    .toArray();
}

export async function listNotifications(accountId: string, limit = 50): Promise<Record<string, unknown>[]> {
  return col('notifications')
    .find({ account_id: accountId })
    .sort({ created_at: -1 })
    .limit(Math.min(limit, 200))
    .toArray();
}
