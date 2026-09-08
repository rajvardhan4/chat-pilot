/**
 * Master Admin (super admin) console.
 *
 * Platform-wide visibility and control. Two rules are enforced throughout:
 *   - No customer AI provider secret is ever decrypted or displayed here.
 *     Only masked hints and connection status are shown.
 *   - Every administrative action is written to audit_logs.
 */
import { Router } from 'express';
import { z } from 'zod';
import { db, nowIso } from '../db/index.ts';
import { parseOrThrow } from '../core/validate.ts';
import { badRequest, notFound } from '../core/errors.ts';
import { asyncRoute } from '../middleware/errors.ts';
import { requireCsrf, requireSuperAdmin } from '../middleware/session.ts';
import { platformAnalytics, resolveRange } from '../services/analytics.ts';
import { listAudit } from '../services/audit.ts';
import { setAccountStatus, setUserStatus, getAccount } from '../services/accounts.ts';
import { setWebsitePlatformStatus } from '../services/websites.ts';
import { adminRevokeSiteKey } from '../services/siteKeys.ts';
import { assignPlan, listPlans, setSubscriptionStatus, upsertPlan } from '../services/plans.ts';
import { allRates, setRateOverrides } from '../services/pricing.ts';

export const adminRouter: Router = Router();

adminRouter.use(requireSuperAdmin);

function ctx(req: any) {
  return {
    user: req.user,
    csrfToken: req.csrfToken,
    notice: typeof req.query.notice === 'string' ? req.query.notice : '',
    error: typeof req.query.error === 'string' ? req.query.error : '',
  };
}

/* ----------------------------------------------------------- dashboard -- */

adminRouter.get(
  '/',
  asyncRoute(async (req, res) => {
    const preset = typeof req.query.range === 'string' ? req.query.range : '30days';
    res.render('admin/dashboard', {
      ...ctx(req),
      title: 'Platform Dashboard',
      activeTab: 'dashboard',
      preset,
      stats: platformAnalytics(resolveRange(preset)),
    });
  }),
);

/* ------------------------------------------------------------ accounts -- */

adminRouter.get(
  '/accounts',
  asyncRoute(async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const where = search ? 'WHERE a.name LIKE ? OR a.billing_email LIKE ?' : '';
    const params: unknown[] = search ? ['%' + search + '%', '%' + search + '%'] : [];

    const accounts = db.all<Record<string, unknown>>(
      `SELECT a.*, p.name AS plan_name,
              (SELECT COUNT(*) FROM websites w WHERE w.account_id = a.id) AS website_count,
              (SELECT COUNT(*) FROM account_members m WHERE m.account_id = a.id) AS member_count,
              (SELECT COUNT(*) FROM conversations c WHERE c.account_id = a.id) AS conversation_count
         FROM accounts a LEFT JOIN plans p ON p.id = a.plan_id
         ${where}
        ORDER BY a.created_at DESC LIMIT 200`,
      ...params,
    );

    res.render('admin/accounts', {
      ...ctx(req),
      title: 'Customers',
      activeTab: 'accounts',
      accounts,
      search,
      plans: listPlans(true),
    });
  }),
);

adminRouter.get(
  '/accounts/:accountId',
  asyncRoute(async (req, res) => {
    const accountId = req.params.accountId as string;
    const account = getAccount(accountId);
    if (!account) throw notFound('Account not found.');

    const members = db.all<Record<string, unknown>>(
      `SELECT u.id, u.email, u.full_name, u.status, u.last_login_at, m.role
         FROM account_members m JOIN users u ON u.id = m.user_id
        WHERE m.account_id = ?`,
      accountId,
    );

    const websites = db.all<Record<string, unknown>>(
      `SELECT w.*,
              (SELECT COUNT(*) FROM site_api_credentials k WHERE k.website_id = w.id AND k.status = 'active') AS active_keys,
              (SELECT COUNT(*) FROM knowledge_documents d WHERE d.website_id = w.id) AS documents,
              (SELECT COUNT(*) FROM conversations c WHERE c.website_id = w.id) AS conversations
         FROM websites w WHERE w.account_id = ? ORDER BY w.created_at ASC`,
      accountId,
    );

    // Masked only - the encrypted key is never read on this path.
    const providers = db.all<Record<string, unknown>>(
      `SELECT c.website_id, c.provider, c.api_key_masked, c.status, c.status_detail,
              c.last_tested_at, c.error_count, w.name AS website_name
         FROM ai_provider_credentials c JOIN websites w ON w.id = c.website_id
        WHERE c.account_id = ?`,
      accountId,
    );

    const usage = db.all<Record<string, unknown>>(
      `SELECT period, SUM(messages) AS messages, SUM(total_tokens) AS tokens,
              SUM(estimated_cost) AS cost
         FROM usage_records WHERE account_id = ? GROUP BY period ORDER BY period DESC LIMIT 12`,
      accountId,
    );

    const keys = db.all<Record<string, unknown>>(
      `SELECT k.*, w.name AS website_name FROM site_api_credentials k
         JOIN websites w ON w.id = k.website_id
        WHERE k.account_id = ? ORDER BY k.created_at DESC`,
      accountId,
    );

    res.render('admin/account-detail', {
      ...ctx(req),
      title: account.name,
      activeTab: 'accounts',
      account,
      members,
      websites,
      providers,
      usage,
      keys,
      plans: listPlans(true),
      audit: listAudit({ accountId, limit: 50 }),
    });
  }),
);

