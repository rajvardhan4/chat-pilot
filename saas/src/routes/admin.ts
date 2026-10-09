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
import { col, nowIso } from '../db/mongo.ts';
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

/** Merges a count aggregated by a foreign key onto each row of `rows`, 0 when absent. */
function attachCounts<T extends { id: string }>(
  rows: T[],
  counts: Array<{ _id: string; c: number }>,
  field: string,
): void {
  const byId = new Map(counts.map((c) => [c._id, c.c]));
  for (const row of rows) (row as Record<string, unknown>)[field] = byId.get(row.id) ?? 0;
}

async function countBy(collection: Parameters<typeof col>[0], key: string, ids: string[]): Promise<Array<{ _id: string; c: number }>> {
  if (!ids.length) return [];
  return col(collection)
    .aggregate<{ _id: string; c: number }>([
      { $match: { [key]: { $in: ids } } },
      { $group: { _id: '$' + key, c: { $sum: 1 } } },
    ])
    .toArray();
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
      stats: await platformAnalytics(resolveRange(preset)),
    });
  }),
);
adminRouter.post('/', (_req, res) => res.redirect(303, '/admin'));

/* ------------------------------------------------------------ accounts -- */

adminRouter.get(
  '/accounts',
  asyncRoute(async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const filter: Record<string, unknown> = {};
    if (search) {
      const pattern = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: pattern, $options: 'i' } },
        { billing_email: { $regex: pattern, $options: 'i' } },
      ];
    }

    const docs = await col('accounts').find(filter).sort({ created_at: -1 }).limit(200).toArray();
    const ids = docs.map((d) => d._id);
    const planIds = [...new Set(docs.map((d) => d.plan_id).filter(Boolean))] as string[];

    const [plans, websiteCounts, memberCounts, conversationCounts] = await Promise.all([
      planIds.length ? col('plans').find({ _id: { $in: planIds as never[] } }, { projection: { name: 1 } }).toArray() : [],
      countBy('websites', 'account_id', ids),
      countBy('account_members', 'account_id', ids),
      countBy('conversations', 'account_id', ids),
    ]);
    const planNames = new Map(plans.map((p) => [p._id, p.name as string]));

    const accounts = docs.map((d) => ({ ...d, id: d._id, plan_name: d.plan_id ? planNames.get(d.plan_id as string) ?? null : null }));
    attachCounts(accounts, websiteCounts, 'website_count');
    attachCounts(accounts, memberCounts, 'member_count');
    attachCounts(accounts, conversationCounts, 'conversation_count');

    res.render('admin/accounts', {
      ...ctx(req),
      title: 'Customers',
      activeTab: 'accounts',
      accounts,
      search,
      plans: await listPlans(true),
    });
  }),
);

adminRouter.get(
  '/accounts/:accountId',
  asyncRoute(async (req, res) => {
    const accountId = req.params.accountId as string;
    const account = await getAccount(accountId);
    if (!account) throw notFound('Account not found.');

    const [memberships, websiteDocs, providerDocs, usageAgg, keyDocs] = await Promise.all([
      col('account_members').find({ account_id: accountId }).toArray(),
      col('websites').find({ account_id: accountId }).sort({ created_at: 1 }).toArray(),
      col('ai_provider_credentials')
        .find(
          { account_id: accountId },
          { projection: { website_id: 1, provider: 1, api_key_masked: 1, status: 1, status_detail: 1, last_tested_at: 1, error_count: 1 } },
        )
        .toArray(),
      col('usage_records').aggregate<Record<string, unknown>>([
        { $match: { account_id: accountId } },
        { $group: { _id: '$period', messages: { $sum: '$messages' }, tokens: { $sum: '$total_tokens' }, cost: { $sum: '$estimated_cost' } } },
        { $sort: { _id: -1 } },
        { $limit: 12 },
      ]).toArray(),
      col('site_api_credentials').find({ account_id: accountId }).sort({ created_at: -1 }).toArray(),
    ]);

    const users = memberships.length
      ? await col('users')
          .find(
            { _id: { $in: memberships.map((m) => m.user_id) as never[] } },
            { projection: { email: 1, full_name: 1, status: 1, last_login_at: 1 } },
          )
          .toArray()
      : [];
    const userById = new Map(users.map((u) => [u._id, u]));
    const members = memberships.map((m) => {
      const u = userById.get(m.user_id as string);
      return { id: u?._id, email: u?.email, full_name: u?.full_name, status: u?.status, last_login_at: u?.last_login_at, role: m.role };
    });

    const websiteIds = websiteDocs.map((w) => w._id);
    const [activeKeyCounts, documentCounts, conversationCounts] = await Promise.all([
      col('site_api_credentials').aggregate<{ _id: string; c: number }>([
        { $match: { website_id: { $in: websiteIds }, status: 'active' } },
        { $group: { _id: '$website_id', c: { $sum: 1 } } },
      ]).toArray(),
      countBy('knowledge_documents', 'website_id', websiteIds),
      countBy('conversations', 'website_id', websiteIds),
    ]);
    const websites = websiteDocs.map((d) => ({ ...d, id: d._id }));
    attachCounts(websites, activeKeyCounts, 'active_keys');
    attachCounts(websites, documentCounts, 'documents');
    attachCounts(websites, conversationCounts, 'conversations');

    const websiteNames = new Map(websiteDocs.map((w) => [w._id, w.name as string]));
    const providers = providerDocs.map((p) => ({ ...p, website_name: websiteNames.get(p.website_id as string) ?? '' }));

    const usage = usageAgg.map((r) => ({ period: r._id, messages: r.messages, tokens: r.tokens, cost: r.cost }));

    const keys = keyDocs.map((k) => ({ ...k, id: k._id, website_name: websiteNames.get(k.website_id as string) ?? '' }));

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
      plans: await listPlans(true),
      audit: await listAudit({ accountId, limit: 50 }),
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
    await setAccountStatus(req.params.accountId as string, body.status, body.reason, req.user!.id);
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
    await assignPlan(req.params.accountId as string, planId, req.user!.id);
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
    await setSubscriptionStatus(req.params.accountId as string, body.status, req.user!.id);
    res.redirect('/admin/accounts/' + req.params.accountId + '?notice=' +
      encodeURIComponent('Subscription status updated.'));
  }),
);

