/**
 * /api/v1/portal/* - JSON endpoints used by the portal UI.
 *
 * Session-cookie authenticated, CSRF-protected, and tenant-scoped exactly like
 * the server-rendered pages. Mirrors the AJAX surface of the original plugin
 * so the screens behave the same way.
 */
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { env } from "../config/env.js";
import { AppError, badRequest, validationFailed } from "../core/errors.js";
import { hexColorSchema, parseOrThrow, stripControlChars, text } from "../core/validate.js";
import { asyncRoute } from "../middleware/errors.js";
import { requireAuth, requireCsrf, resolveAccount } from "../middleware/session.js";
import { resolveWebsite } from "../middleware/websiteScope.js";
import { rateLimit } from "../middleware/security.js";
import { updateWebsite } from "../services/websites.js";
import { getConfig, listDiscoveredModels, providerOverview, removeCredential, saveCredential, setActiveProviderAndModel, testAndDiscover, updateConfig, } from "../services/providerService.js";
import { isKnownProvider, listProviders } from "../providers/registry.js";
import { deleteDocument, deleteSource, knowledgeStats, listDocuments, listSources, getDocument, saveFaq, saveManualKnowledge, saveUploadedDocument, scanWebsite, setDocumentStatus, } from "../services/knowledge.js";
import { ALLOWED_UPLOAD_TYPES, parseUpload, sniffFileType } from "../services/parsers.js";
import { searchKnowledge } from "../services/retrieval.js";
import { getInstructions, resetInstructions, updateInstructions } from "../services/instructions.js";
import { getWidgetSettings, publicWidgetConfig, updateWidgetSettings } from "../services/widget.js";
import { deleteForm, deleteSubmission, duplicateForm, listForms, saveForm, setActiveForm, setDefaultForm, FIELD_TYPES, } from "../services/forms.js";
import { deleteConversation, getHistoryBySession, getTranscript, markRead, setConversationStatus, } from "../services/conversations.js";
import { generateChatResponse } from "../services/chatEngine.js";
import { issueSiteKey, revokeSiteKey } from "../services/siteKeys.js";
import { websiteAnalytics, resolveRange } from "../services/analytics.js";
import { sendTestNotification } from "../services/notifications.js";
export const portalApiRouter = Router();
portalApiRouter.use(requireAuth, resolveAccount, requireCsrf);
const ok = (data) => ({ ok: true, data });
/* ------------------------------------------------------------ providers -- */
portalApiRouter.get('/websites/:websiteId/providers', resolveWebsite, asyncRoute(async (req, res) => {
    const [providers, config] = await Promise.all([
        providerOverview(req.account.id, req.website.id),
        getConfig(req.account.id, req.website.id),
    ]);
    res.json(ok({
        providers,
        config,
        catalogue: listProviders().map((p) => ({
            slug: p.slug, name: p.name, description: p.description,
            consoleUrl: p.consoleUrl, requiresBaseUrl: p.requiresBaseUrl, supportsOrgId: p.supportsOrgId,
        })),
    }));
}));
const credentialSchema = z.object({
    provider: z.string().trim().min(1).max(40),
    api_key: z.string().trim().min(1, 'Enter your provider API key.').max(500),
    base_url: z.string().trim().max(300).optional().default(''),
    org_id: z.string().trim().max(120).optional().default(''),
});
portalApiRouter.post('/websites/:websiteId/providers/credentials', resolveWebsite, asyncRoute(async (req, res) => {
    const body = parseOrThrow(credentialSchema, req.body ?? {});
    if (!isKnownProvider(body.provider))
        throw badRequest('Unknown AI provider.');
    await saveCredential(req.account.id, req.website.id, body.provider, { apiKey: body.api_key, baseUrl: body.base_url, orgId: body.org_id }, req.user.id);
    // The response deliberately re-reads the safe overview: no plaintext key.
    res.json(ok({ providers: await providerOverview(req.account.id, req.website.id) }));
}));
portalApiRouter.post('/websites/:websiteId/providers/test', resolveWebsite, rateLimit({ limit: 20, windowMs: 60_000, scope: 'provider-test' }), asyncRoute(async (req, res) => {
    const provider = String(req.body?.provider ?? '');
    if (!isKnownProvider(provider))
        throw badRequest('Unknown AI provider.');
    const result = await testAndDiscover(req.account.id, req.website.id, provider, req.user.id);
    res.json(ok({
        ok: result.test.ok,
        status: result.test.status,
        message: result.test.message,
        latencyMs: result.test.latencyMs,
        models: result.models,
        suggestedModel: result.suggestedModel,
        providers: await providerOverview(req.account.id, req.website.id),
    }));
}));
portalApiRouter.post('/websites/:websiteId/providers/select', resolveWebsite, asyncRoute(async (req, res) => {
    const body = parseOrThrow(z.object({
        provider: z.string().trim().min(1).max(40),
        model: z.string().trim().max(120).optional().default(''),
    }), req.body ?? {});
    const config = await setActiveProviderAndModel(req.account.id, req.website.id, body.provider, body.model, req.user.id);
    res.json(ok({ config, providers: await providerOverview(req.account.id, req.website.id) }));
}));
portalApiRouter.post('/websites/:websiteId/providers/remove', resolveWebsite, asyncRoute(async (req, res) => {
    const provider = String(req.body?.provider ?? '');
    await removeCredential(req.account.id, req.website.id, provider, req.user.id);
    res.json(ok({ providers: await providerOverview(req.account.id, req.website.id) }));
}));
portalApiRouter.post('/websites/:websiteId/providers/tuning', resolveWebsite, asyncRoute(async (req, res) => {
    const body = parseOrThrow(z.object({
        temperature: z.coerce.number().min(0).max(2).optional(),
        max_output_tokens: z.coerce.number().int().min(64).max(8000).optional(),
        retrieval_threshold: z.coerce.number().min(0).max(50).optional(),
        max_history_messages: z.coerce.number().int().min(2).max(50).optional(),
    }), req.body ?? {});
    const config = await updateConfig(req.account.id, req.website.id, body);
    res.json(ok({ config }));
}));
portalApiRouter.get('/websites/:websiteId/providers/:provider/models', resolveWebsite, asyncRoute(async (req, res) => {
    res.json(ok({ models: await listDiscoveredModels(req.account.id, req.website.id, req.params.provider) }));
}));
/* ------------------------------------------------------------ knowledge -- */
portalApiRouter.get('/websites/:websiteId/knowledge', resolveWebsite, asyncRoute(async (req, res) => {
    const [stats, sources, documents] = await Promise.all([
        knowledgeStats(req.account.id, req.website.id),
        listSources(req.account.id, req.website.id),
        listDocuments(req.account.id, req.website.id, { limit: 100 }),
    ]);
    res.json(ok({ stats, sources, documents }));
}));
portalApiRouter.post('/websites/:websiteId/knowledge/manual', resolveWebsite, asyncRoute(async (req, res) => {
    const body = parseOrThrow(z.object({
        source_id: z.string().trim().max(64).optional(),
        title: text(200, 'Title'),
        content: z.string().min(1, 'Add some content.').max(200_000),
        category: z.string().trim().max(60).optional().default(''),
    }), req.body ?? {});
    const source = await saveManualKnowledge(req.account.id, req.website.id, { sourceId: body.source_id || undefined, title: body.title, content: body.content, category: body.category }, req.user.id);
    res.json(ok({ source, stats: await knowledgeStats(req.account.id, req.website.id) }));
}));
portalApiRouter.post('/websites/:websiteId/knowledge/faq', resolveWebsite, asyncRoute(async (req, res) => {
    const body = parseOrThrow(z.object({
        source_id: z.string().trim().max(64).optional(),
        question: text(500, 'Question'),
        answer: z.string().min(1, 'Add an answer.').max(20_000),
        category: z.string().trim().max(60).optional().default(''),
    }), req.body ?? {});
    const source = await saveFaq(req.account.id, req.website.id, { sourceId: body.source_id || undefined, question: body.question, answer: body.answer, category: body.category }, req.user.id);
    res.json(ok({ source, stats: await knowledgeStats(req.account.id, req.website.id) }));
}));
portalApiRouter.post('/websites/:websiteId/knowledge/scan', resolveWebsite, rateLimit({ limit: 5, windowMs: 60_000, scope: 'kb-scan' }), asyncRoute(async (req, res) => {
    const body = parseOrThrow(z.object({
        start_url: z.string().trim().max(500).optional().default(''),
        max_pages: z.coerce.number().int().min(1).max(100).optional().default(15),
        source_id: z.string().trim().max(64).optional(),
    }), req.body ?? {});
    const summary = await scanWebsite(req.account.id, req.website.id, { startUrl: body.start_url || undefined, maxPages: body.max_pages, sourceId: body.source_id || undefined }, req.user.id);
    res.json(ok({ summary, stats: await knowledgeStats(req.account.id, req.website.id) }));
}));
/**
 * File upload. Accepts a base64 payload so no multipart dependency is needed.
 * Validated three ways: declared extension, declared MIME, and magic bytes.
 */
