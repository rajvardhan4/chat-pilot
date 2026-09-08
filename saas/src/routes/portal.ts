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
import { parseOrThrow, text } from '../core/validate.ts';
import { AppError } from '../core/errors.ts';
import { asyncRoute } from '../middleware/errors.ts';
import { requireAuth, requireCsrf, resolveAccount } from '../middleware/session.ts';
import { resolveWebsite } from '../middleware/websiteScope.ts';
import { clientIp } from '../middleware/security.ts';
import {
  createWebsite,
  listWebsites,
  listDomains,
  updateWebsite,
  deleteWebsite,
  addDomain,
  removeDomain,
  planLimitFor,
  countWebsites,
} from '../services/websites.ts';
import { providerOverview, getConfig } from '../services/providerService.ts';
import { getInstructions } from '../services/instructions.ts';
import { getWidgetSettings, publicWidgetConfig } from '../services/widget.ts';
import { listForms, listSubmissions } from '../services/forms.ts';
import { listConversations, getTranscript, getConversation, countConversations } from '../services/conversations.ts';
import { listSources, listDocuments, knowledgeStats } from '../services/knowledge.ts';
import { listSiteKeys } from '../services/siteKeys.ts';
import { accountAnalytics, resolveRange, websiteAnalytics, toCsv } from '../services/analytics.ts';
import { accountUsage, usageHistory } from '../services/usage.ts';
import { getBudgetStatus, setBudget } from '../services/budget.ts';
import { getSubscription, listPlans } from '../services/plans.ts';
import { updateAccount, listAccountsForUser } from '../services/accounts.ts';
import { listNotifications } from '../services/notifications.ts';
import { env } from '../config/env.ts';

export const portalRouter: Router = Router();

portalRouter.use(requireAuth, resolveAccount);

/** Shared view context so every template has nav state without repetition. */
function baseContext(req: Parameters<typeof asyncRoute>[0] extends never ? never : any) {
  return {
    user: req.user,
    account: req.account,
    accounts: req.accounts ?? [],
    csrfToken: req.csrfToken,
    websites: listWebsites(req.account.id),
    appUrl: env.APP_URL,
    notice: typeof req.query.notice === 'string' ? req.query.notice : '',
    error: typeof req.query.error === 'string' ? req.query.error : '',
  };
}

/* ----------------------------------------------------------- dashboard -- */

portalRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const ctx = baseContext(req);
    const range = resolveRange('30days');
    const analytics = accountAnalytics(req.account!.id, range);
    const usage = accountUsage(req.account!.id);
    const subscription = getSubscription(req.account!.id);

    res.render('portal/dashboard', {
      ...ctx,
      title: 'Dashboard',
      activeTab: 'dashboard',
      analytics,
      usage,
      subscription,
      websiteLimit: planLimitFor(req.account!.id, 'max_websites'),
      websiteCount: countWebsites(req.account!.id),
    });
  }),
);

/* ------------------------------------------------------------ websites -- */

portalRouter.get(
  '/websites',
  asyncRoute(async (req, res) => {
    res.render('portal/websites', {
      ...baseContext(req),
      title: 'My Websites',
      activeTab: 'websites',
      websiteLimit: planLimitFor(req.account!.id, 'max_websites'),
    });
  }),
);

portalRouter.get(
  '/websites/new',
  asyncRoute(async (req, res) => {
    res.render('portal/website-new', {
      ...baseContext(req),
      title: 'Add a website',
      activeTab: 'websites',
      welcome: req.query.welcome === '1',
      fields: {},
      values: {},
      formError: '',
    });
  }),
);

const newWebsiteSchema = z.object({
  name: text(160, 'Website name').refine((v) => v.length >= 2, 'Enter a website name.'),
  url: z.string().trim().min(3, 'Enter your website URL.').max(500),
});

portalRouter.post(
  '/websites',
  requireCsrf,
  asyncRoute(async (req, res) => {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    try {
      const parsed = parseOrThrow(newWebsiteSchema, raw);
      const site = createWebsite({
        accountId: req.account!.id,
        name: parsed.name,
        url: parsed.url,
        actorId: req.user!.id,
        ip: clientIp(req),
      });
      res.redirect('/app/websites/' + site.id + '/providers?notice=' +
        encodeURIComponent('Website registered. Next, connect your AI provider.'));
    } catch (err) {
      const appError = err instanceof AppError ? err : null;
      res.status(appError?.status ?? 422).render('portal/website-new', {
        ...baseContext(req),
        title: 'Add a website',
        activeTab: 'websites',
        welcome: false,
        fields: appError?.fields ?? {},
        values: { name: String(raw.name ?? ''), url: String(raw.url ?? '') },
        formError: appError?.publicMessage ?? 'Could not register that website.',
      });
    }
  }),
);

