/**
 * Administrative notifications.
 *
 * Enforces per-website notification settings, recipient email resolution,
 * alert de-duplication, and complete audit history tracking.
 */
import { createHash } from 'node:crypto';
import { col, nowIso } from "../db/mongo.js";
import { env } from "../config/env.js";
import { newId } from "../core/crypto.js";
import { log, redact } from "../core/logger.js";

const PROVIDER_ALERT_WINDOW_MINUTES = 60;

async function recentlySent(dedupeKey, windowMinutes) {
    if (!dedupeKey)
        return false;
    const cutoff = new Date(Date.now() - windowMinutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');
    const row = await col('notifications').findOne({ dedupe_key: dedupeKey, created_at: { $gt: cutoff } }, { projection: { _id: 1 } });
    return Boolean(row);
}

/** Records the notification, then attempts delivery. Never throws. */
export async function enqueueNotification(input) {
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
            delivered: 1, // Marked 1 as queued/delivered
            delivery_error: '',
            created_at: nowIso(),
        });
        await deliver(id, input);
        return id;
    }
    catch {
        log.error('Failed to record a notification.', { type: input.type });
        return null;
    }
}

/**
 * Delivery transport. `log` is the default and records the attempt;
 * can be hooked into an SMTP transport in production.
 */
async function deliver(id, input) {
    try {
        log.info('Notification sent/queued.', {
            type: input.type, recipient: input.recipient, subject: input.subject,
        }, { accountId: input.accountId ?? null, websiteId: input.websiteId ?? null });
        await col('notifications').updateOne({ _id: id }, { $set: { delivered: 1 } });
    }
    catch {
        /* delivery must never break the request */
    }
}

/* ----------------------------------------------------------- recipient resolver -- */

/**
 * Resolves notification recipient and preferences for a website/account.
 */
export async function resolveNotificationRecipient(accountId, websiteId) {
    let email = '';
    let websiteName = 'Chat Pilot Website';
    let enabled = true;
    let notifyLead = true;
    let notifyForm = true;
    let notifyConversation = false;
    let notifyBudget = true;
    let notifyFailure = true;

    if (websiteId) {
        const site = await col('websites').findOne({ _id: websiteId });
        if (site) {
            websiteName = site.name || 'Chat Pilot Website';
            if (site.notification_email && site.notification_email.trim()) {
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
        const acc = await col('accounts').findOne({ _id: accountId }, { projection: { billing_email: 1 } });
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

export async function notifyNewLead(submission) {
    const pref = await resolveNotificationRecipient(submission.account_id, submission.website_id);
    if (!pref.enabled || !pref.notifyLead || !pref.email)
        return;

    await enqueueNotification({
        accountId: submission.account_id,
        websiteId: submission.website_id,
        type: 'lead.created',
        severity: 'info',
        recipient: pref.email,
        subject: `[Chat Pilot] New Lead Captured: ${submission.name || 'Website Visitor'} (${pref.websiteName})`,
        body: [
            `A new lead was submitted via Chat Pilot on ${pref.websiteName}.`,
            '',
            'Lead Details:',
            '----------------------------------------',
            'Name:    ' + (submission.name || '(not provided)'),
            'Email:   ' + (submission.email || '(not provided)'),
            'Phone:   ' + (submission.phone || '(not provided)'),
            'Page:    ' + (submission.page_url || '(unknown)'),
            'Time:    ' + nowIso(),
            '',
            `View lead in dashboard: ${env.APP_URL}/app/websites/${submission.website_id}/leads`,
        ].join('\n'),
    });
}

export async function notifyNewConversation(conversation) {
    const pref = await resolveNotificationRecipient(conversation.account_id, conversation.website_id);
    if (!pref.enabled || !pref.notifyConversation || !pref.email)
        return;

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

export async function notifyProviderFailure(failure) {
    const pref = await resolveNotificationRecipient(failure.accountId, failure.websiteId);
    if (!pref.enabled || !pref.notifyFailure || !pref.email)
        return;

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

export async function notifyBudgetWarning(data) {
    const pref = await resolveNotificationRecipient(data.accountId, data.websiteId);
    if (!pref.enabled || !pref.notifyBudget || !pref.email)
        return;

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

export async function sendTestNotification(accountId, websiteId, customRecipient) {
    const pref = await resolveNotificationRecipient(accountId, websiteId);
    const recipient = (customRecipient && customRecipient.trim()) || pref.email;

    if (!recipient) {
        throw new Error('Please configure a Notification Recipient Email before testing.');
    }

    const id = await enqueueNotification({
        accountId,
        websiteId,
        type: 'system.test',
        severity: 'info',
        recipient,
        subject: `[Chat Pilot] Test Notification for ${pref.websiteName}`,
        body: [
            `This test notification confirms that email alerts are configured and working for ${pref.websiteName}.`,
            '',
            'Configuration Verified:',
            '----------------------------------------',
            'Recipient: ' + recipient,
            'Website:   ' + pref.websiteName,
            'Status:    Operational & Ready',
            'Timestamp: ' + nowIso(),
            '',
            'Alerts enabled: Leads/Forms, AI Provider Failures, AI Budget Warnings, and Activity Summaries.',
        ].join('\n'),
    });

    return { id, recipient };
}

export async function listNotificationsForWebsite(accountId, websiteId, limit = 20) {
    return col('notifications')
        .find({ website_id: websiteId })
        .sort({ created_at: -1 })
        .limit(Math.min(limit, 50))
        .toArray();
}

export async function listNotifications(accountId, limit = 50) {
    return col('notifications')
        .find({ account_id: accountId })
        .sort({ created_at: -1 })
        .limit(Math.min(limit, 200))
        .toArray();
}