adminRouter.post(
  '/accounts/:accountId/status',
  requireCsrf,
  asyncRoute(async (req, res) => {
    const body = parseOrThrow(
      z.object({
        status: z.enum(['active', 'suspended', 'closed']),
        reason: z.string().trim().max(300).optional().default(''),
      }),
      req.body ?? {},
    );
    setAccountStatus(req.params.accountId as string, body.status, body.reason, req.user!.id);
    res.redirect('/admin/accounts/' + req.params.accountId + '?notice=' +
      encodeURIComponent('Account status updated.'));
  }),
);

adminRouter.post(
  '/accounts/:accountId/plan',
  requireCsrf,
  asyncRoute(async (req, res) => {
    const planId = String((req.body as any)?.plan_id ?? '');
    if (!planId) throw badRequest('Choose a plan.');
    assignPlan(req.params.accountId as string, planId, req.user!.id);
    res.redirect('/admin/accounts/' + req.params.accountId + '?notice=' + encodeURIComponent('Plan updated.'));
  }),
);

adminRouter.post(
  '/accounts/:accountId/subscription',
  requireCsrf,
  asyncRoute(async (req, res) => {
    const body = parseOrThrow(
      z.object({ status: z.enum(['active', 'trialing', 'past_due', 'canceled']) }),
      req.body ?? {},
    );
    setSubscriptionStatus(req.params.accountId as string, body.status, req.user!.id);
    res.redirect('/admin/accounts/' + req.params.accountId + '?notice=' +
      encodeURIComponent('Subscription status updated.'));
  }),
);

adminRouter.post(
  '/users/:userId/status',
  requireCsrf,
  asyncRoute(async (req, res) => {
    const status = (req.body as any)?.status === 'suspended' ? 'suspended' : 'active';
    setUserStatus(req.params.userId as string, status, req.user!.id);
    res.redirect(req.get('referer') ?? '/admin/accounts');
  }),
);

/* ------------------------------------------------------------ websites -- */

adminRouter.get(
  '/websites',
  asyncRoute(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : 'all';
    const where = status !== 'all' ? 'WHERE w.status = ?' : '';
    const params: unknown[] = status !== 'all' ? [status] : [];

    const websites = db.all<Record<string, unknown>>(
      `SELECT w.*, a.name AS account_name, a.status AS account_status,
              (SELECT COUNT(*) FROM site_api_credentials k WHERE k.website_id = w.id AND k.status = 'active') AS active_keys,
              (SELECT COUNT(*) FROM conversations c WHERE c.website_id = w.id) AS conversations
         FROM websites w JOIN accounts a ON a.id = w.account_id
         ${where}
        ORDER BY w.created_at DESC LIMIT 300`,
      ...params,
    );

    res.render('admin/websites', {
      ...ctx(req),
      title: 'Websites',
      activeTab: 'websites',
      websites,
      status,
    });
  }),
);

adminRouter.post(
  '/websites/:websiteId/status',
  requireCsrf,
  asyncRoute(async (req, res) => {
    const body = parseOrThrow(
      z.object({
        status: z.enum(['active', 'suspended']),
        reason: z.string().trim().max(300).optional().default(''),
      }),
      req.body ?? {},
    );
    setWebsitePlatformStatus(req.params.websiteId as string, body.status, body.reason, req.user!.id);
    res.redirect(req.get('referer') ?? '/admin/websites');
  }),
);

