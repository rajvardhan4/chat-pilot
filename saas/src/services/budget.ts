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
import { db, nowIso } from '../db/index.ts';
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

export function getBudgetStatus(accountId: string, period = currentPeriod()): BudgetStatus {
  const row = db.get<{ monthly_budget_cents: number; budget_alert_percent: number }>(
    'SELECT monthly_budget_cents, budget_alert_percent FROM accounts WHERE id = ?',
    accountId,
  );

  const budget = Number(row?.monthly_budget_cents ?? 0) / 100;
  const alertPercent = Number(row?.budget_alert_percent ?? 80);
  const spent = Number(accountUsage(accountId, period).estimatedCost.toFixed(4));

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

export function setBudget(
  accountId: string,
  budgetDollars: number,
  alertPercent: number,
  actorId: string,
): BudgetStatus {
  const cents = Math.max(0, Math.round(budgetDollars * 100));
  const percent = Math.min(100, Math.max(1, Math.round(alertPercent)));

  db.run(
    'UPDATE accounts SET monthly_budget_cents = ?, budget_alert_percent = ?, updated_at = ? WHERE id = ?',
    cents, percent, nowIso(), accountId,
  );

  audit({
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
export function checkBudgetThreshold(accountId: string): void {
  const status = getBudgetStatus(accountId);
  if (!status.configured || !status.alerting) return;

  const stage = status.overBudget ? 'exceeded' : 'warning';
  const recipient = db.get<{ billing_email: string; name: string }>(
    'SELECT billing_email, name FROM accounts WHERE id = ?',
    accountId,
  );
  if (!recipient?.billing_email) return;

  enqueueNotification({
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
