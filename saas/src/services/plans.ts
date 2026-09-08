import { db, nowIso } from '../db/index.ts';
import { newId } from '../core/crypto.ts';
import { audit } from './audit.ts';

export interface PlanRow {
  id: string;
  name: string;
  slug: string;
  price_cents: number;
  currency: string;
  max_websites: number;
  max_documents: number;
  max_messages_month: number;
  max_storage_mb: number;
  features: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export function listPlans(includeInactive = false): PlanRow[] {
  return db.all<PlanRow>(
    'SELECT * FROM plans' + (includeInactive ? '' : ' WHERE is_active = 1') + ' ORDER BY price_cents ASC',
  );
}

export function getPlan(id: string): PlanRow | undefined {
  return db.get<PlanRow>('SELECT * FROM plans WHERE id = ?', id);
}

export function getPlanBySlug(slug: string): PlanRow | undefined {
  return db.get<PlanRow>('SELECT * FROM plans WHERE slug = ?', slug);
}

export interface PlanInput {
  name: string;
  slug: string;
  priceCents: number;
  maxWebsites: number;
  maxDocuments: number;
  maxMessagesMonth: number;
  maxStorageMb: number;
  isActive?: boolean;
}

export function upsertPlan(input: PlanInput, actorId: string): PlanRow {
  const existing = getPlanBySlug(input.slug);
  const now = nowIso();
  if (existing) {
    db.run(
      `UPDATE plans SET name = ?, price_cents = ?, max_websites = ?, max_documents = ?,
              max_messages_month = ?, max_storage_mb = ?, is_active = ?, updated_at = ?
        WHERE id = ?`,
      input.name, input.priceCents, input.maxWebsites, input.maxDocuments,
      input.maxMessagesMonth, input.maxStorageMb, input.isActive === false ? 0 : 1, now, existing.id,
    );
    audit({ actorType: 'super_admin', actorId, action: 'plan.updated', targetType: 'plan', targetId: existing.id });
    return getPlan(existing.id)!;
  }
  const id = newId();
  db.run(
    `INSERT INTO plans (id, name, slug, price_cents, currency, max_websites, max_documents,
                        max_messages_month, max_storage_mb, features, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'USD', ?, ?, ?, ?, '{}', ?, ?, ?)`,
    id, input.name, input.slug, input.priceCents, input.maxWebsites, input.maxDocuments,
    input.maxMessagesMonth, input.maxStorageMb, input.isActive === false ? 0 : 1, now, now,
  );
  audit({ actorType: 'super_admin', actorId, action: 'plan.created', targetType: 'plan', targetId: id });
  return getPlan(id)!;
}

export function assignPlan(accountId: string, planId: string, actorId: string): void {
  const plan = getPlan(planId);
  if (!plan) return;
  const now = nowIso();
  const periodEnd = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  db.tx(() => {
    db.run('UPDATE accounts SET plan_id = ?, updated_at = ? WHERE id = ?', planId, now, accountId);
    const sub = db.get<{ id: string }>(
      'SELECT id FROM subscriptions WHERE account_id = ? ORDER BY created_at DESC LIMIT 1', accountId,
    );
    if (sub) {
      db.run(
        "UPDATE subscriptions SET plan_id = ?, status = 'active', current_period_end = ?, updated_at = ? WHERE id = ?",
        planId, periodEnd, now, sub.id,
      );
    } else {
      db.run(
        `INSERT INTO subscriptions (id, account_id, plan_id, status, current_period_start, current_period_end, created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, ?, ?, ?)`,
        newId(), accountId, planId, now, periodEnd, now, now,
      );
    }
  });
  audit({
    accountId, actorType: 'super_admin', actorId, action: 'plan.assigned',
    targetType: 'account', targetId: accountId, metadata: { planId },
  });
}

export function setSubscriptionStatus(
  accountId: string,
  status: 'active' | 'trialing' | 'past_due' | 'canceled',
  actorId: string,
): void {
  db.run(
    'UPDATE subscriptions SET status = ?, updated_at = ? WHERE account_id = ?',
    status, nowIso(), accountId,
  );
  audit({
    accountId, actorType: 'super_admin', actorId, action: 'subscription.status_changed',
    targetType: 'account', targetId: accountId, metadata: { status },
  });
}

export function getSubscription(accountId: string) {
  return db.get<Record<string, unknown>>(
    `SELECT s.*, p.name AS plan_name, p.slug AS plan_slug, p.price_cents,
            p.max_websites, p.max_documents, p.max_messages_month
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id
      WHERE s.account_id = ? ORDER BY s.created_at DESC LIMIT 1`,
    accountId,
  );
}

/** Seeds the default plan ladder. Idempotent. */
export function seedDefaultPlans(): void {
  const defaults: PlanInput[] = [
    { name: 'Starter', slug: 'starter', priceCents: 0, maxWebsites: 1, maxDocuments: 200, maxMessagesMonth: 1000, maxStorageMb: 50 },
    { name: 'Growth', slug: 'growth', priceCents: 4900, maxWebsites: 5, maxDocuments: 2000, maxMessagesMonth: 10000, maxStorageMb: 500 },
    { name: 'Agency', slug: 'agency', priceCents: 14900, maxWebsites: 25, maxDocuments: 10000, maxMessagesMonth: 50000, maxStorageMb: 2000 },
  ];
  for (const plan of defaults) {
    if (!getPlanBySlug(plan.slug)) upsertPlan(plan, 'system');
  }
}