adminRouter.post(
  '/keys/:keyId/revoke',
  requireCsrf,
  asyncRoute(async (req, res) => {
    adminRevokeSiteKey(req.params.keyId as string, req.user!.id);
    res.redirect(req.get('referer') ?? '/admin/websites');
  }),
);

/* --------------------------------------------------------------- plans -- */

adminRouter.get(
  '/plans',
  asyncRoute(async (req, res) => {
    res.render('admin/plans', {
      ...ctx(req),
      title: 'Plans',
      activeTab: 'plans',
      plans: listPlans(true),
      rates: allRates(),
    });
  }),
);

adminRouter.post(
  '/plans',
  requireCsrf,
  asyncRoute(async (req, res) => {
    const body = parseOrThrow(
      z.object({
        name: z.string().trim().min(2).max(60),
        slug: z.string().trim().min(2).max(40).regex(/^[a-z0-9-]+$/, 'Use lowercase letters, digits and dashes.'),
        price_cents: z.coerce.number().int().min(0).max(10_000_00),
        max_websites: z.coerce.number().int().min(0).max(10_000),
        max_documents: z.coerce.number().int().min(0).max(1_000_000),
        max_messages_month: z.coerce.number().int().min(0).max(10_000_000),
        max_storage_mb: z.coerce.number().int().min(0).max(1_000_000),
        is_active: z.coerce.boolean().optional().default(true),
      }),
      req.body ?? {},
    );
    upsertPlan(
      {
        name: body.name, slug: body.slug, priceCents: body.price_cents,
        maxWebsites: body.max_websites, maxDocuments: body.max_documents,
        maxMessagesMonth: body.max_messages_month, maxStorageMb: body.max_storage_mb,
        isActive: body.is_active,
      },
      req.user!.id,
    );
    res.redirect('/admin/plans?notice=' + encodeURIComponent('Plan saved.'));
  }),
);

adminRouter.post(
  '/pricing',
  requireCsrf,
  asyncRoute(async (req, res) => {
    const raw = String((req.body as any)?.rates ?? '{}');
    try {
      const parsed = JSON.parse(raw) as Record<string, { input: number; output: number }>;
      for (const [model, rate] of Object.entries(parsed)) {
        if (typeof rate?.input !== 'number' || typeof rate?.output !== 'number') {
          throw new Error('bad rate for ' + model);
        }
      }
      setRateOverrides(parsed);
      res.redirect('/admin/plans?notice=' + encodeURIComponent('Model pricing updated.'));
    } catch {
      res.redirect('/admin/plans?error=' + encodeURIComponent('That pricing JSON could not be parsed.'));
    }
  }),
);

/* --------------------------------------------------- health / providers -- */

adminRouter.get(
  '/health',
  asyncRoute(async (req, res) => {
    const providerHealth = db.all<Record<string, unknown>>(
      `SELECT c.provider, c.status, c.status_detail, c.error_count, c.last_tested_at,
              c.last_failure_at, w.name AS website_name, a.name AS account_name
         FROM ai_provider_credentials c
         JOIN websites w ON w.id = c.website_id
         JOIN accounts a ON a.id = c.account_id
        ORDER BY c.error_count DESC, c.updated_at DESC LIMIT 200`,
    );

    const recentErrors = db.all<Record<string, unknown>>(
      `SELECT r.created_at, r.provider, r.model, r.error_label, r.http_status,
              w.name AS website_name, a.name AS account_name
         FROM ai_requests r JOIN websites w ON w.id = r.website_id JOIN accounts a ON a.id = r.account_id
        WHERE r.status = 'provider_error' ORDER BY r.created_at DESC LIMIT 100`,
    );

    const logs = db.all<Record<string, unknown>>(
      "SELECT * FROM system_logs WHERE level IN ('error','warn') ORDER BY created_at DESC LIMIT 100",
    );

    res.render('admin/health', {
      ...ctx(req),
      title: 'System Health',
      activeTab: 'health',
      providerHealth,
      recentErrors,
      logs,
      serverTime: nowIso(),
    });
  }),
);

/* ----------------------------------------------------------- audit log -- */

adminRouter.get(
  '/audit',
  asyncRoute(async (req, res) => {
    const action = typeof req.query.action === 'string' ? req.query.action : '';
    res.render('admin/audit', {
      ...ctx(req),
      title: 'Audit Log',
      activeTab: 'audit',
      entries: listAudit({ action: action || undefined, limit: 200 }),
      action,
      actions: db.all<{ action: string }>(
        'SELECT DISTINCT action FROM audit_logs ORDER BY action',
      ).map((r) => r.action),
    });
  }),
);
