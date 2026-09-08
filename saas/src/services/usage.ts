/**
 * Usage accounting and plan enforcement.
 *
 * Rolled up per (website, YYYY-MM). Plan limits are checked against the
 * account-wide total for the current period.
 */
import { col, nowIso } from '../db/mongo.ts';
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

export async function recordUsage(accountId: string, websiteId: string, delta: UsageDelta): Promise<void> {
  const period = currentPeriod();
  const totalTokens = (delta.inputTokens ?? 0) + (delta.outputTokens ?? 0);

  await col('usage_records').updateOne(
    { website_id: websiteId, period },
    {
      $setOnInsert: { _id: newId(), account_id: accountId, website_id: websiteId, period },
      $inc: {
        messages: delta.messages ?? 0,
        ai_requests: delta.aiRequests ?? 0,
        input_tokens: delta.inputTokens ?? 0,
        output_tokens: delta.outputTokens ?? 0,
        total_tokens: totalTokens,
        estimated_cost: delta.estimatedCost ?? 0,
      },
      $set: { updated_at: nowIso() },
    } as never,
    { upsert: true },
  );

  // Budget alerts are de-duplicated per period, so calling this on every
  // request is cheap and cannot produce an email storm.
  if ((delta.estimatedCost ?? 0) > 0) {
    await checkBudgetThreshold(accountId);
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

function summaryFrom(row: Record<string, number> | undefined, period: string): UsageSummary {
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

export async function accountUsage(accountId: string, period = currentPeriod()): Promise<UsageSummary> {
  const rows = await col('usage_records')
    .aggregate<Record<string, number>>([
      { $match: { account_id: accountId, period } },
      {
        $group: {
          _id: null,
          messages: { $sum: '$messages' },
          ai_requests: { $sum: '$ai_requests' },
          input_tokens: { $sum: '$input_tokens' },
          output_tokens: { $sum: '$output_tokens' },
          total_tokens: { $sum: '$total_tokens' },
          estimated_cost: { $sum: '$estimated_cost' },
        },
      },
    ])
    .toArray();
  return summaryFrom(rows[0], period);
}

export async function websiteUsage(websiteId: string, period = currentPeriod()): Promise<UsageSummary> {
  const row = await col('usage_records').findOne({ website_id: websiteId, period });
  return summaryFrom(row as unknown as Record<string, number> | undefined, period);
}

/**
 * Enforced before a chat request reaches a provider. Throws
 * 'usage_limit_reached', which the plugin renders as a friendly visitor
 * message rather than an error.
 */
export async function assertMessageQuota(accountId: string): Promise<void> {
  const limit = await planLimitFor(accountId, 'max_messages_month');
  if (limit <= 0) return;
  const used = (await accountUsage(accountId)).messages;
  if (used >= limit) {
    throw new AppError(
      'usage_limit_reached',
      'This Chat Pilot account has reached its monthly message allowance.',
    );
  }
}

export async function usageHistory(accountId: string, months = 6): Promise<UsageSummary[]> {
  const rows = await col('usage_records')
    .aggregate<Record<string, unknown>>([
      { $match: { account_id: accountId } },
      {
        $group: {
          _id: '$period',
          messages: { $sum: '$messages' },
          ai_requests: { $sum: '$ai_requests' },
          input_tokens: { $sum: '$input_tokens' },
          output_tokens: { $sum: '$output_tokens' },
          total_tokens: { $sum: '$total_tokens' },
          estimated_cost: { $sum: '$estimated_cost' },
        },
      },
      { $sort: { _id: -1 } },
      { $limit: months },
    ])
    .toArray();
  return rows.map((r) => ({
    period: String(r._id),
    messages: Number(r.messages ?? 0),
    aiRequests: Number(r.ai_requests ?? 0),
    inputTokens: Number(r.input_tokens ?? 0),
    outputTokens: Number(r.output_tokens ?? 0),
    totalTokens: Number(r.total_tokens ?? 0),
    estimatedCost: Number(r.estimated_cost ?? 0),
  }));
}