/* ------------------------------------------------- website-scoped pages -- */

const websiteScope = [resolveWebsite] as const;

function websiteContext(req: any) {
  return {
    ...baseContext(req),
    website: req.website,
    providerConfig: getConfig(req.account.id, req.website.id),
  };
}

portalRouter.get(
  '/websites/:websiteId',
  ...websiteScope,
  asyncRoute(async (req, res) => {
    const range = resolveRange('30days');
    res.render('portal/website-overview', {
      ...websiteContext(req),
      title: req.website!.name,
      activeTab: 'overview',
      analytics: websiteAnalytics(req.account!.id, req.website!.id, range),
      knowledge: knowledgeStats(req.account!.id, req.website!.id),
      providers: providerOverview(req.account!.id, req.website!.id),
      keys: listSiteKeys(req.account!.id, req.website!.id),
      widget: publicWidgetConfig(req.account!.id, req.website!.id),
    });
  }),
);

portalRouter.post(
  '/websites/:websiteId/settings',
  ...websiteScope,
  requireCsrf,
  asyncRoute(async (req, res) => {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    try {
      updateWebsite(
        req.account!.id,
        req.website!.id,
        {
          name: raw.name === undefined ? undefined : String(raw.name),
          url: raw.url === undefined ? undefined : String(raw.url),
          status: raw.status === 'inactive' ? 'inactive' : raw.status === 'active' ? 'active' : undefined,
          inactivity_timeout_minutes: raw.inactivity_timeout_minutes === undefined
            ? undefined
            : Number(raw.inactivity_timeout_minutes),
          retention_days: raw.retention_days === undefined ? undefined : Number(raw.retention_days),
        },
        req.user!.id,
      );
      res.redirect('/app/websites/' + req.website!.id + '/connection?notice=' +
        encodeURIComponent('Website settings saved.'));
    } catch (err) {
      const message = err instanceof AppError ? err.publicMessage : 'Could not save those settings.';
      res.redirect('/app/websites/' + req.website!.id + '/connection?error=' + encodeURIComponent(message));
    }
  }),
);

portalRouter.post(
  '/websites/:websiteId/delete',
  ...websiteScope,
  requireCsrf,
  asyncRoute(async (req, res) => {
    deleteWebsite(req.account!.id, req.website!.id, req.user!.id);
    res.redirect('/app/websites?notice=' + encodeURIComponent('Website deleted.'));
  }),
);

/* ------------------------------------------------------- ai providers -- */

portalRouter.get(
  '/websites/:websiteId/providers',
  ...websiteScope,
  asyncRoute(async (req, res) => {
    res.render('portal/providers', {
      ...websiteContext(req),
      title: 'AI Providers',
      activeTab: 'providers',
      providers: providerOverview(req.account!.id, req.website!.id),
    });
  }),
);

/* ------------------------------------------------------ knowledge base -- */

portalRouter.get(
  '/websites/:websiteId/knowledge',
  ...websiteScope,
  asyncRoute(async (req, res) => {
    const accountId = req.account!.id;
    const websiteId = req.website!.id;
    res.render('portal/knowledge', {
      ...websiteContext(req),
      title: 'Knowledge Base',
      activeTab: 'knowledge',
      stats: knowledgeStats(accountId, websiteId),
      sources: listSources(accountId, websiteId),
      faqs: listSources(accountId, websiteId, 'faq'),
      manual: listSources(accountId, websiteId, 'manual'),
      files: listSources(accountId, websiteId, 'file'),
      siteSources: listSources(accountId, websiteId, 'website'),
      documents: listDocuments(accountId, websiteId, { limit: 100 }),
      maxDocuments: planLimitFor(accountId, 'max_documents'),
      uploadMaxBytes: env.UPLOAD_MAX_BYTES,
    });
  }),
);

/* ----------------------------------------------------- ai instructions -- */

portalRouter.get(
  '/websites/:websiteId/instructions',
  ...websiteScope,
  asyncRoute(async (req, res) => {
    res.render('portal/instructions', {
      ...websiteContext(req),
      title: 'AI Instructions',
      activeTab: 'instructions',
      instructions: getInstructions(req.account!.id, req.website!.id),
    });
  }),
);

/* ------------------------------------------------- developer preview -- */

