/**
 * Usage accounting and plan enforcement.
 *
 * Rolled up per (website, YYYY-MM). Plan limits are checked against the
 * account-wide total for the current period.
 */
import { db, nowIso } from '../db/index.ts';
import { AppError } from '../core/errors.ts';
import { newId } from '../core/crypto.ts';
import { planLimitFor } from './websites.ts';
import { checkBudgetThreshold } from './budget.ts';

export function currentPeriod(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

export interface UsageDelta {
  messages?: number;
  aiRequests?: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCost?: number;
}

export function recordUsage(accountId: string, websiteId: string, delta: UsageDelta): void {
  const period = currentPeriod();
  const totalTokens = (delta.inputTokens ?? 0) + (delta.outputTokens ?? 0);
  const existing = db.get<{ id: string }>(
    'SELECT id FROM usage_records WHERE website_id = ? AND period = ?',
    websiteId, period,
  );

  if (existing) {
    db.run(
      `UPDATE usage_records
          SET messages = messages + ?, ai_requests = ai_requests + ?,
              input_tokens = input_tokens + ?, output_tokens = output_tokens + ?,
              total_tokens = total_tokens + ?, estimated_cost = estimated_cost + ?,
              updated_at = ?
        WHERE id = ?`,
      delta.messages ?? 0, delta.aiRequests ?? 0,
      delta.inputTokens ?? 0, delta.outputTokens ?? 0,
      totalTokens, delta.estimatedCost ?? 0, nowIso(), existing.id,
    );
  } else {
    db.run(
      `INSERT INTO usage_records
         (id, account_id, website_id, period, messages, ai_requests, input_tokens, output_tokens,
          total_tokens, estimated_cost, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId(), accountId, websiteId, period,
      delta.messages ?? 0, delta.aiRequests ?? 0,
      delta.inputTokens ?? 0, delta.outputTokens ?? 0,
      totalTokens, delta.estimatedCost ?? 0, nowIso(),
    );
  }

  // Budget alerts are de-duplicated per period, so calling this on every
  // request is cheap and cannot produce an email storm.
  if ((delta.estimatedCost ?? 0) > 0) {
    checkBudgetThreshold(accountId);
  }
}

export interface UsageSummary {
  period: string;
  messages: number;
  aiRequests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export function accountUsage(accountId: string, period = currentPeriod()): UsageSummary {
  const row = db.get<Record<string, number>>(
    `SELECT COALESCE(SUM(messages),0) AS messages,
            COALESCE(SUM(ai_requests),0) AS ai_requests,
            COALESCE(SUM(input_tokens),0) AS input_tokens,
            COALESCE(SUM(output_tokens),0) AS output_tokens,
            COALESCE(SUM(total_tokens),0) AS total_tokens,
            COALESCE(SUM(estimated_cost),0) AS estimated_cost
       FROM usage_records WHERE account_id = ? AND period = ?`,
    accountId, period,
  );
  return {
    period,
    messages: Number(row?.messages ?? 0),
    aiRequests: Number(row?.ai_requests ?? 0),
    inputTokens: Number(row?.input_tokens ?? 0),
    outputTokens: Number(row?.output_tokens ?? 0),
    totalTokens: Number(row?.total_tokens ?? 0),
    estimatedCost: Number(row?.estimated_cost ?? 0),
  };
}

export function websiteUsage(websiteId: string, period = currentPeriod()): UsageSummary {
  const row = db.get<Record<string, number>>(
    'SELECT * FROM usage_records WHERE website_id = ? AND period = ?',
    websiteId, period,
  );
  return {
    period,
    messages: Number(row?.messages ?? 0),
    aiRequests: Number(row?.ai_requests ?? 0),
    inputTokens: Number(row?.input_tokens ?? 0),
    outputTokens: Number(row?.output_tokens ?? 0),
    totalTokens: Number(row?.total_tokens ?? 0),
    estimatedCost: Number(row?.estimated_cost ?? 0),
  };
}

/**
 * Enforced before a chat request reaches a provider. Throws
 * 'usage_limit_reached', which the plugin renders as a friendly visitor
 * message rather than an error.
 */
export function assertMessageQuota(accountId: string): void {
  const limit = planLimitFor(accountId, 'max_messages_month');
  if (limit <= 0) return;
  const used = accountUsage(accountId).messages;
  if (used >= limit) {
    throw new AppError(
      'usage_limit_reached',
      'This Chat Pilot account has reached its monthly message allowance.',
    );
  }
}

export function usageHistory(accountId: string, months = 6): UsageSummary[] {
  return db
    .all<Record<string, unknown>>(
      `SELECT period,
              SUM(messages) AS messages, SUM(ai_requests) AS ai_requests,
              SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
              SUM(total_tokens) AS total_tokens, SUM(estimated_cost) AS estimated_cost
         FROM usage_records WHERE account_id = ?
        GROUP BY period ORDER BY period DESC LIMIT ?`,
      accountId, months,
    )
    .map((r) => ({
      period: String(r.period),
      messages: Number(r.messages ?? 0),
      aiRequests: Number(r.ai_requests ?? 0),
      inputTokens: Number(r.input_tokens ?? 0),
      outputTokens: Number(r.output_tokens ?? 0),
      totalTokens: Number(r.total_tokens ?? 0),
      estimatedCost: Number(r.estimated_cost ?? 0),
    }));
}
