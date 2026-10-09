/**
 * /api/v1/site/* - the contract between the WordPress plugin and Chat Pilot.
 *
 * Versioned so a newer SaaS can keep serving older plugin builds. Every route
 * here is authenticated by Site API Key + HMAC signature (see siteAuth.ts) and
 * is scoped to exactly one website.
 *
 * Nothing in a response may contain a provider key, an internal error, a stack
 * trace or another tenant's data.
 */
import { Router } from 'express';
import { z } from 'zod';
import { env } from "../config/env.js";
import { AppError } from "../core/errors.js";
import { parseOrThrow, stripControlChars } from "../core/validate.js";
import { log } from "../core/logger.js";
import { asyncRoute } from "../middleware/errors.js";
import { siteAuth } from "../middleware/siteAuth.js";
import { clientIp, rateLimit } from "../middleware/security.js";
import { recordConnection } from "../services/siteKeys.js";
import { audit } from "../services/audit.js";
import { publicWidgetConfig } from "../services/widget.js";
import { generateChatResponse } from "../services/chatEngine.js";
import { getHistoryBySession } from "../services/conversations.js";
import { submitForm } from "../services/forms.js";
import { assertMessageQuota } from "../services/usage.js";
import { getInstructions } from "../services/instructions.js";
import { normaliseHost, originOf } from "../core/domain.js";
import { col, nowIso } from "../db/mongo.js";
export const siteApiRouter = Router();
const CHAT_WINDOW_MS = 60_000;
/* ------------------------------------------------------------ /connect -- */
const connectSchema = z.object({
    site_url: z.string().trim().min(3).max(500),
    plugin_version: z.string().trim().max(30).default(''),
    wp_version: z.string().trim().max(30).default(''),
});
/**
 * Plugin handshake.
 *
 * The domain IS enforced here (enforceDomain defaults to true) so a key
 * registered for example.com cannot be activated on attacker-site.com. On
 * success we additionally attempt an ownership callback: we ask the site to
 * echo the website's verification token from its own REST endpoint. That turns
 * "the caller claims to be example.com" into "example.com served our token".
 * A callback failure does not block the connection; it is recorded so the
 * customer and the platform owner can see the difference.
 */
