/**
 * Analytics.
 *
 * Every query is parameterised by account_id (and website_id where relevant).
 * There is no analytics function in this module that can aggregate across
 * tenants except the explicitly named `platformAnalytics`, which is reachable
 * only from super-admin routes.
 */
import { col } from '../db/mongo.ts';

export interface DateRange {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
}

export function resolveRange(preset: string, from?: string, to?: string): DateRange {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const daysAgo = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return iso(d);
  };
  switch (preset) {
    case 'today':
      return { start: iso(today), end: iso(today) };
    case '7days':
      return { start: daysAgo(6), end: iso(today) };
    case '90days':
      return { start: daysAgo(89), end: iso(today) };
    case 'custom':
      return { start: from || daysAgo(29), end: to || iso(today) };
    case '30days':
    default:
      return { start: daysAgo(29), end: iso(today) };
  }
}

export interface WebsiteAnalytics {
  range: DateRange;
  conversations: number;
  activeConversations: number;
  leads: number;
  visitors: number;
  aiRequests: number;
  successfulRequests: number;
  fallbackRequests: number;
  providerErrors: number;
  retrievalHitRate: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  avgLatencyMs: number;
  byModel: Array<{ provider: string; model: string; requests: number; tokens: number; cost: number }>;
  bySource: Array<{ source: string; conversations: number }>;
  trend: Array<{ date: string; conversations: number; aiRequests: number; tokens: number; cost: number }>;
  topErrors: Array<{ errorLabel: string; count: number }>;
}

export async function websiteAnalytics(
  accountId: string,
  websiteId: string,
  range: DateRange,
): Promise<WebsiteAnalytics> {
  const from = range.start + ' 00:00:00';
  const to = range.end + ' 23:59:59';
  const between = { $gte: from, $lte: to };
  const scope = { account_id: accountId, website_id: websiteId };

  const [convAgg, leads, visitors, aiAgg, byModelAgg, bySourceAgg, trendAgg, convTrendAgg, topErrorsAgg] = await Promise.all([
    col('conversations').aggregate<Record<string, number>>([
      { $match: { ...scope, created_at: between } },
      { $group: { _id: null, total: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } } } },
    ]).toArray(),
    col('form_submissions').countDocuments({ ...scope, created_at: between }),
    col('visitors').countDocuments({ ...scope, first_seen_at: between }),
    col('ai_requests').aggregate<Record<string, number>>([
      { $match: { ...scope, created_at: between } },
      {
        $group: {
          _id: null,
          requests: { $sum: 1 },
          successes: { $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] } },
          fallbacks: { $sum: { $cond: [{ $eq: ['$status', 'fallback'] }, 1, 0] } },
          errors: { $sum: { $cond: [{ $eq: ['$status', 'provider_error'] }, 1, 0] } },
          hits: { $sum: '$retrieval_hit' },
          input_tokens: { $sum: '$input_tokens' },
          output_tokens: { $sum: '$output_tokens' },
          total_tokens: { $sum: '$total_tokens' },
          cost: { $sum: '$estimated_cost' },
          latency: { $avg: '$latency_ms' },
        },
      },
    ]).toArray(),
    col('ai_requests').aggregate<Record<string, unknown>>([
      { $match: { ...scope, created_at: between, model: { $ne: '' } } },
      { $group: { _id: { provider: '$provider', model: '$model' }, requests: { $sum: 1 }, tokens: { $sum: '$total_tokens' }, cost: { $sum: '$estimated_cost' } } },
      { $sort: { requests: -1 } },
    ]).toArray(),
    col('conversations').aggregate<Record<string, unknown>>([
      { $match: { ...scope, created_at: between } },
      { $group: { _id: '$source', c: { $sum: 1 } } },
    ]).toArray(),
    col('ai_requests').aggregate<Record<string, unknown>>([
      { $match: { ...scope, created_at: between } },
      { $group: { _id: { $substrCP: ['$created_at', 0, 10] }, requests: { $sum: 1 }, tokens: { $sum: '$total_tokens' }, cost: { $sum: '$estimated_cost' } } },
      { $sort: { _id: 1 } },
    ]).toArray(),
    col('conversations').aggregate<{ _id: string; c: number }>([
      { $match: { ...scope, created_at: between } },
      { $group: { _id: { $substrCP: ['$created_at', 0, 10] }, c: { $sum: 1 } } },
    ]).toArray(),
    col('ai_requests').aggregate<Record<string, unknown>>([
      { $match: { ...scope, created_at: between, status: 'provider_error', error_label: { $ne: '' } } },
      { $group: { _id: '$error_label', c: { $sum: 1 } } },
      { $sort: { c: -1 } },
      { $limit: 5 },
    ]).toArray(),
  ]);

  const conv = convAgg[0];
  const ai = aiAgg[0];

  const byModel = byModelAgg.map((r) => {
    const id = r._id as { provider: string; model: string };
    return { provider: id.provider, model: id.model, requests: Number(r.requests), tokens: Number(r.tokens), cost: Number(r.cost) };
  });
  const bySource = bySourceAgg.map((r) => ({ source: String(r._id), conversations: Number(r.c) }));

  const trend = trendAgg.map((r) => ({
    date: String(r._id), conversations: 0,
    aiRequests: Number(r.requests), tokens: Number(r.tokens), cost: Number(r.cost),
  }));
  const convByDay = new Map(convTrendAgg.map((r) => [r._id, r.c]));
  for (const point of trend) point.conversations = convByDay.get(point.date) ?? 0;

  const topErrors = topErrorsAgg.map((r) => ({ errorLabel: String(r._id), count: Number(r.c) }));

  const requests = Number(ai?.requests ?? 0);
  return {
    range,
    conversations: Number(conv?.total ?? 0),
    activeConversations: Number(conv?.active ?? 0),
    leads,
    visitors,
    aiRequests: requests,
    successfulRequests: Number(ai?.successes ?? 0),
    fallbackRequests: Number(ai?.fallbacks ?? 0),
    providerErrors: Number(ai?.errors ?? 0),
    retrievalHitRate: requests ? Number(((Number(ai?.hits ?? 0) / requests) * 100).toFixed(1)) : 0,
    inputTokens: Number(ai?.input_tokens ?? 0),
    outputTokens: Number(ai?.output_tokens ?? 0),
    totalTokens: Number(ai?.total_tokens ?? 0),
    estimatedCost: Number(Number(ai?.cost ?? 0).toFixed(4)),
    avgLatencyMs: Math.round(Number(ai?.latency ?? 0)),
    byModel,
    bySource,
    trend,
    topErrors,
  };
}

