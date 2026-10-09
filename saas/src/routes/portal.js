/**
 * Client portal (server-rendered).
 *
 * Layout mirrors the WordPress plugin: a Chat Pilot header, a horizontal tab
 * strip (Dashboard / AI Providers / Knowledge Base / AI Instructions /
 * Developer Chat Preview / Chat Widget / Forms / Conversations / Analytics /
 * Settings / Support) and the same dark glassmorphic card system.
 */
import { Router } from 'express';
import { z } from 'zod';
import { parseOrThrow, text } from "../core/validate.js";
import { AppError } from "../core/errors.js";
import { asyncRoute } from "../middleware/errors.js";
import { requireAuth, requireCsrf, resolveAccount } from "../middleware/session.js";
import { resolveWebsite } from "../middleware/websiteScope.js";
import { clientIp } from "../middleware/security.js";
import { createWebsite, listWebsites, listDomains, updateWebsite, deleteWebsite, addDomain, removeDomain, planLimitFor, countWebsites, } from "../services/websites.js";
import { providerOverview, getConfig } from "../services/providerService.js";
import { getInstructions } from "../services/instructions.js";
import { getWidgetSettings, publicWidgetConfig } from "../services/widget.js";
import { listForms, listSubmissions } from "../services/forms.js";
import { listConversations, getTranscript, getConversation, countConversations } from "../services/conversations.js";
import { listSources, listDocuments, knowledgeStats } from "../services/knowledge.js";
import { listSiteKeys } from "../services/siteKeys.js";
import { accountAnalytics, resolveRange, websiteAnalytics, toCsv } from "../services/analytics.js";
import { accountUsage, usageHistory } from "../services/usage.js";
import { getBudgetStatus, setBudget } from "../services/budget.js";
import { getSubscription, listPlans } from "../services/plans.js";
import { updateAccount, listAccountsForUser } from "../services/accounts.js";
import { listNotifications, listNotificationsForWebsite } from "../services/notifications.js";
import { env } from "../config/env.js";
import { getPluginVersion } from "../services/pluginPackage.js";
export const portalRouter = Router();
portalRouter.use(requireAuth, resolveAccount);
/** Shared view context so every template has nav state without repetition. */
async function baseContext(req) {
    return {
        user: req.user,
        account: req.account,
        accounts: req.accounts ?? [],
        csrfToken: req.csrfToken,
        websites: await listWebsites(req.account.id),
        appUrl: env.APP_URL,
        pluginVersion: getPluginVersion(),
        pluginDownloadUrl: '/download/plugin',
        notice: typeof req.query.notice === 'string' ? req.query.notice : '',
        error: typeof req.query.error === 'string' ? req.query.error : '',
    };
}
/* ----------------------------------------------------------- dashboard -- */
portalRouter.get('/', asyncRoute(async (req, res) => {
    const ctx = await baseContext(req);
    const range = resolveRange('30days');
    const [analytics, usage, subscription, websiteLimit, websiteCount] = await Promise.all([
        accountAnalytics(req.account.id, range),
        accountUsage(req.account.id),
        getSubscription(req.account.id),
        planLimitFor(req.account.id, 'max_websites'),
        countWebsites(req.account.id),
    ]);
    res.render('portal/dashboard', {
        ...ctx,
        title: 'Dashboard',
        activeTab: 'dashboard',
        analytics,
        usage,
        subscription,
        websiteLimit,
        websiteCount,
    });
}));
portalRouter.post('/', (req, res) => res.redirect(303, '/app'));
portalRouter.get('/download/plugin', (_req, res) => res.redirect(303, '/download/plugin'));
/* ------------------------------------------------------------ websites -- */
portalRouter.get('/websites', asyncRoute(async (req, res) => {
    res.render('portal/websites', {
        ...(await baseContext(req)),
        title: 'My Websites',
        activeTab: 'websites',
        websiteLimit: await planLimitFor(req.account.id, 'max_websites'),
    });
}));
portalRouter.get('/websites/new', asyncRoute(async (req, res) => {
    res.render('portal/website-new', {
        ...(await baseContext(req)),
        title: 'Add a website',
        activeTab: 'websites',
        welcome: req.query.welcome === '1',
        fields: {},
        values: {},
        formError: '',
    });
}));
const newWebsiteSchema = z.object({
    name: text(160, 'Website name').refine((v) => v.length >= 2, 'Enter a website name.'),
    url: z.string().trim().min(3, 'Enter your website URL.').max(500),
});
portalRouter.post('/websites', requireCsrf, asyncRoute(async (req, res) => {
    const raw = (req.body ?? {});
    try {
        const parsed = parseOrThrow(newWebsiteSchema, raw);
        const site = await createWebsite({
            accountId: req.account.id,
            name: parsed.name,
            url: parsed.url,
            actorId: req.user.id,
            ip: clientIp(req),
        });
        res.redirect('/app/websites/' + site.id + '/providers?notice=' +
            encodeURIComponent('Website registered. Next, connect your AI provider.'));
    }
    catch (err) {
        const appError = err instanceof AppError ? err : null;
        res.status(appError?.status ?? 422).render('portal/website-new', {
            ...(await baseContext(req)),
            title: 'Add a website',
            activeTab: 'websites',
            welcome: false,
            fields: appError?.fields ?? {},
            values: { name: String(raw.name ?? ''), url: String(raw.url ?? '') },
            formError: appError?.publicMessage ?? 'Could not register that website.',
        });
    }
}));
/* ------------------------------------------------- website-scoped pages -- */
const websiteScope = [resolveWebsite];
async function websiteContext(req) {
    return {
        ...(await baseContext(req)),
        website: req.website,
        providerConfig: await getConfig(req.account.id, req.website.id),
    };
}
portalRouter.get('/websites/:websiteId', ...websiteScope, asyncRoute(async (req, res) => {
    const range = resolveRange('30days');
    const [ctx, analytics, knowledge, providers, keys, widget] = await Promise.all([
        websiteContext(req),
        websiteAnalytics(req.account.id, req.website.id, range),
        knowledgeStats(req.account.id, req.website.id),
        providerOverview(req.account.id, req.website.id),
        listSiteKeys(req.account.id, req.website.id),
        publicWidgetConfig(req.account.id, req.website.id),
    ]);
    res.render('portal/website-overview', {
        ...ctx,
        title: req.website.name,
        activeTab: 'overview',
        analytics,
        knowledge,
        providers,
        keys,
        widget,
    });
}));
portalRouter.get('/websites/:websiteId/settings', ...websiteScope, asyncRoute(async (req, res) => {
    const [ctx, notifications] = await Promise.all([
        websiteContext(req),
        listNotificationsForWebsite(req.account.id, req.website.id, 25),
    ]);
    res.render('portal/settings', {
        ...ctx,
        title: 'Settings',
        activeTab: 'settings',
        notifications,
    });
}));
portalRouter.post('/websites/:websiteId/settings', ...websiteScope, requireCsrf, asyncRoute(async (req, res) => {
    const raw = (req.body ?? {});
    try {
        await updateWebsite(req.account.id, req.website.id, {
            name: raw.name === undefined ? undefined : String(raw.name),
            url: raw.url === undefined ? undefined : String(raw.url),
            status: raw.status === 'inactive' ? 'inactive' : raw.status === 'active' ? 'active' : undefined,
            default_language: raw.default_language === undefined ? undefined : String(raw.default_language),
            timezone: raw.timezone === undefined ? undefined : String(raw.timezone),
            inactivity_timeout_minutes: raw.inactivity_timeout_minutes === undefined
                ? undefined
                : Number(raw.inactivity_timeout_minutes),
            retention_days: raw.retention_days === undefined ? undefined : Number(raw.retention_days),
            notification_email: raw.notification_email === undefined ? undefined : String(raw.notification_email),
            enable_notifications: raw.enable_notifications !== undefined,
            notify_on_lead: raw.notify_on_lead !== undefined,
            notify_on_form: raw.notify_on_form !== undefined,
            notify_on_conversation: raw.notify_on_conversation !== undefined,
            notify_on_budget_warning: raw.notify_on_budget_warning !== undefined,
            notify_on_ai_failure: raw.notify_on_ai_failure !== undefined,
            store_conversations: raw.store_conversations !== undefined,
            store_visitor_info: raw.store_visitor_info !== undefined,
            anonymize_ips: raw.anonymize_ips !== undefined,
        }, req.user.id);
        res.redirect('/app/websites/' + req.website.id + '/settings?notice=' +
            encodeURIComponent('Website settings saved.'));
    }
    catch (err) {
        const message = err instanceof AppError ? err.publicMessage : 'Could not save those settings.';
        res.redirect('/app/websites/' + req.website.id + '/settings?error=' + encodeURIComponent(message));
    }
}));
portalRouter.get('/websites/:websiteId/support', ...websiteScope, asyncRoute(async (req, res) => {
    const ctx = await websiteContext(req);
    res.render('portal/support', {
        ...ctx,
        title: 'Support',
        activeTab: 'support',
    });
}));
portalRouter.post('/websites/:websiteId/delete', ...websiteScope, requireCsrf, asyncRoute(async (req, res) => {
    await deleteWebsite(req.account.id, req.website.id, req.user.id);
    res.redirect('/app/websites?notice=' + encodeURIComponent('Website deleted.'));
}));
/* ------------------------------------------------------- ai providers -- */
portalRouter.get('/websites/:websiteId/providers', ...websiteScope, asyncRoute(async (req, res) => {
    const [ctx, providers] = await Promise.all([
        websiteContext(req),
        providerOverview(req.account.id, req.website.id),
    ]);
    res.render('portal/providers', {
        ...ctx,
        title: 'AI Providers',
        activeTab: 'providers',
        providers,
    });
}));
/* ------------------------------------------------------ knowledge base -- */
portalRouter.get('/websites/:websiteId/knowledge', ...websiteScope, asyncRoute(async (req, res) => {
    const accountId = req.account.id;
    const websiteId = req.website.id;
    const [ctx, stats, sources, faqs, manual, files, siteSources, documents, maxDocuments] = await Promise.all([
        websiteContext(req),
        knowledgeStats(accountId, websiteId),
        listSources(accountId, websiteId),
        listSources(accountId, websiteId, 'faq'),
        listSources(accountId, websiteId, 'manual'),
        listSources(accountId, websiteId, 'file'),
        listSources(accountId, websiteId, 'website'),
        listDocuments(accountId, websiteId, { limit: 100 }),
        planLimitFor(accountId, 'max_documents'),
    ]);
    res.render('portal/knowledge', {
        ...ctx,
        title: 'Knowledge Base',
        activeTab: 'knowledge',
        stats,
        sources,
        faqs,
        manual,
        files,
        siteSources,
        documents,
        maxDocuments,
        uploadMaxBytes: env.UPLOAD_MAX_BYTES,
    });
}));
/* ----------------------------------------------------- ai instructions -- */
portalRouter.get('/websites/:websiteId/instructions', ...websiteScope, asyncRoute(async (req, res) => {
    const [ctx, instructions] = await Promise.all([
        websiteContext(req),
        getInstructions(req.account.id, req.website.id),
    ]);
    res.render('portal/instructions', {
        ...ctx,
        title: 'AI Instructions',
        activeTab: 'instructions',
        instructions,
    });
}));
/* ------------------------------------------------- developer preview -- */
portalRouter.get('/websites/:websiteId/preview', ...websiteScope, asyncRoute(async (req, res) => {
    const [ctx, providers, instructions, knowledge] = await Promise.all([
        websiteContext(req),
        providerOverview(req.account.id, req.website.id),
        getInstructions(req.account.id, req.website.id),
        knowledgeStats(req.account.id, req.website.id),
    ]);
    res.render('portal/preview', {
        ...ctx,
        title: 'Developer Chat Preview',
        activeTab: 'preview',
        providers,
        instructions,
        knowledge,
    });
}));
/* ----------------------------------------------------------- chat widget -- */
portalRouter.get('/websites/:websiteId/widget', ...websiteScope, asyncRoute(async (req, res) => {
    const [ctx, settings, forms] = await Promise.all([
        websiteContext(req),
        getWidgetSettings(req.account.id, req.website.id),
        listForms(req.account.id, req.website.id),
    ]);
    res.render('portal/widget', {
        ...ctx,
        title: 'Chat Widget',
        activeTab: 'widget',
        settings,
        forms,
    });
}));
/* ----------------------------------------------------------------- forms -- */
portalRouter.get('/websites/:websiteId/forms', ...websiteScope, asyncRoute(async (req, res) => {
    const [ctx, forms, widgetSettings] = await Promise.all([
        websiteContext(req),
        listForms(req.account.id, req.website.id),
        getWidgetSettings(req.account.id, req.website.id),
    ]);
    res.render('portal/forms', {
        ...ctx,
        title: 'Forms',
        activeTab: 'forms',
        forms,
        widgetSettings,
    });
}));
portalRouter.get('/websites/:websiteId/leads', ...websiteScope, asyncRoute(async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    const formId = typeof req.query.form === 'string' ? req.query.form : '';
    const [ctx, submissions, forms] = await Promise.all([
        websiteContext(req),
        listSubmissions(req.account.id, req.website.id, {
            search: search || undefined,
            formId: formId || undefined,
            limit: 100,
        }),
        listForms(req.account.id, req.website.id),
    ]);
    res.render('portal/leads', {
        ...ctx,
        title: 'Leads',
        activeTab: 'leads',
        submissions,
        forms,
        search,
        formId,
    });
}));
/* --------------------------------------------------------- conversations -- */
portalRouter.get('/websites/:websiteId/conversations', ...websiteScope, asyncRoute(async (req, res) => {
    const filter = {
        status: typeof req.query.status === 'string' ? req.query.status : 'all',
        source: typeof req.query.source === 'string' ? req.query.source : 'all',
        search: typeof req.query.search === 'string' ? req.query.search : '',
    };
    const [ctx, conversations, total] = await Promise.all([
        websiteContext(req),
        listConversations(req.account.id, req.website.id, {
            status: filter.status,
            source: filter.source,
            search: filter.search || undefined,
            limit: 100,
        }),
        countConversations(req.account.id, req.website.id),
    ]);
    res.render('portal/conversations', {
        ...ctx,
        title: 'Conversations',
        activeTab: 'conversations',
        conversations,
        total,
        filter,
    });
}));
portalRouter.get('/websites/:websiteId/conversations/:conversationId', ...websiteScope, asyncRoute(async (req, res) => {
    const conversation = await getConversation(req.account.id, req.website.id, req.params.conversationId);
    const [ctx, transcript, submissions] = await Promise.all([
        websiteContext(req),
        getTranscript(req.account.id, req.website.id, conversation.id),
        listSubmissions(req.account.id, req.website.id, { limit: 200 }),
    ]);
    res.render('portal/conversation-detail', {
        ...ctx,
        title: 'Conversation',
        activeTab: 'conversations',
        conversation,
        transcript,
        submissions: submissions.filter((s) => s.conversation_id === conversation.id),
    });
}));
/* -------------------------------------------------------------- analytics -- */
portalRouter.get('/websites/:websiteId/analytics', ...websiteScope, asyncRoute(async (req, res) => {
    const preset = typeof req.query.range === 'string' ? req.query.range : '30days';
    const range = resolveRange(preset, typeof req.query.from === 'string' ? req.query.from : undefined, typeof req.query.to === 'string' ? req.query.to : undefined);
    const [ctx, analytics, usage] = await Promise.all([
        websiteContext(req),
        websiteAnalytics(req.account.id, req.website.id, range),
        accountUsage(req.account.id),
    ]);
    res.render('portal/analytics', {
        ...ctx,
        title: 'Analytics',
        activeTab: 'analytics',
        preset,
        analytics,
        usage,
    });
}));
portalRouter.get('/websites/:websiteId/analytics.csv', ...websiteScope, asyncRoute(async (req, res) => {
    const range = resolveRange(typeof req.query.range === 'string' ? req.query.range : '30days');
    const analytics = await websiteAnalytics(req.account.id, req.website.id, range);
    const csv = toCsv(analytics.trend.map((t) => ({
        date: t.date,
        conversations: t.conversations,
        ai_requests: t.aiRequests,
        tokens: t.tokens,
        estimated_cost: t.cost,
    })));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="chat-pilot-analytics.csv"');
    res.send(csv || 'date,conversations,ai_requests,tokens,estimated_cost\n');
}));
portalRouter.post('/websites/:websiteId/analytics/budget', ...websiteScope, requireCsrf, asyncRoute(async (req, res) => {
    const raw = req.body ?? {};
    try {
        const parsed = parseOrThrow(z.object({
            monthly_budget: z.coerce.number().min(0).max(1_000_000),
            budget_warning_pct: z.coerce.number().int().min(1).max(100),
        }), raw);
        await updateWebsite(req.account.id, req.website.id, {
            monthly_budget: parsed.monthly_budget,
            budget_warning_pct: parsed.budget_warning_pct,
        }, req.user.id);
        res.redirect('/app/websites/' + req.website.id + '/analytics?notice=' + encodeURIComponent('Budget settings saved.'));
    } catch (err) {
        const message = err instanceof AppError ? err.publicMessage : 'Could not save that budget.';
        res.redirect('/app/websites/' + req.website.id + '/analytics?error=' + encodeURIComponent(message));
    }
}));
/* ------------------------------------------------------------- connection -- */
portalRouter.get('/websites/:websiteId/connection', ...websiteScope, asyncRoute(async (req, res) => {
    const [ctx, keys, domains] = await Promise.all([
        websiteContext(req),
        listSiteKeys(req.account.id, req.website.id),
        listDomains(req.account.id, req.website.id),
    ]);
    res.render('portal/connection', {
        ...ctx,
        title: 'Connection',
        activeTab: 'connection',
        keys,
        domains,
        newKey: typeof req.query.key === 'string' ? req.query.key : '',
    });
}));
portalRouter.post('/websites/:websiteId/domains', ...websiteScope, requireCsrf, asyncRoute(async (req, res) => {
    try {
        await addDomain(req.account.id, req.website.id, String(req.body.domain ?? ''));
        res.redirect('/app/websites/' + req.website.id + '/connection?notice=' +
            encodeURIComponent('Domain added.'));
    }
    catch (err) {
        const message = err instanceof AppError ? err.publicMessage : 'Could not add that domain.';
        res.redirect('/app/websites/' + req.website.id + '/connection?error=' + encodeURIComponent(message));
    }
}));
portalRouter.post('/websites/:websiteId/domains/:domainId/delete', ...websiteScope, requireCsrf, asyncRoute(async (req, res) => {
    await removeDomain(req.account.id, req.website.id, req.params.domainId);
    res.redirect('/app/websites/' + req.website.id + '/connection?notice=' +
        encodeURIComponent('Domain removed.'));
}));
/* ------------------------------------------------- account-level pages -- */
portalRouter.get('/usage', asyncRoute(async (req, res) => {
    const [ctx, usage, history, subscription, budget] = await Promise.all([
        baseContext(req),
        accountUsage(req.account.id),
        usageHistory(req.account.id, 12),
        getSubscription(req.account.id),
        getBudgetStatus(req.account.id),
    ]);
    res.render('portal/usage', {
        ...ctx,
        title: 'Usage',
        activeTab: 'usage',
        usage,
        history,
        subscription,
        budget,
    });
}));
portalRouter.post('/usage/budget', requireCsrf, asyncRoute(async (req, res) => {
    const raw = (req.body ?? {});
    try {
        const parsed = parseOrThrow(z.object({
            monthly_budget: z.coerce.number().min(0).max(1_000_000),
            alert_percent: z.coerce.number().int().min(1).max(100),
        }), raw);
        await setBudget(req.account.id, parsed.monthly_budget, parsed.alert_percent, req.user.id);
        res.redirect('/app/usage?notice=' + encodeURIComponent('Monthly AI budget saved.'));
    }
    catch (err) {
        const message = err instanceof AppError ? err.publicMessage : 'Could not save that budget.';
        res.redirect('/app/usage?error=' + encodeURIComponent(message));
    }
}));
portalRouter.get('/billing', asyncRoute(async (req, res) => {
    const [ctx, subscription, plans, usage] = await Promise.all([
        baseContext(req),
        getSubscription(req.account.id),
        listPlans(),
        accountUsage(req.account.id),
    ]);
    res.render('portal/billing', {
        ...ctx,
        title: 'Billing',
        activeTab: 'billing',
        subscription,
        plans,
        usage,
    });
}));
portalRouter.get('/account', asyncRoute(async (req, res) => {
    const [ctx, memberships, notifications] = await Promise.all([
        baseContext(req),
        listAccountsForUser(req.user.id),
        listNotifications(req.account.id, 20),
    ]);
    res.render('portal/account', {
        ...ctx,
        title: 'Account',
        activeTab: 'account',
        memberships,
        notifications,
    });
}));
portalRouter.post('/account', requireCsrf, asyncRoute(async (req, res) => {
    const raw = (req.body ?? {});
    await updateAccount(req.account.id, {
        name: raw.name === undefined ? undefined : String(raw.name),
        billingEmail: raw.billing_email === undefined ? undefined : String(raw.billing_email),
    });
    res.redirect('/app/account?notice=' + encodeURIComponent('Account details saved.'));
}));
portalRouter.get('/support', asyncRoute(async (req, res) => {
    res.render('portal/support', {
        ...(await baseContext(req)),
        title: 'Support',
        activeTab: 'support',
    });
}));