siteApiRouter.post('/connect', rateLimit({ limit: 20, windowMs: 60_000, scope: 'site-connect' }), siteAuth(), asyncRoute(async (req, res) => {
    const body = parseOrThrow(connectSchema, req.body ?? {});
    const site = req.site;
    await recordConnection(site.website.id, body.plugin_version);
    const verification = await attemptOwnershipVerification(site.website.id, body.site_url, site.website.verification_token);
    await audit({
        accountId: site.account.id,
        websiteId: site.website.id,
        actorType: 'site_key',
        actorId: site.key.id,
        action: 'site.connected',
        targetType: 'website',
        targetId: site.website.id,
        metadata: { pluginVersion: body.plugin_version, wpVersion: body.wp_version, verification },
        ip: clientIp(req),
    });
    res.json({
        ok: true,
        data: {
            status: 'connected',
            website: {
                id: site.website.id,
                name: site.website.name,
                domain: site.website.primary_domain,
                status: site.website.status,
                verified: Boolean(site.website.verified_at) || verification === 'verified',
                ownership_check: verification,
            },
            account: { id: site.account.id, name: site.account.name },
            widget: await publicWidgetConfig(site.account.id, site.website.id),
            dashboard_url: env.APP_URL + '/app/websites/' + site.website.id,
            api_version: 'v1',
            server_time: nowIso(),
        },
    });
}));
/** Confirms the site serves our token from its own origin. */
async function attemptOwnershipVerification(websiteId, siteUrl, expectedToken) {
    const host = normaliseHost(siteUrl);
    if (!host)
        return 'unreachable';
    const origin = originOf(siteUrl.includes('://') ? siteUrl : 'https://' + host) || 'https://' + host;
    const url = origin.replace(/\/$/, '') + '/wp-json/chat-pilot/v1/site-token';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { Accept: 'application/json', 'User-Agent': 'ChatPilotVerifier/1.0' },
        });
        if (!response.ok)
            return 'unreachable';
        const payload = (await response.json());
        if (typeof payload?.token === 'string' && payload.token === expectedToken) {
            await col('websites').updateOne({ _id: websiteId }, { $set: { verified_at: nowIso(), updated_at: nowIso() } });
            return 'verified';
        }
        return 'mismatch';
    }
    catch {
        return 'unreachable';
    }
    finally {
        clearTimeout(timer);
    }
}
/* ------------------------------------------------------------- /config -- */
siteApiRouter.get('/config', rateLimit({ limit: 120, windowMs: 60_000, scope: 'site-config' }), siteAuth(), asyncRoute(async (req, res) => {
    const site = req.site;
    const instructions = await getInstructions(site.account.id, site.website.id);
    res.json({
        ok: true,
        data: {
            website: {
                id: site.website.id,
                name: site.website.name,
                domain: site.website.primary_domain,
                status: site.website.status,
            },
            widget: await publicWidgetConfig(site.account.id, site.website.id),
            // Visitor-facing copy only. The system prompt never leaves the server.
            messages: {
                fallback: instructions.fallback_response,
                generation_error: instructions.generation_error_response,
                greeting: instructions.greeting_response,
            },
            api_version: 'v1',
            server_time: nowIso(),
        },
    });
}));
/* --------------------------------------------------------------- /chat -- */
const chatSchema = z.object({
    session_key: z.string().trim().min(8).max(120),
    message: z.string().trim().min(1).max(4000),
    page_url: z.string().trim().max(2000).optional().default(''),
    visitor_key: z.string().trim().max(120).optional().default(''),
    visitor_name: z.string().trim().max(120).optional().default(''),
    visitor_email: z.string().trim().max(200).optional().default(''),
    visitor_phone: z.string().trim().max(60).optional().default(''),
});
siteApiRouter.post('/chat', siteAuth(), 
// Limit per website AND per visitor session so one site cannot exhaust the
// platform and one visitor cannot exhaust a site.
rateLimit({
    limit: 240,
    windowMs: CHAT_WINDOW_MS,
    scope: 'site-chat-website',
    keyFn: (req) => req.site?.website.id ?? clientIp(req),
}), rateLimit({
    limit: env.RATE_LIMIT_CHAT_PER_MINUTE,
    windowMs: CHAT_WINDOW_MS,
    scope: 'site-chat-session',
    keyFn: (req) => {
        const body = req.body;
        return (req.site?.website.id ?? '') + ':' + (body?.session_key ?? clientIp(req));
    },
}), asyncRoute(async (req, res) => {
    const site = req.site;
    const body = parseOrThrow(chatSchema, req.body ?? {});
    const widget = await publicWidgetConfig(site.account.id, site.website.id);
    if (!widget.enabled) {
        throw new AppError('website_disabled', 'The chat widget is currently turned off for this website.');
    }
    try {
        await assertMessageQuota(site.account.id);
    }
    catch (err) {
        // Surface a friendly, visitor-safe sentence rather than a raw quota error.
        const instructions = await getInstructions(site.account.id, site.website.id);
        log.warn('Message quota reached.', { websiteId: site.website.id }, {
            accountId: site.account.id, websiteId: site.website.id,
        });
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
    const history = await getHistoryBySession(site.account.id, site.website.id, body.session_key, 20);
    const response = await generateChatResponse(site.website, {
        accountId: site.account.id,
        websiteId: site.website.id,
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
    // Deliberately minimal: text, a status the widget can style, and the id.
    res.json({
        ok: true,
        data: {
            text: response.text,
            status: response.status,
            conversation_id: response.conversationId,
        },
    });
}));
/* ------------------------------------------------------- /forms/submit -- */
const submitSchema = z.object({
    form_id: z.string().trim().min(1).max(64),
    session_key: z.string().trim().min(8).max(120),
    page_url: z.string().trim().max(2000).optional().default(''),
    visitor_key: z.string().trim().max(120).optional().default(''),
    fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
});
siteApiRouter.post('/forms/submit', siteAuth(), rateLimit({
    limit: 10,
    windowMs: 60_000,
    scope: 'site-form',
    keyFn: (req) => {
        const body = req.body;
        return (req.site?.website.id ?? '') + ':' + (body?.session_key ?? clientIp(req));
    },
}), asyncRoute(async (req, res) => {
    const site = req.site;
    const body = parseOrThrow(submitSchema, req.body ?? {});
    const result = await submitForm(site.account.id, site.website.id, {
        formId: body.form_id,
        values: body.fields,
        sessionKey: body.session_key,
        pageUrl: body.page_url,
        visitorKey: body.visitor_key || body.session_key,
    });
    res.json({ ok: true, data: { submission_id: result.id, name: result.name, email: result.email } });
}));
/* ------------------------------------------------------------- /health -- */
siteApiRouter.get('/health', rateLimit({ limit: 60, windowMs: 60_000, scope: 'site-health' }), siteAuth(), asyncRoute(async (req, res) => {
    const site = req.site;
    const config = await col('ai_provider_configs').findOne({ website_id: site.website.id }, { projection: { active_provider: 1, active_model: 1 } });
    const documents = await col('knowledge_documents').countDocuments({
        website_id: site.website.id, status: 'enabled',
    });
    const widget = await publicWidgetConfig(site.account.id, site.website.id);
    res.json({
        ok: true,
        data: {
            status: 'connected',
            website_status: site.website.status,
            account_status: site.account.status,
            provider_configured: Boolean(config?.active_provider && config?.active_model),
            knowledge_documents: documents,
            widget_enabled: widget.enabled,
            api_version: 'v1',
            server_time: nowIso(),
        },
    });
}));
/* --------------------------------------------------------- /disconnect -- */
siteApiRouter.post('/disconnect', siteAuth(), asyncRoute(async (req, res) => {
    const site = req.site;
    await audit({
        accountId: site.account.id,
        websiteId: site.website.id,
        actorType: 'site_key',
        actorId: site.key.id,
        action: 'site.disconnected',
        targetType: 'website',
        targetId: site.website.id,
        ip: clientIp(req),
    });
    res.json({ ok: true, data: { status: 'disconnected' } });
}));