/** Account-wide rollup across the account's own websites only. */
export async function accountAnalytics(accountId: string, range: DateRange) {
  const from = range.start + ' 00:00:00';
  const to = range.end + ' 23:59:59';
  const between = { $gte: from, $lte: to };

  const [totalsAgg, conversations, leads, websites] = await Promise.all([
    col('ai_requests').aggregate<Record<string, number>>([
      { $match: { account_id: accountId, created_at: between } },
      {
        $group: {
          _id: null, requests: { $sum: 1 }, tokens: { $sum: '$total_tokens' }, cost: { $sum: '$estimated_cost' },
          errors: { $sum: { $cond: [{ $eq: ['$status', 'provider_error'] }, 1, 0] } },
        },
      },
    ]).toArray(),
    col('conversations').countDocuments({ account_id: accountId, created_at: between }),
    col('form_submissions').countDocuments({ account_id: accountId, created_at: between }),
    col('websites').find({ account_id: accountId }).sort({ created_at: 1 }).toArray(),
  ]);
  const totals = totalsAgg[0];

  const perWebsite = await Promise.all(
    websites.map(async (w) => {
      const [convCount, leadCount, sums] = await Promise.all([
        col('conversations').countDocuments({ website_id: w._id, created_at: between }),
        col('form_submissions').countDocuments({ website_id: w._id, created_at: between }),
        col('ai_requests').aggregate<{ tokens: number; cost: number }>([
          { $match: { website_id: w._id, created_at: between } },
          { $group: { _id: null, tokens: { $sum: '$total_tokens' }, cost: { $sum: '$estimated_cost' } } },
        ]).toArray(),
      ]);
      return {
        id: String(w._id), name: String(w.name), domain: String(w.primary_domain),
        status: String(w.status), conversations: convCount,
        leads: leadCount, tokens: Number(sums[0]?.tokens ?? 0), cost: Number(Number(sums[0]?.cost ?? 0).toFixed(4)),
      };
    }),
  );

  return {
    range,
    conversations,
    leads,
    aiRequests: Number(totals?.requests ?? 0),
    totalTokens: Number(totals?.tokens ?? 0),
    estimatedCost: Number(Number(totals?.cost ?? 0).toFixed(4)),
    providerErrors: Number(totals?.errors ?? 0),
    websites: perWebsite,
  };
}

