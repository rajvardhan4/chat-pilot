/**
 * Usage accounting and plan enforcement.
 *
 * Rolled up per (website, YYYY-MM). Plan limits are checked against the
 * account-wide total for the current period.
 */
import { col, nowIso } from "../db/mongo.js";
import { AppError } from "../core/errors.js";
import { newId } from "../core/crypto.js";
import { planLimitFor } from "./websites.js";
import { checkBudgetThreshold } from "./budget.js";
export function currentPeriod(date = new Date()) {
    return date.toISOString().slice(0, 7);
}
export async function recordUsage(accountId, websiteId, delta) {
    const period = currentPeriod();
    const totalTokens = (delta.inputTokens ?? 0) + (delta.outputTokens ?? 0);
    await col('usage_records').updateOne({ website_id: websiteId, period }, {
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
    }, { upsert: true });
    // Budget alerts are de-duplicated per period, so calling this on every
    // request is cheap and cannot produce an email storm.
    if ((delta.estimatedCost ?? 0) > 0) {
        await checkBudgetThreshold(accountId);
    }
}
function summaryFrom(row, period) {
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
export async function accountUsage(accountId, period = currentPeriod()) {
    const rows = await col('usage_records')
        .aggregate([
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
export async function websiteUsage(websiteId, period = currentPeriod()) {
    const row = await col('usage_records').findOne({ website_id: websiteId, period });
    return summaryFrom(row, period);
}
/**
 * Enforced before a chat request reaches a provider. Throws
 * 'usage_limit_reached', which the plugin renders as a friendly visitor
 * message rather than an error.
 */
export async function assertMessageQuota(accountId) {
    const limit = await planLimitFor(accountId, 'max_messages_month');
    if (limit <= 0)
        return;
    const used = (await accountUsage(accountId)).messages;
    if (used >= limit) {
        throw new AppError('usage_limit_reached', 'This Chat Pilot account has reached its monthly message allowance.');
    }
}
export async function usageHistory(accountId, months = 6) {
    const rows = await col('usage_records')
        .aggregate([
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
