/**
 * Monthly AI budget.
 *
 * Carried over from v1, where an administrator set a monthly figure and Chat
 * Pilot warned them as it was approached. Two properties from the original
 * spec are preserved exactly:
 *
 *   Remaining = Configured Budget - Estimated AI Cost for the period
 *
 * and: the budget is a number the customer types. It is never inferred from a
 * provider account or an API key, and it is compared against Chat Pilot's own
 * estimate, not a provider invoice.
 *
 * Crossing the alert threshold notifies once per period per threshold, so a
 * busy month cannot produce an email storm.
 */
import { col, nowIso } from '../db/mongo.ts';
import { accountUsage, currentPeriod } from './usage.ts';
import { enqueueNotification } from './notifications.ts';
import { audit } from './audit.ts';

export interface BudgetStatus {
  /** 0 means no budget is configured. */
  budget: number;
  alertPercent: number;
  spent: number;
  remaining: number;
  percentUsed: number;
  configured: boolean;
  overBudget: boolean;
  alerting: boolean;
  period: string;
}

export async function getBudgetStatus(accountId: string, period = currentPeriod()): Promise<BudgetStatus> {
  const row = await col<{ _id: string; monthly_budget_cents: number; budget_alert_percent: number }>('accounts').findOne(
    { _id: accountId as never },
    { projection: { monthly_budget_cents: 1, budget_alert_percent: 1 } },
  );

  const budget = Number(row?.monthly_budget_cents ?? 0) / 100;
  const alertPercent = Number(row?.budget_alert_percent ?? 80);
  const spent = Number((await accountUsage(accountId, period)).estimatedCost.toFixed(4));

  if (budget <= 0) {
    return {
      budget: 0, alertPercent, spent, remaining: 0, percentUsed: 0,
      configured: false, overBudget: false, alerting: false, period,
    };
  }

  const percentUsed = Number(((spent / budget) * 100).toFixed(1));
  return {
    budget,
    alertPercent,
    spent,
    remaining: Number((budget - spent).toFixed(4)),
    percentUsed,
    configured: true,
    overBudget: spent >= budget,
    alerting: percentUsed >= alertPercent,
    period,
  };
}

export async function setBudget(
  accountId: string,
  budgetDollars: number,
  alertPercent: number,
  actorId: string,
): Promise<BudgetStatus> {
  const cents = Math.max(0, Math.round(budgetDollars * 100));
  const percent = Math.min(100, Math.max(1, Math.round(alertPercent)));

  await col('accounts').updateOne(
    { _id: accountId as never },
    { $set: { monthly_budget_cents: cents, budget_alert_percent: percent, updated_at: nowIso() } },
  );

  await audit({
    accountId, actorType: 'user', actorId, action: 'budget.updated',
    targetType: 'account', targetId: accountId,
    metadata: { budget: cents / 100, alertPercent: percent },
  });

  return getBudgetStatus(accountId);
}

/**
 * Called after usage is recorded. Emits at most one notification per account,
 * per period, per threshold crossed.
 */
export async function checkBudgetThreshold(accountId: string): Promise<void> {
  const status = await getBudgetStatus(accountId);
  if (!status.configured || !status.alerting) return;

  const stage = status.overBudget ? 'exceeded' : 'warning';
  const recipient = await col<{ _id: string; billing_email: string; name: string }>('accounts').findOne(
    { _id: accountId as never },
    { projection: { billing_email: 1, name: 1 } },
  );
  if (!recipient?.billing_email) return;

  await enqueueNotification({
    accountId,
    type: 'budget.' + stage,
    severity: status.overBudget ? 'error' : 'warning',
    recipient: recipient.billing_email,
    subject:
      status.overBudget
        ? 'Chat Pilot: monthly AI budget exceeded'
        : 'Chat Pilot: monthly AI budget at ' + status.percentUsed + '%',
    body: [
      'Estimated AI spend for ' + status.period + ':',
      '  Configured budget : $' + status.budget.toFixed(2),
      '  Estimated used    : $' + status.spent.toFixed(4),
      '  Estimated remaining: $' + status.remaining.toFixed(4),
      '  Used              : ' + status.percentUsed + '% (alert at ' + status.alertPercent + '%)',
      '',
      'This is Chat Pilot’s own estimate from tracked token usage, not a provider invoice.',
    ].join('\n'),
    // One alert per account, per period, per stage.
    dedupeKey: 'budget:' + accountId + ':' + status.period + ':' + stage,
    dedupeWindowMinutes: 60 * 24 * 40,
  });
}