/** Super-admin only. The single cross-tenant aggregation in the codebase. */
export async function platformAnalytics(range: DateRange) {
  const from = range.start + ' 00:00:00';
  const to = range.end + ' 23:59:59';
  const between = { $gte: from, $lte: to };

  const [
    customers, accounts, suspendedAccounts, websites, activeWebsites, inactiveWebsites, suspendedWebsites,
    activeKeys, revokedKeys, periodAgg, conversations, leads, providerHealthAgg, accountList, requestsInRange, recentErrorRows,
  ] = await Promise.all([
    col('users').countDocuments({ platform_role: 'user' }),
    col('accounts').countDocuments({}),
    col('accounts').countDocuments({ status: 'suspended' }),
    col('websites').countDocuments({}),
    col('websites').countDocuments({ status: 'active' }),
    col('websites').countDocuments({ status: 'inactive' }),
    col('websites').countDocuments({ status: 'suspended' }),
    col('site_api_credentials').countDocuments({ status: 'active' }),
    col('site_api_credentials').countDocuments({ status: 'revoked' }),
    col('ai_requests').aggregate<Record<string, number>>([
      { $match: { created_at: between } },
      {
        $group: {
          _id: null, requests: { $sum: 1 }, tokens: { $sum: '$total_tokens' }, cost: { $sum: '$estimated_cost' },
          errors: { $sum: { $cond: [{ $eq: ['$status', 'provider_error'] }, 1, 0] } },
          fallbacks: { $sum: { $cond: [{ $eq: ['$status', 'fallback'] }, 1, 0] } },
        },
      },
    ]).toArray(),
    col('conversations').countDocuments({ created_at: between }),
    col('form_submissions').countDocuments({ created_at: between }),
    col('ai_provider_credentials').aggregate<Record<string, unknown>>([
      { $group: { _id: { provider: '$provider', status: '$status' }, c: { $sum: 1 } } },
    ]).toArray(),
    col('accounts').find({}, { projection: { name: 1, status: 1 } }).toArray(),
    col('ai_requests').aggregate<{ _id: string; requests: number; tokens: number; cost: number }>([
      { $match: { created_at: between } },
      { $group: { _id: '$account_id', requests: { $sum: 1 }, tokens: { $sum: '$total_tokens' }, cost: { $sum: '$estimated_cost' } } },
    ]).toArray(),
    col('ai_requests')
      .find({ status: 'provider_error' })
      .sort({ created_at: -1 })
      .limit(20)
      .toArray(),
  ]);

  const period = periodAgg[0];

  const providerHealth = providerHealthAgg.map((r) => {
    const id = r._id as { provider: string; status: string };
    return { provider: id.provider, status: id.status, count: Number(r.c) };
  });

  // The old query was a LEFT JOIN: every account appears, zero-request ones
  // included, ranked by request volume.
  const requestsByAccount = new Map(requestsInRange.map((r) => [r._id, r]));
  const topAccounts = accountList
    .map((a) => {
      const r = requestsByAccount.get(a._id);
      return {
        id: String(a._id), name: String(a.name), status: String(a.status),
        requests: Number(r?.requests ?? 0), tokens: Number(r?.tokens ?? 0),
        cost: Number(Number(r?.cost ?? 0).toFixed(4)),
      };
    })
    .sort((a, b) => b.requests - a.requests)
    .slice(0, 10);

  // The old query was an INNER JOIN on both websites and accounts: a row
  // whose website or account no longer exists is silently dropped, not shown
  // with a blank name.
  const websiteIds = [...new Set(recentErrorRows.map((r) => r.website_id as string))];
  const accountIds = [...new Set(recentErrorRows.map((r) => r.account_id as string))];
  const [websiteDocs, accountDocs] = await Promise.all([
    websiteIds.length
      ? col('websites').find({ _id: { $in: websiteIds as never[] } }, { projection: { name: 1 } }).toArray()
      : [],
    accountIds.length
      ? col('accounts').find({ _id: { $in: accountIds as never[] } }, { projection: { name: 1 } }).toArray()
      : [],
  ]);
  const websiteNames = new Map(websiteDocs.map((w) => [w._id, w.name as string]));
  const accountNames = new Map(accountDocs.map((a) => [a._id, a.name as string]));

  const recentErrors = recentErrorRows
    .filter((r) => websiteNames.has(r.website_id as string) && accountNames.has(r.account_id as string))
    .map((r) => ({
      createdAt: String(r.created_at), provider: String(r.provider), model: String(r.model),
      errorLabel: String(r.error_label),
      website: String(websiteNames.get(r.website_id as string)),
      account: String(accountNames.get(r.account_id as string)),
    }));

  return {
    range,
    customers,
    accounts,
    suspendedAccounts,
    websites,
    activeWebsites,
    inactiveWebsites,
    suspendedWebsites,
    activeKeys,
    revokedKeys,
    conversations,
    leads,
    aiRequests: Number(period?.requests ?? 0),
    totalTokens: Number(period?.tokens ?? 0),
    estimatedCost: Number(Number(period?.cost ?? 0).toFixed(4)),
    providerErrors: Number(period?.errors ?? 0),
    fallbacks: Number(period?.fallbacks ?? 0),
    providerHealth,
    topAccounts,
    recentErrors,
  };
}

export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0] as Record<string, unknown>);
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
  ].join('\n');
}