adminRouter.post(
  '/users/:userId/status',
  requireCsrf,
  asyncRoute(async (req, res) => {
    const status = (req.body as any)?.status === 'suspended' ? 'suspended' : 'active';
    await setUserStatus(req.params.userId as string, status, req.user!.id);
    res.redirect(req.get('referer') ?? '/admin/accounts');
  }),
);

/* ------------------------------------------------------------ websites -- */

adminRouter.get(
  '/websites',
  asyncRoute(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : 'all';
    const filter: Record<string, unknown> = status !== 'all' ? { status } : {};

    const docs = await col('websites').find(filter).sort({ created_at: -1 }).limit(300).toArray();
    const accountIds = [...new Set(docs.map((d) => d.account_id))];
    const websiteIds = docs.map((d) => d._id);

    const [accounts, activeKeyCounts, conversationCounts] = await Promise.all([
      col('accounts').find({ _id: { $in: accountIds as never[] } }, { projection: { name: 1, status: 1 } }).toArray(),
      col('site_api_credentials').aggregate<{ _id: string; c: number }>([
        { $match: { website_id: { $in: websiteIds }, status: 'active' } },
        { $group: { _id: '$website_id', c: { $sum: 1 } } },
      ]).toArray(),
      countBy('conversations', 'website_id', websiteIds),
    ]);
    const accountById = new Map(accounts.map((a) => [a._id, a]));

    const websites = docs.map((d) => ({
      ...d, id: d._id,
      account_name: accountById.get(d.account_id as string)?.name ?? '',
      account_status: accountById.get(d.account_id as string)?.status ?? '',
    }));
    attachCounts(websites, activeKeyCounts, 'active_keys');
    attachCounts(websites, conversationCounts, 'conversations');

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
    await setWebsitePlatformStatus(req.params.websiteId as string, body.status, body.reason, req.user!.id);
    res.redirect(req.get('referer') ?? '/admin/websites');
  }),
);

adminRouter.post(
  '/keys/:keyId/revoke',
  requireCsrf,
  asyncRoute(async (req, res) => {
    await adminRevokeSiteKey(req.params.keyId as string, req.user!.id);
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
      plans: await listPlans(true),
      rates: await allRates(),
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
    await upsertPlan(
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
      await setRateOverrides(parsed);
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
    const credDocs = await col('ai_provider_credentials')
      .find({}, { projection: { provider: 1, status: 1, status_detail: 1, error_count: 1, last_tested_at: 1, last_failure_at: 1, website_id: 1, account_id: 1, updated_at: 1 } })
      .sort({ error_count: -1, updated_at: -1 })
      .limit(200)
      .toArray();

    const errDocs = await col('ai_requests')
      .find(
        { status: 'provider_error' },
        { projection: { created_at: 1, provider: 1, model: 1, error_label: 1, http_status: 1, website_id: 1, account_id: 1 } },
      )
      .sort({ created_at: -1 })
      .limit(100)
      .toArray();

    const websiteIds = [...new Set([...credDocs.map((d) => d.website_id), ...errDocs.map((d) => d.website_id)])];
    const accountIds = [...new Set([...credDocs.map((d) => d.account_id), ...errDocs.map((d) => d.account_id)])];
    const [websites, accounts] = await Promise.all([
      websiteIds.length ? col('websites').find({ _id: { $in: websiteIds as never[] } }, { projection: { name: 1 } }).toArray() : [],
      accountIds.length ? col('accounts').find({ _id: { $in: accountIds as never[] } }, { projection: { name: 1 } }).toArray() : [],
    ]);
    const websiteNames = new Map(websites.map((w) => [w._id, w.name as string]));
    const accountNames = new Map(accounts.map((a) => [a._id, a.name as string]));

    const providerHealth = credDocs
      .filter((d) => websiteNames.has(d.website_id as string) && accountNames.has(d.account_id as string))
      .map((d) => ({ ...d, website_name: websiteNames.get(d.website_id as string), account_name: accountNames.get(d.account_id as string) }));

    const recentErrors = errDocs
      .filter((d) => websiteNames.has(d.website_id as string) && accountNames.has(d.account_id as string))
      .map((d) => ({ ...d, website_name: websiteNames.get(d.website_id as string), account_name: accountNames.get(d.account_id as string) }));

    const logs = await col('system_logs')
      .find({ level: { $in: ['error', 'warn'] } })
      .sort({ created_at: -1 })
      .limit(100)
      .toArray();

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
    // .distinct() is not part of the MongoDB Stable API (v1) this client is
    // pinned to (see mongo.ts) and is rejected outright under apiStrict, so
    // the distinct list of actions is built with $group instead.
    const actionDocs = await col('audit_logs')
      .aggregate<{ _id: string }>([{ $group: { _id: '$action' } }])
      .toArray();
    res.render('admin/audit', {
      ...ctx(req),
      title: 'Audit Log',
      activeTab: 'audit',
      entries: await listAudit({ action: action || undefined, limit: 200 }),
      action,
      actions: actionDocs.map((d) => d._id).sort(),
    });
  }),
);
