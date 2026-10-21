/**
 * /api/v1/public/* - Universal Public API for browser embeds (Shopify, Wix, Custom HTML, Webflow, etc.).
 *
 * Designed for cross-origin browser requests with full CORS headers.
 * Resolves configuration, conversations, and lead forms scoped by websiteId.
 */
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../core/errors.js';
import { parseOrThrow, stripControlChars } from '../core/validate.js';
import { log } from '../core/logger.js';
import { asyncRoute } from '../middleware/errors.js';
import { clientIp, rateLimit } from '../middleware/security.js';
import { getWebsite } from '../services/websites.js';
import { publicWidgetConfig } from '../services/widget.js';
import { generateChatResponse } from '../services/chatEngine.js';
import { getHistoryBySession } from '../services/conversations.js';
import { submitForm } from '../services/forms.js';
import { resolveNotificationRecipient, enqueueNotification } from '../services/notifications.js';
import { assertMessageQuota } from '../services/usage.js';
import { getInstructions } from '../services/instructions.js';
import { nowIso } from '../db/mongo.js';

export const publicApiRouter = Router();

const CHAT_WINDOW_MS = 60_000;

/**
 * Universal CORS middleware for browser embeds on any domain.
 */
publicApiRouter.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, X-Requested-With');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});

// Preflight OPTIONS handler
publicApiRouter.options('*', (_req, res) => {
  res.status(204).end();
});

/* --------------------------------------------------- GET /widget/:websiteId -- */

publicApiRouter.get(
  '/widget/:websiteId',
  rateLimit({ limit: 120, windowMs: 60_000, scope: 'public-widget-config' }),
  asyncRoute(async (req, res) => {
    const websiteId = String(req.params.websiteId || '').trim();
    if (!websiteId) {
      throw new AppError('website_not_found', 'A valid website ID is required.');
    }

    const website = await getWebsite(websiteId);
    if (!website || website.status !== 'active') {
      res.status(200).json({
        ok: true,
        data: {
          website: { id: websiteId, status: website ? website.status : 'not_found' },
          widget: { enabled: false },
        },
      });
      return;
    }

    const [widget, instructions] = await Promise.all([
      publicWidgetConfig(website.account_id, website.id),
      getInstructions(website.account_id, website.id),
    ]);

    res.json({
      ok: true,
      data: {
        website: {
          id: website.id,
          name: website.name,
          domain: website.primary_domain,
          status: website.status,
        },
        widget,
        messages: {
          fallback: instructions.fallback_response,
          generation_error: instructions.generation_error_response,
          greeting: instructions.greeting_response,
        },
        api_version: 'v1',
        server_time: nowIso(),
      },
    });
  }),
);

/* ------------------------------------------------------------- POST /chat -- */

const publicChatSchema = z.object({
  website_id: z.string().trim().min(1).max(64),
  session_key: z.string().trim().min(8).max(120),
  message: z.string().trim().min(1).max(4000),
  page_url: z.string().trim().max(2000).optional().default(''),
  visitor_key: z.string().trim().max(120).optional().default(''),
  visitor_name: z.string().trim().max(120).optional().default(''),
  visitor_email: z.string().trim().max(200).optional().default(''),
  visitor_phone: z.string().trim().max(60).optional().default(''),
});

publicApiRouter.post(
  '/chat',
  rateLimit({
    limit: 240,
    windowMs: CHAT_WINDOW_MS,
    scope: 'public-chat-website',
    keyFn: (req) => String(req.body?.website_id || clientIp(req)),
  }),
  rateLimit({
    limit: env.RATE_LIMIT_CHAT_PER_MINUTE,
    windowMs: CHAT_WINDOW_MS,
    scope: 'public-chat-session',
    keyFn: (req) => {
      const body = req.body;
      return String(body?.website_id || '') + ':' + String(body?.session_key || clientIp(req));
    },
  }),
  asyncRoute(async (req, res) => {
    const body = parseOrThrow(publicChatSchema, req.body ?? {});

    const website = await getWebsite(body.website_id);
    if (!website || website.status !== 'active') {
      throw new AppError('website_disabled', 'This chatbot is currently unavailable.');
    }

    const widget = await publicWidgetConfig(website.account_id, website.id);
    if (!widget.enabled) {
      throw new AppError('website_disabled', 'The chat widget is currently turned off for this website.');
    }

    const instructions = await getInstructions(website.account_id, website.id);

    try {
      await assertMessageQuota(website.account_id);
    } catch {
      log.warn('Message quota reached for public widget.', { websiteId: website.id });
      res.status(200).json({
        ok: true,
        data: {
          text: instructions.generation_error_response,
          status: 'provider_error',
          conversation_id: '',
        },
      });
      return;
    }

    const history = await getHistoryBySession(website.account_id, website.id, body.session_key, 20);

    const response = await generateChatResponse(website, {
      accountId: website.account_id,
      websiteId: website.id,
      sessionKey: body.session_key,
      message: stripControlChars(body.message),
      history,
      source: 'widget',
      pageUrl: body.page_url,
      visitor: {
        key: body.visitor_key || body.session_key,
        name: body.visitor_name,
        email: body.visitor_email,
        phone: body.visitor_phone,
      },
      ip: clientIp(req),
      userAgent: req.get('user-agent') ?? '',
      includeDiagnostics: false,
    });

    res.json({
      ok: true,
      data: {
        text: response.text,
        status: response.status,
        conversation_id: response.conversationId,
      },
    });
  }),
);