portalRouter.get(
  '/websites/:websiteId/preview',
  ...websiteScope,
  asyncRoute(async (req, res) => {
    res.render('portal/preview', {
      ...websiteContext(req),
      title: 'Developer Chat Preview',
      activeTab: 'preview',
      providers: providerOverview(req.account!.id, req.website!.id),
      instructions: getInstructions(req.account!.id, req.website!.id),
      knowledge: knowledgeStats(req.account!.id, req.website!.id),
    });
  }),
);

/* ----------------------------------------------------------- chat widget -- */

portalRouter.get(
  '/websites/:websiteId/widget',
  ...websiteScope,
  asyncRoute(async (req, res) => {
    res.render('portal/widget', {
      ...websiteContext(req),
      title: 'Chat Widget',
      activeTab: 'widget',
      settings: getWidgetSettings(req.account!.id, req.website!.id),
      forms: listForms(req.account!.id, req.website!.id),
    });
  }),
);

/* ----------------------------------------------------------------- forms -- */

portalRouter.get(
  '/websites/:websiteId/forms',
  ...websiteScope,
  asyncRoute(async (req, res) => {
    res.render('portal/forms', {
      ...websiteContext(req),
      title: 'Forms',
      activeTab: 'forms',
      forms: listForms(req.account!.id, req.website!.id),
      widgetSettings: getWidgetSettings(req.account!.id, req.website!.id),
    });
  }),
);

portalRouter.get(
  '/websites/:websiteId/leads',
  ...websiteScope,
  asyncRoute(async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    const formId = typeof req.query.form === 'string' ? req.query.form : '';
    res.render('portal/leads', {
      ...websiteContext(req),
      title: 'Leads',
      activeTab: 'leads',
      submissions: listSubmissions(req.account!.id, req.website!.id, {
        search: search || undefined,
        formId: formId || undefined,
        limit: 100,
      }),
      forms: listForms(req.account!.id, req.website!.id),
      search,
      formId,
    });
  }),
);

/* --------------------------------------------------------- conversations -- */

portalRouter.get(
  '/websites/:websiteId/conversations',
  ...websiteScope,
  asyncRoute(async (req, res) => {
    const filter = {
      status: typeof req.query.status === 'string' ? req.query.status : 'all',
      source: typeof req.query.source === 'string' ? req.query.source : 'all',
      search: typeof req.query.search === 'string' ? req.query.search : '',
    };
    res.render('portal/conversations', {
      ...websiteContext(req),
      title: 'Conversations',
      activeTab: 'conversations',
      conversations: listConversations(req.account!.id, req.website!.id, {
        status: filter.status,
        source: filter.source,
        search: filter.search || undefined,
        limit: 100,
      }),
      total: countConversations(req.account!.id, req.website!.id),
      filter,
    });
  }),
);

portalRouter.get(
  '/websites/:websiteId/conversations/:conversationId',
  ...websiteScope,
  asyncRoute(async (req, res) => {
    const conversation = getConversation(
      req.account!.id, req.website!.id, req.params.conversationId as string,
    );
    res.render('portal/conversation-detail', {
      ...websiteContext(req),
      title: 'Conversation',
      activeTab: 'conversations',
      conversation,
      transcript: getTranscript(req.account!.id, req.website!.id, conversation.id),
      submissions: listSubmissions(req.account!.id, req.website!.id, { limit: 200 })
        .filter((s) => s.conversation_id === conversation.id),
    });
  }),
);

/* -------------------------------------------------------------- analytics -- */

portalRouter.get(
  '/websites/:websiteId/analytics',
  ...websiteScope,
  asyncRoute(async (req, res) => {
    const preset = typeof req.query.range === 'string' ? req.query.range : '30days';
    const range = resolveRange(
      preset,
      typeof req.query.from === 'string' ? req.query.from : undefined,
      typeof req.query.to === 'string' ? req.query.to : undefined,
    );
    res.render('portal/analytics', {
      ...websiteContext(req),
      title: 'Analytics',
      activeTab: 'analytics',
      preset,
      analytics: websiteAnalytics(req.account!.id, req.website!.id, range),
      usage: accountUsage(req.account!.id),
    });
  }),
);

