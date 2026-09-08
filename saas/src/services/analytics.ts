/**
 * Analytics.
 *
 * Every query is parameterised by account_id (and website_id where relevant).
 * There is no analytics function in this module that can aggregate across
 * tenants except the explicitly named `platformAnalytics`, which is reachable
 * only from super-admin routes.
 */
import { db } from '../db/index.ts';

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

export function websiteAnalytics(
  accountId: string,
  websiteId: string,
  range: DateRange,
): WebsiteAnalytics {
  const from = range.start + ' 00:00:00';
  const to = range.end + ' 23:59:59';

  const conv = db.get<Record<string, number>>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active
       FROM conversations
      WHERE account_id = ? AND website_id = ? AND created_at BETWEEN ? AND ?`,
    accountId, websiteId, from, to,
  );

  const leads = db.scalar<number>(
    `SELECT COUNT(*) AS c FROM form_submissions
      WHERE account_id = ? AND website_id = ? AND created_at BETWEEN ? AND ?`,
    accountId, websiteId, from, to,
  ) ?? 0;

  const visitors = db.scalar<number>(
    `SELECT COUNT(*) AS c FROM visitors
      WHERE account_id = ? AND website_id = ? AND first_seen_at BETWEEN ? AND ?`,
    accountId, websiteId, from, to,
  ) ?? 0;

  const ai = db.get<Record<string, number>>(
    `SELECT COUNT(*) AS requests,
            SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successes,
            SUM(CASE WHEN status = 'fallback' THEN 1 ELSE 0 END) AS fallbacks,
            SUM(CASE WHEN status = 'provider_error' THEN 1 ELSE 0 END) AS errors,
            SUM(retrieval_hit) AS hits,
            COALESCE(SUM(input_tokens),0) AS input_tokens,
            COALESCE(SUM(output_tokens),0) AS output_tokens,
            COALESCE(SUM(total_tokens),0) AS total_tokens,
            COALESCE(SUM(estimated_cost),0) AS cost,
            COALESCE(AVG(latency_ms),0) AS latency
       FROM ai_requests
      WHERE account_id = ? AND website_id = ? AND created_at BETWEEN ? AND ?`,
    accountId, websiteId, from, to,
  );

  const byModel = db
    .all<Record<string, unknown>>(
      `SELECT provider, model, COUNT(*) AS requests,
              COALESCE(SUM(total_tokens),0) AS tokens, COALESCE(SUM(estimated_cost),0) AS cost
         FROM ai_requests
        WHERE account_id = ? AND website_id = ? AND created_at BETWEEN ? AND ? AND model <> ''
        GROUP BY provider, model ORDER BY requests DESC`,
      accountId, websiteId, from, to,
    )
    .map((r) => ({
      provider: String(r.provider), model: String(r.model),
      requests: Number(r.requests), tokens: Number(r.tokens), cost: Number(r.cost),
    }));

  const bySource = db
    .all<Record<string, unknown>>(
      `SELECT source, COUNT(*) AS c FROM conversations
        WHERE account_id = ? AND website_id = ? AND created_at BETWEEN ? AND ?
        GROUP BY source`,
      accountId, websiteId, from, to,
    )
    .map((r) => ({ source: String(r.source), conversations: Number(r.c) }));

  const trend = db
    .all<Record<string, unknown>>(
      `SELECT substr(created_at, 1, 10) AS d,
              COUNT(*) AS requests,
              COALESCE(SUM(total_tokens),0) AS tokens,
              COALESCE(SUM(estimated_cost),0) AS cost
         FROM ai_requests
        WHERE account_id = ? AND website_id = ? AND created_at BETWEEN ? AND ?
        GROUP BY d ORDER BY d ASC`,
      accountId, websiteId, from, to,
    )
    .map((r) => ({
      date: String(r.d), conversations: 0,
      aiRequests: Number(r.requests), tokens: Number(r.tokens), cost: Number(r.cost),
    }));

  const convTrend = db.all<Record<string, unknown>>(
    `SELECT substr(created_at, 1, 10) AS d, COUNT(*) AS c FROM conversations
      WHERE account_id = ? AND website_id = ? AND created_at BETWEEN ? AND ?
      GROUP BY d`,
    accountId, websiteId, from, to,
  );
  const convByDay = new Map(convTrend.map((r) => [String(r.d), Number(r.c)]));
  for (const point of trend) point.conversations = convByDay.get(point.date) ?? 0;

  const topErrors = db
    .all<Record<string, unknown>>(
      `SELECT error_label AS label, COUNT(*) AS c FROM ai_requests
        WHERE account_id = ? AND website_id = ? AND created_at BETWEEN ? AND ?
          AND status = 'provider_error' AND error_label <> ''
        GROUP BY error_label ORDER BY c DESC LIMIT 5`,
      accountId, websiteId, from, to,
    )
    .map((r) => ({ errorLabel: String(r.label), count: Number(r.c) }));

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
export function accountAnalytics(accountId: string, range: DateRange) {
  const from = range.start + ' 00:00:00';
  const to = range.end + ' 23:59:59';

  const totals = db.get<Record<string, number>>(
    `SELECT COUNT(*) AS requests,
            COALESCE(SUM(total_tokens),0) AS tokens,
            COALESCE(SUM(estimated_cost),0) AS cost,
            SUM(CASE WHEN status = 'provider_error' THEN 1 ELSE 0 END) AS errors
       FROM ai_requests WHERE account_id = ? AND created_at BETWEEN ? AND ?`,
    accountId, from, to,
  );

  const conversations = db.scalar<number>(
    'SELECT COUNT(*) AS c FROM conversations WHERE account_id = ? AND created_at BETWEEN ? AND ?',
    accountId, from, to,
  ) ?? 0;

  const leads = db.scalar<number>(
    'SELECT COUNT(*) AS c FROM form_submissions WHERE account_id = ? AND created_at BETWEEN ? AND ?',
    accountId, from, to,
  ) ?? 0;

  const perWebsite = db
    .all<Record<string, unknown>>(
      `SELECT w.id, w.name, w.primary_domain, w.status,
              (SELECT COUNT(*) FROM conversations c
                WHERE c.website_id = w.id AND c.created_at BETWEEN ? AND ?) AS conversations,
              (SELECT COUNT(*) FROM form_submissions f
                WHERE f.website_id = w.id AND f.created_at BETWEEN ? AND ?) AS leads,
              (SELECT COALESCE(SUM(total_tokens),0) FROM ai_requests a
                WHERE a.website_id = w.id AND a.created_at BETWEEN ? AND ?) AS tokens,
              (SELECT COALESCE(SUM(estimated_cost),0) FROM ai_requests a
                WHERE a.website_id = w.id AND a.created_at BETWEEN ? AND ?) AS cost
         FROM websites w WHERE w.account_id = ? ORDER BY w.created_at ASC`,
      from, to, from, to, from, to, from, to, accountId,
    )
    .map((r) => ({
      id: String(r.id), name: String(r.name), domain: String(r.primary_domain),
      status: String(r.status), conversations: Number(r.conversations),
      leads: Number(r.leads), tokens: Number(r.tokens), cost: Number(Number(r.cost).toFixed(4)),
    }));

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
export function platformAnalytics(range: DateRange) {
  const from = range.start + ' 00:00:00';
  const to = range.end + ' 23:59:59';

  const counts = db.get<Record<string, number>>(
    `SELECT
       (SELECT COUNT(*) FROM users WHERE platform_role = 'user') AS customers,
       (SELECT COUNT(*) FROM accounts) AS accounts,
       (SELECT COUNT(*) FROM accounts WHERE status = 'suspended') AS suspended_accounts,
       (SELECT COUNT(*) FROM websites) AS websites,
       (SELECT COUNT(*) FROM websites WHERE status = 'active') AS active_websites,
       (SELECT COUNT(*) FROM websites WHERE status = 'inactive') AS inactive_websites,
       (SELECT COUNT(*) FROM websites WHERE status = 'suspended') AS suspended_websites,
       (SELECT COUNT(*) FROM site_api_credentials WHERE status = 'active') AS active_keys,
       (SELECT COUNT(*) FROM site_api_credentials WHERE status = 'revoked') AS revoked_keys`,
  );

  const period = db.get<Record<string, number>>(
    `SELECT COUNT(*) AS requests,
            COALESCE(SUM(total_tokens),0) AS tokens,
            COALESCE(SUM(estimated_cost),0) AS cost,
            SUM(CASE WHEN status = 'provider_error' THEN 1 ELSE 0 END) AS errors,
            SUM(CASE WHEN status = 'fallback' THEN 1 ELSE 0 END) AS fallbacks
       FROM ai_requests WHERE created_at BETWEEN ? AND ?`,
    from, to,
  );

  const conversations = db.scalar<number>(
    'SELECT COUNT(*) AS c FROM conversations WHERE created_at BETWEEN ? AND ?', from, to,
  ) ?? 0;
  const leads = db.scalar<number>(
    'SELECT COUNT(*) AS c FROM form_submissions WHERE created_at BETWEEN ? AND ?', from, to,
  ) ?? 0;

  const providerHealth = db
    .all<Record<string, unknown>>(
      `SELECT provider, status, COUNT(*) AS c FROM ai_provider_credentials GROUP BY provider, status`,
    )
    .map((r) => ({ provider: String(r.provider), status: String(r.status), count: Number(r.c) }));

  const topAccounts = db
    .all<Record<string, unknown>>(
      `SELECT a.id, a.name, a.status,
              COUNT(r.id) AS requests,
              COALESCE(SUM(r.total_tokens),0) AS tokens,
              COALESCE(SUM(r.estimated_cost),0) AS cost
         FROM accounts a LEFT JOIN ai_requests r
           ON r.account_id = a.id AND r.created_at BETWEEN ? AND ?
        GROUP BY a.id ORDER BY requests DESC LIMIT 10`,
      from, to,
    )
    .map((r) => ({
      id: String(r.id), name: String(r.name), status: String(r.status),
      requests: Number(r.requests), tokens: Number(r.tokens),
      cost: Number(Number(r.cost).toFixed(4)),
    }));

  const recentErrors = db
    .all<Record<string, unknown>>(
      `SELECT r.created_at, r.provider, r.model, r.error_label, w.name AS website, a.name AS account
         FROM ai_requests r
         JOIN websites w ON w.id = r.website_id
         JOIN accounts a ON a.id = r.account_id
        WHERE r.status = 'provider_error' ORDER BY r.created_at DESC LIMIT 20`,
    )
    .map((r) => ({
      createdAt: String(r.created_at), provider: String(r.provider), model: String(r.model),
      errorLabel: String(r.error_label), website: String(r.website), account: String(r.account),
    }));

  return {
    range,
    customers: Number(counts?.customers ?? 0),
    accounts: Number(counts?.accounts ?? 0),
    suspendedAccounts: Number(counts?.suspended_accounts ?? 0),
    websites: Number(counts?.websites ?? 0),
    activeWebsites: Number(counts?.active_websites ?? 0),
    inactiveWebsites: Number(counts?.inactive_websites ?? 0),
    suspendedWebsites: Number(counts?.suspended_websites ?? 0),
    activeKeys: Number(counts?.active_keys ?? 0),
    revokedKeys: Number(counts?.revoked_keys ?? 0),
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