/* ----------------------------------------------------- POST /forms/submit -- */

const publicSubmitSchema = z.object({
  website_id: z.string().trim().min(1).max(64),
  form_id: z.string().trim().min(1).max(64),
  session_key: z.string().trim().min(8).max(120),
  page_url: z.string().trim().max(2000).optional().default(''),
  visitor_key: z.string().trim().max(120).optional().default(''),
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
});

publicApiRouter.post(
  '/forms/submit',
  rateLimit({
    limit: 10,
    windowMs: 60_000,
    scope: 'public-form-submit',
    keyFn: (req) => {
      const body = req.body;
      return String(body?.website_id || '') + ':' + String(body?.session_key || clientIp(req));
    },
  }),
  asyncRoute(async (req, res) => {
    const body = parseOrThrow(publicSubmitSchema, req.body ?? {});

    const website = await getWebsite(body.website_id);
    if (!website || website.status !== 'active') {
      throw new AppError('website_disabled', 'This website is currently inactive.');
    }

    const result = await submitForm(website.account_id, website.id, {
      formId: body.form_id,
      values: body.fields,
      sessionKey: body.session_key,
      pageUrl: body.page_url,
      visitorKey: body.visitor_key || body.session_key,
    });

    // Directly dispatch outbound lead notification via Nodemailer / SMTP
    try {
      const pref = await resolveNotificationRecipient(website.account_id, website.id);
      if (pref.enabled && pref.notifyLead && pref.email) {
        const leadName = result.name || 'Website Visitor';
        const leadEmail = result.email || '(not provided)';
        const leadPhone = result.phone || '(not provided)';
        const pageUrl = body.page_url || '(unknown)';
        const websiteName = pref.websiteName || website.name || 'Chat Pilot Website';

        const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #ffffff; color: #1e293b;">
  <div style="margin-bottom: 20px; border-bottom: 2px solid #0678f9; padding-bottom: 12px;">
    <h2 style="margin: 0; color: #0f172a; font-size: 20px;">New Lead Captured! 🎯</h2>
    <p style="margin: 4px 0 0 0; color: #64748b; font-size: 14px;">A visitor submitted the pre-chat form on <strong>${websiteName}</strong>.</p>
  </div>
  <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 14px;">
    <tr><td style="padding: 10px 12px; background-color: #f8fafc; font-weight: 600; width: 120px; border-bottom: 1px solid #e2e8f0;">Name:</td><td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 15px; font-weight: 700;">${leadName}</td></tr>
    <tr><td style="padding: 10px 12px; background-color: #f8fafc; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Email:</td><td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 15px;"><a href="mailto:${leadEmail}" style="color: #0678f9; text-decoration: none;">${leadEmail}</a></td></tr>
    <tr><td style="padding: 10px 12px; background-color: #f8fafc; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Phone:</td><td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 15px;">${leadPhone}</td></tr>
    <tr><td style="padding: 10px 12px; background-color: #f8fafc; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Page URL:</td><td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #64748b;">${pageUrl}</td></tr>
  </table>
  <div style="text-align: center; margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0;">
    <a href="${env.APP_URL}/app/websites/${website.id}/leads" style="display: inline-block; background-color: #0678f9; color: #ffffff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px;">View in Chat Pilot Dashboard &rarr;</a>
  </div>
</div>`.trim();

        const text = [
          `A new lead was submitted via Chat Pilot on ${websiteName}.`,
          '',
          'Lead Details:',
          '----------------------------------------',
          'Name:    ' + leadName,
          'Email:   ' + leadEmail,
          'Phone:   ' + leadPhone,
          'Page:    ' + pageUrl,
          'Time:    ' + nowIso(),
          '',
          `View lead in dashboard: ${env.APP_URL}/app/websites/${website.id}/leads`,
        ].join('\n');

        await enqueueNotification({
          accountId: website.account_id,
          websiteId: website.id,
          type: 'lead_captured',
          severity: 'info',
          recipient: pref.email,
          subject: `[Chat Pilot] New Lead Captured: ${leadName} (${websiteName})`,
          body: text,
          html,
          dedupeKey: `public_lead_${result.id}`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('Failed to dispatch public lead notification email.', { err: msg });
    }

    res.json({
      ok: true,
      data: {
        submission_id: result.id,
        name: result.name,
        email: result.email,
      },
    });
  }),
);