portalRouter.get(
  '/websites/:websiteId/analytics.csv',
  ...websiteScope,
  asyncRoute(async (req, res) => {
    const range = resolveRange(typeof req.query.range === 'string' ? req.query.range : '30days');
    const analytics = websiteAnalytics(req.account!.id, req.website!.id, range);
    const csv = toCsv(
      analytics.trend.map((t) => ({
        date: t.date,
        conversations: t.conversations,
        ai_requests: t.aiRequests,
        tokens: t.tokens,
        estimated_cost: t.cost,
      })),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="chat-pilot-analytics.csv"');
    res.send(csv || 'date,conversations,ai_requests,tokens,estimated_cost\n');
  }),
);

/* ------------------------------------------------------------- connection -- */

portalRouter.get(
  '/websites/:websiteId/connection',
  ...websiteScope,
  asyncRoute(async (req, res) => {
    res.render('portal/connection', {
      ...websiteContext(req),
      title: 'Connection',
      activeTab: 'connection',
      keys: listSiteKeys(req.account!.id, req.website!.id),
      domains: listDomains(req.account!.id, req.website!.id),
      newKey: typeof req.query.key === 'string' ? req.query.key : '',
    });
  }),
);

portalRouter.post(
  '/websites/:websiteId/domains',
  ...websiteScope,
  requireCsrf,
  asyncRoute(async (req, res) => {
    try {
      addDomain(req.account!.id, req.website!.id, String((req.body as any).domain ?? ''));
      res.redirect('/app/websites/' + req.website!.id + '/connection?notice=' +
        encodeURIComponent('Domain added.'));
    } catch (err) {
      const message = err instanceof AppError ? err.publicMessage : 'Could not add that domain.';
      res.redirect('/app/websites/' + req.website!.id + '/connection?error=' + encodeURIComponent(message));
    }
  }),
);

portalRouter.post(
  '/websites/:websiteId/domains/:domainId/delete',
  ...websiteScope,
  requireCsrf,
  asyncRoute(async (req, res) => {
    removeDomain(req.account!.id, req.website!.id, req.params.domainId as string);
    res.redirect('/app/websites/' + req.website!.id + '/connection?notice=' +
      encodeURIComponent('Domain removed.'));
  }),
);

/* ------------------------------------------------- account-level pages -- */

portalRouter.get(
  '/usage',
  asyncRoute(async (req, res) => {
    res.render('portal/usage', {
      ...baseContext(req),
      title: 'Usage',
      activeTab: 'usage',
      usage: accountUsage(req.account!.id),
      history: usageHistory(req.account!.id, 12),
      subscription: getSubscription(req.account!.id),
      budget: getBudgetStatus(req.account!.id),
    });
  }),
);

portalRouter.post(
  '/usage/budget',
  requireCsrf,
  asyncRoute(async (req, res) => {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    try {
      const parsed = parseOrThrow(
        z.object({
          monthly_budget: z.coerce.number().min(0).max(1_000_000),
          alert_percent: z.coerce.number().int().min(1).max(100),
        }),
        raw,
      );
      setBudget(req.account!.id, parsed.monthly_budget, parsed.alert_percent, req.user!.id);
      res.redirect('/app/usage?notice=' + encodeURIComponent('Monthly AI budget saved.'));
    } catch (err) {
      const message = err instanceof AppError ? err.publicMessage : 'Could not save that budget.';
      res.redirect('/app/usage?error=' + encodeURIComponent(message));
    }
  }),
);

portalRouter.get(
  '/billing',
  asyncRoute(async (req, res) => {
    res.render('portal/billing', {
      ...baseContext(req),
      title: 'Billing',
      activeTab: 'billing',
      subscription: getSubscription(req.account!.id),
      plans: listPlans(),
      usage: accountUsage(req.account!.id),
    });
  }),
);

portalRouter.get(
  '/account',
  asyncRoute(async (req, res) => {
    res.render('portal/account', {
      ...baseContext(req),
      title: 'Account',
      activeTab: 'account',
      memberships: listAccountsForUser(req.user!.id),
      notifications: listNotifications(req.account!.id, 20),
    });
  }),
);

portalRouter.post(
  '/account',
  requireCsrf,
  asyncRoute(async (req, res) => {
    const raw = (req.body ?? {}) as Record<string, unknown>;
    updateAccount(req.account!.id, {
      name: raw.name === undefined ? undefined : String(raw.name),
      billingEmail: raw.billing_email === undefined ? undefined : String(raw.billing_email),
    });
    res.redirect('/app/account?notice=' + encodeURIComponent('Account details saved.'));
  }),
);

portalRouter.get(
  '/support',
  asyncRoute(async (req, res) => {
    res.render('portal/support', {
      ...baseContext(req),
      title: 'Support',
      activeTab: 'support',
    });
  }),
);