const uploadSchema = z.object({
    filename: z.string().trim().min(1).max(200),
    mime_type: z.string().trim().max(120).default(''),
    content_base64: z.string().min(1),
});
portalApiRouter.post('/websites/:websiteId/knowledge/upload', resolveWebsite, rateLimit({ limit: 20, windowMs: 60_000, scope: 'kb-upload' }), asyncRoute(async (req, res) => {
    const body = parseOrThrow(uploadSchema, req.body ?? {});
    const safeName = path.basename(body.filename).replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120);
    const ext = path.extname(safeName).toLowerCase().replace(/^\./, '');
    const allowed = ALLOWED_UPLOAD_TYPES[ext];
    if (!allowed) {
        throw new AppError('unsupported_media_type', 'Upload a .txt, .md, .csv, .pdf or .docx file.', { fields: { filename: 'Unsupported file type.' } });
    }
    if (body.mime_type && !allowed.mimes.includes(body.mime_type)) {
        throw new AppError('unsupported_media_type', 'That file type does not match its extension.');
    }
    const buffer = Buffer.from(body.content_base64, 'base64');
    if (!buffer.length)
        throw badRequest('The uploaded file was empty.');
    if (buffer.length > env.UPLOAD_MAX_BYTES) {
        throw new AppError('payload_too_large', 'That file is larger than the ' + Math.round(env.UPLOAD_MAX_BYTES / 1024 / 1024) + ' MB limit.');
    }
    const kind = sniffFileType(buffer, ext);
    if (!kind) {
        throw new AppError('unsupported_media_type', 'That file does not look like a valid ' + ext.toUpperCase() + ' document.');
    }
    // Stored under an opaque name inside the tenant's own directory so an
    // attacker cannot influence the path or read another tenant's uploads.
    const dir = path.join(env.UPLOAD_DIR, req.account.id, req.website.id);
    mkdirSync(dir, { recursive: true });
    const storedPath = path.join(dir, randomUUID() + '.' + kind);
    writeFileSync(storedPath, buffer);
    const documents = parseUpload(buffer, safeName, kind);
    if (!documents.length) {
        throw badRequest(kind === 'pdf'
            ? 'No text could be read from that PDF. It is most likely a scanned or image-only ' +
                'document - upload a text-based PDF, or paste the content as Manual Knowledge.'
            : 'Chat Pilot could not read any text from that file.');
    }
    const source = await saveUploadedDocument(req.account.id, req.website.id, {
        originalName: safeName,
        storedPath,
        mimeType: body.mime_type || 'application/octet-stream',
        sizeBytes: buffer.length,
        documents,
    }, req.user.id);
    res.json(ok({ source, stats: await knowledgeStats(req.account.id, req.website.id) }));
}));
portalApiRouter.post('/websites/:websiteId/knowledge/sources/:sourceId/delete', resolveWebsite, asyncRoute(async (req, res) => {
    await deleteSource(req.account.id, req.website.id, req.params.sourceId, req.user.id);
    res.json(ok({ stats: await knowledgeStats(req.account.id, req.website.id) }));
}));
portalApiRouter.post('/websites/:websiteId/knowledge/documents/:documentId/status', resolveWebsite, asyncRoute(async (req, res) => {
    const status = req.body?.status === 'disabled' ? 'disabled' : 'enabled';
    await setDocumentStatus(req.account.id, req.website.id, req.params.documentId, status);
    res.json(ok({ status }));
}));
portalApiRouter.post('/websites/:websiteId/knowledge/documents/:documentId/delete', resolveWebsite, asyncRoute(async (req, res) => {
    await deleteDocument(req.account.id, req.website.id, req.params.documentId);
    res.json(ok({ stats: await knowledgeStats(req.account.id, req.website.id) }));
}));
portalApiRouter.get('/websites/:websiteId/knowledge/documents/:documentId', resolveWebsite, asyncRoute(async (req, res) => {
    const doc = await getDocument(req.account.id, req.website.id, req.params.documentId);
    res.json(ok({ document: { ...doc, content: doc.content.slice(0, 20_000) } }));
}));
/** Retrieval diagnostics: shows what the engine would retrieve, and why. */
portalApiRouter.post('/websites/:websiteId/knowledge/test-retrieval', resolveWebsite, asyncRoute(async (req, res) => {
    const query = stripControlChars(String(req.body?.query ?? '')).trim();
    if (!query)
        throw validationFailed('Enter a question to test.', { query: 'Enter a question.' });
    const config = await getConfig(req.account.id, req.website.id);
    const results = await searchKnowledge(req.account.id, req.website.id, query, {
        limit: 8, threshold: config.retrieval_threshold, bypassThreshold: true,
    });
    res.json(ok({
        threshold: config.retrieval_threshold,
        results: results.map((r) => ({
            id: r.id, title: r.title, sourceType: r.sourceType, category: r.category,
            score: r.score, aboveThreshold: r.score >= config.retrieval_threshold,
            sourceUrl: r.sourceUrl, excerpt: r.content.slice(0, 400),
        })),
    }));
}));
/* --------------------------------------------------------- instructions -- */
portalApiRouter.post('/websites/:websiteId/instructions', resolveWebsite, asyncRoute(async (req, res) => {
    const body = parseOrThrow(z.object({
        business_name: text(160, 'Business name').optional(),
        system_prompt: z.string().max(20_000).optional(),
        tone: z.enum(['professional', 'friendly', 'concise', 'warm', 'formal']).optional(),
        answer_length: z.enum(['brief', 'concise', 'detailed']).optional(),
        fallback_response: text(600, 'Fallback response').optional(),
        greeting_response: text(400, 'Greeting response').optional(),
        generation_error_response: text(400, 'Generation error response').optional(),
        allow_small_talk: z.coerce.boolean().optional(),
        strict_grounding: z.coerce.boolean().optional(),
    }), req.body ?? {});
    const instructions = await updateInstructions(req.account.id, req.website.id, body, req.user.id);
    res.json(ok({ instructions }));
}));
portalApiRouter.post('/websites/:websiteId/instructions/reset', resolveWebsite, asyncRoute(async (req, res) => {
    res.json(ok({ instructions: await resetInstructions(req.account.id, req.website.id, req.user.id) }));
}));
/* ------------------------------------------------- developer preview -- */
portalApiRouter.post('/websites/:websiteId/preview/chat', resolveWebsite, rateLimit({ limit: 40, windowMs: 60_000, scope: 'preview-chat' }), asyncRoute(async (req, res) => {
    const body = parseOrThrow(z.object({
        session_key: z.string().trim().min(6).max(120),
        message: z.string().trim().min(1).max(4000),
        reset: z.coerce.boolean().optional().default(false),
    }), req.body ?? {});
    const history = body.reset
        ? []
        : await getHistoryBySession(req.account.id, req.website.id, body.session_key, 20);
    // Same engine as the widget. Only `includeDiagnostics` differs, and it is
    // gated on this route being session-authenticated for this tenant.
    const response = await generateChatResponse(req.website, {
        accountId: req.account.id,
        websiteId: req.website.id,
        sessionKey: body.session_key,
        message: body.message,
        history,
        source: 'preview',
        visitor: { key: 'preview:' + req.user.id, name: req.user.full_name, email: req.user.email },
        includeDiagnostics: true,
    });
    res.json(ok(response));
}));
/* ---------------------------------------------------------------- widget -- */
portalApiRouter.post('/websites/:websiteId/widget', resolveWebsite, asyncRoute(async (req, res) => {
    const body = parseOrThrow(z.object({
        enabled: z.coerce.boolean().optional(),
        display_name: text(80, 'Display name').optional(),
        position: z.enum(['bottom-right', 'bottom-left']).optional(),
        primary_color: hexColorSchema.optional(),
        icon_color: hexColorSchema.optional(),
        avatar_type: z.enum(['pilot', 'female', 'male', 'robot', 'sparkle', 'custom']).optional(),
        launcher_icon_type: z.enum(['bubble', 'avatar']).optional(),
        logo_url: z.string().trim().max(1000).optional(),
        welcome_message: text(300, 'Welcome message').optional(),
        placeholder_text: text(120, 'Placeholder').optional(),
        suggested_questions: z.string().max(2000).optional(),
        enable_typing: z.coerce.boolean().optional(),
        enable_streaming: z.coerce.boolean().optional(),
        auto_open_chat: z.coerce.boolean().optional(),
        auto_open_delay: z.coerce.number().int().min(0).max(120).optional(),
        open_once_per_visitor: z.coerce.boolean().optional(),
        prechat_enabled: z.coerce.boolean().optional(),
        prechat_intro: z.string().trim().max(300).optional(),
        active_form_id: z.string().trim().max(64).nullable().optional(),
    }), req.body ?? {});
    if (body.avatar_type === 'custom' && body.logo_url && !/^https:\/\//i.test(body.logo_url)) {
        throw validationFailed('The logo URL must start with https://', { logo_url: 'Use an https:// URL.' });
    }
    const patch = { ...body };
    if (body.prechat_enabled !== undefined) {
        patch.prechat_enabled = body.prechat_enabled ? 1 : 0;
    }
    if (body.active_form_id !== undefined) {
        patch.active_form_id = body.active_form_id === '' ? null : body.active_form_id;
        if (body.prechat_enabled === undefined) {
            patch.prechat_enabled = Boolean(body.active_form_id);
        }
    }
    const settings = await updateWidgetSettings(req.account.id, req.website.id, patch, req.user.id);
    res.json(ok({ settings, preview: await publicWidgetConfig(req.account.id, req.website.id) }));
}));
portalApiRouter.get('/websites/:websiteId/widget/preview', resolveWebsite, asyncRoute(async (req, res) => {
    const [preview, settings] = await Promise.all([
        publicWidgetConfig(req.account.id, req.website.id),
        getWidgetSettings(req.account.id, req.website.id),
    ]);
    res.json(ok({ preview, settings }));
}));
/* ----------------------------------------------------------------- forms -- */
const fieldSchema = z.object({
    field_key: z.string().trim().max(40).optional(),
    type: z.string().trim(),
    label: text(120, 'Field label'),
    placeholder: text(160, 'Placeholder').optional().default(''),
    options: z.string().max(2000).optional().default(''),
    required: z.coerce.boolean().optional().default(false),
    enabled: z.coerce.boolean().optional().default(true),
});
portalApiRouter.post('/websites/:websiteId/forms', resolveWebsite, asyncRoute(async (req, res) => {
    const body = parseOrThrow(z.object({
        form_id: z.string().trim().max(64).optional(),
        name: text(160, 'Form name'),
        status: z.enum(['active', 'inactive']).optional().default('active'),
        fields: z.array(fieldSchema).min(1, 'Add at least one field.'),
    }), req.body ?? {});
    for (const f of body.fields) {
        if (!FIELD_TYPES.includes(f.type)) {
            throw validationFailed('Unsupported field type: ' + f.type, { fields: 'Unsupported field type.' });
        }
    }
    const form = await saveForm(req.account.id, req.website.id, {
        formId: body.form_id || undefined,
        name: body.name,
        status: body.status,
        fields: body.fields.map((f) => ({
            fieldKey: f.field_key,
            type: f.type,
            label: f.label,
            placeholder: f.placeholder,
            options: f.options,
            required: f.required,
            enabled: f.enabled,
        })),
    }, req.user.id);
    res.json(ok({ form, forms: await listForms(req.account.id, req.website.id) }));
}));
portalApiRouter.post('/websites/:websiteId/forms/:formId/default', resolveWebsite, asyncRoute(async (req, res) => {
    await setDefaultForm(req.account.id, req.website.id, req.params.formId);
    res.json(ok({ forms: await listForms(req.account.id, req.website.id) }));
}));
portalApiRouter.post('/websites/:websiteId/forms/active', resolveWebsite, asyncRoute(async (req, res) => {
    const formId = String(req.body?.form_id ?? '');
    await setActiveForm(req.account.id, req.website.id, formId || null);
    res.json(ok({ preview: await publicWidgetConfig(req.account.id, req.website.id) }));
}));
portalApiRouter.post('/websites/:websiteId/forms/:formId/duplicate', resolveWebsite, asyncRoute(async (req, res) => {
    await duplicateForm(req.account.id, req.website.id, req.params.formId, req.user.id);
    res.json(ok({ forms: await listForms(req.account.id, req.website.id) }));
}));
portalApiRouter.post('/websites/:websiteId/forms/:formId/delete', resolveWebsite, asyncRoute(async (req, res) => {
    await deleteForm(req.account.id, req.website.id, req.params.formId);
    res.json(ok({ forms: await listForms(req.account.id, req.website.id) }));
}));
portalApiRouter.post('/websites/:websiteId/submissions/:submissionId/delete', resolveWebsite, asyncRoute(async (req, res) => {
    await deleteSubmission(req.account.id, req.website.id, req.params.submissionId);
    res.json(ok({ deleted: true }));
}));
/* --------------------------------------------------------- conversations -- */
portalApiRouter.get('/websites/:websiteId/conversations/:conversationId/transcript', resolveWebsite, asyncRoute(async (req, res) => {
    res.json(ok({
        transcript: await getTranscript(req.account.id, req.website.id, req.params.conversationId),
    }));
}));
portalApiRouter.post('/websites/:websiteId/conversations/:conversationId/status', resolveWebsite, asyncRoute(async (req, res) => {
    const status = String(req.body?.status ?? 'active');
    if (!['active', 'completed', 'archived'].includes(status))
        throw badRequest('Unknown status.');
    await setConversationStatus(req.account.id, req.website.id, req.params.conversationId, status);
    res.json(ok({ status }));
}));
portalApiRouter.post('/websites/:websiteId/conversations/:conversationId/read', resolveWebsite, asyncRoute(async (req, res) => {
    await markRead(req.account.id, req.website.id, req.params.conversationId, 1);
    res.json(ok({ read: true }));
}));
portalApiRouter.post('/websites/:websiteId/conversations/:conversationId/delete', resolveWebsite, asyncRoute(async (req, res) => {
    await deleteConversation(req.account.id, req.website.id, req.params.conversationId);
    res.json(ok({ deleted: true }));
}));
/* ------------------------------------------------------------ site keys -- */
portalApiRouter.post('/websites/:websiteId/keys', resolveWebsite, rateLimit({ limit: 10, windowMs: 60_000, scope: 'site-key-issue' }), asyncRoute(async (req, res) => {
    const label = String(req.body?.label ?? 'Primary').slice(0, 60);
    const issued = await issueSiteKey(req.account.id, req.website.id, label, req.user.id);
    // The plaintext is returned exactly once, right here.
    res.json(ok({ key: issued.plaintext, record: issued.record }));
}));
portalApiRouter.post('/websites/:websiteId/keys/:keyId/revoke', resolveWebsite, asyncRoute(async (req, res) => {
    await revokeSiteKey(req.account.id, req.website.id, req.params.keyId, req.user.id);
    res.json(ok({ revoked: true }));
}));
/* ------------------------------------------------------------- analytics -- */
portalApiRouter.get('/websites/:websiteId/analytics', resolveWebsite, asyncRoute(async (req, res) => {
    const range = resolveRange(typeof req.query.range === 'string' ? req.query.range : '30days', typeof req.query.from === 'string' ? req.query.from : undefined, typeof req.query.to === 'string' ? req.query.to : undefined);
    res.json(ok({ analytics: await websiteAnalytics(req.account.id, req.website.id, range) }));
}));
portalApiRouter.post('/websites/:websiteId/analytics/budget', resolveWebsite, asyncRoute(async (req, res) => {
    const body = parseOrThrow(z.object({
        monthly_budget: z.coerce.number().min(0).max(1_000_000),
        budget_warning_pct: z.coerce.number().int().min(1).max(100),
    }), req.body ?? {});
    await updateWebsite(req.account.id, req.website.id, {
        monthly_budget: body.monthly_budget,
        budget_warning_pct: body.budget_warning_pct,
    }, req.user.id);
    res.json(ok({ budget: body }));
}));
/* ------------------------------------------------------------- settings -- */
portalApiRouter.post('/websites/:websiteId/settings', resolveWebsite, asyncRoute(async (req, res) => {
    const body = parseOrThrow(z.object({
        name: text(160, 'Website name').optional(),
        url: z.string().trim().max(500).optional(),
        status: z.enum(['active', 'inactive']).optional(),
        default_language: z.string().trim().max(10).optional(),
        timezone: z.string().trim().max(50).optional(),
        inactivity_timeout_minutes: z.coerce.number().int().min(5).max(1440).optional(),
        retention_days: z.coerce.number().int().min(0).max(3650).optional(),
        notification_email: z.string().trim().max(200).optional(),
        enable_notifications: z.coerce.boolean().optional(),
        notify_on_lead: z.coerce.boolean().optional(),
        notify_on_form: z.coerce.boolean().optional(),
        notify_on_conversation: z.coerce.boolean().optional(),
        notify_on_budget_warning: z.coerce.boolean().optional(),
        notify_on_ai_failure: z.coerce.boolean().optional(),
        store_conversations: z.coerce.boolean().optional(),
        store_visitor_info: z.coerce.boolean().optional(),
        anonymize_ips: z.coerce.boolean().optional(),
    }), req.body ?? {});
    const updated = await updateWebsite(req.account.id, req.website.id, body, req.user.id);
    res.json(ok({ website: updated }));
}));
portalApiRouter.post('/websites/:websiteId/settings/test-notification', resolveWebsite, asyncRoute(async (req, res) => {
    const rawRecipient = typeof req.body?.recipient === 'string' ? req.body.recipient.trim() : '';
    const result = await sendTestNotification(req.account.id, req.website.id, rawRecipient);
    res.json(ok({ message: `Test notification sent to ${result.recipient}`, result }));
}));

