import { col, nowIso, withTransaction } from '../db/mongo.ts';
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

type PlanDoc = Omit<PlanRow, 'id'> & { _id: string };

function toPlanRow(d: PlanDoc): PlanRow {
  const { _id, ...rest } = d;
  return { id: _id, ...rest };
}

export async function listPlans(includeInactive = false): Promise<PlanRow[]> {
  const filter = includeInactive ? {} : { is_active: 1 };
  const docs = await col<PlanDoc>('plans').find(filter).sort({ price_cents: 1 }).toArray();
  return docs.map(toPlanRow);
}

export async function getPlan(id: string): Promise<PlanRow | undefined> {
  const doc = await col<PlanDoc>('plans').findOne({ _id: id as never });
  return doc ? toPlanRow(doc) : undefined;
}

export async function getPlanBySlug(slug: string): Promise<PlanRow | undefined> {
  const doc = await col<PlanDoc>('plans').findOne({ slug });
  return doc ? toPlanRow(doc) : undefined;
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

export async function upsertPlan(input: PlanInput, actorId: string): Promise<PlanRow> {
  const existing = await getPlanBySlug(input.slug);
  const now = nowIso();
  if (existing) {
    await col('plans').updateOne(
      { _id: existing.id as never },
      {
        $set: {
          name: input.name,
          price_cents: input.priceCents,
          max_websites: input.maxWebsites,
          max_documents: input.maxDocuments,
          max_messages_month: input.maxMessagesMonth,
          max_storage_mb: input.maxStorageMb,
          is_active: input.isActive === false ? 0 : 1,
          updated_at: now,
        },
      },
    );
    await audit({ actorType: 'super_admin', actorId, action: 'plan.updated', targetType: 'plan', targetId: existing.id });
    return (await getPlan(existing.id))!;
  }
  const id = newId();
  await col<PlanDoc>('plans').insertOne({
    _id: id,
    name: input.name,
    slug: input.slug,
    price_cents: input.priceCents,
    currency: 'USD',
    max_websites: input.maxWebsites,
    max_documents: input.maxDocuments,
    max_messages_month: input.maxMessagesMonth,
    max_storage_mb: input.maxStorageMb,
    features: '{}',
    is_active: input.isActive === false ? 0 : 1,
    created_at: now,
    updated_at: now,
  });
  await audit({ actorType: 'super_admin', actorId, action: 'plan.created', targetType: 'plan', targetId: id });
  return (await getPlan(id))!;
}

export async function assignPlan(accountId: string, planId: string, actorId: string): Promise<void> {
  const plan = await getPlan(planId);
  if (!plan) return;
  const now = nowIso();
  const periodEnd = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');

  await withTransaction(async (session) => {
    await col('accounts').updateOne({ _id: accountId as never }, { $set: { plan_id: planId, updated_at: now } }, { session });
    const sub = await col<{ _id: string }>('subscriptions')
      .find({ account_id: accountId }, { session })
      .sort({ created_at: -1 })
      .limit(1)
      .next();
    if (sub) {
      await col('subscriptions').updateOne(
        { _id: sub._id as never },
        { $set: { plan_id: planId, status: 'active', current_period_end: periodEnd, updated_at: now } },
        { session },
      );
    } else {
      await col('subscriptions').insertOne(
        {
          _id: newId(),
          account_id: accountId,
          plan_id: planId,
          status: 'active',
          current_period_start: now,
          current_period_end: periodEnd,
          external_ref: '',
          created_at: now,
          updated_at: now,
        },
        { session },
      );
    }
  });

  await audit({
    accountId, actorType: 'super_admin', actorId, action: 'plan.assigned',
    targetType: 'account', targetId: accountId, metadata: { planId },
  });
}

export async function setSubscriptionStatus(
  accountId: string,
  status: 'active' | 'trialing' | 'past_due' | 'canceled',
  actorId: string,
): Promise<void> {
  await col('subscriptions').updateMany(
    { account_id: accountId },
    { $set: { status, updated_at: nowIso() } },
  );
  await audit({
    accountId, actorType: 'super_admin', actorId, action: 'subscription.status_changed',
    targetType: 'account', targetId: accountId, metadata: { status },
  });
}

export async function getSubscription(accountId: string): Promise<Record<string, unknown> | undefined> {
  const sub = await col<Record<string, unknown> & { _id: string; plan_id: string; created_at: string }>('subscriptions')
    .find({ account_id: accountId })
    .sort({ created_at: -1 })
    .limit(1)
    .next();
  if (!sub) return undefined;
  // The old query was an INNER JOIN: no matching plan meant no row at all.
  const plan = await col<PlanDoc>('plans').findOne({ _id: sub.plan_id as never });
  if (!plan) return undefined;
  return {
    ...sub,
    id: sub._id,
    plan_name: plan.name,
    plan_slug: plan.slug,
    price_cents: plan.price_cents,
    max_websites: plan.max_websites,
    max_documents: plan.max_documents,
    max_messages_month: plan.max_messages_month,
  };
}

/** Seeds the default plan ladder. Idempotent. */
export async function seedDefaultPlans(): Promise<void> {
  const defaults: PlanInput[] = [
    { name: 'Starter', slug: 'starter', priceCents: 0, maxWebsites: 1, maxDocuments: 200, maxMessagesMonth: 1000, maxStorageMb: 50 },
    { name: 'Growth', slug: 'growth', priceCents: 4900, maxWebsites: 5, maxDocuments: 2000, maxMessagesMonth: 10000, maxStorageMb: 500 },
    { name: 'Agency', slug: 'agency', priceCents: 14900, maxWebsites: 25, maxDocuments: 10000, maxMessagesMonth: 50000, maxStorageMb: 2000 },
  ];
  for (const plan of defaults) {
    if (!(await getPlanBySlug(plan.slug))) await upsertPlan(plan, 'system');
  }
}
