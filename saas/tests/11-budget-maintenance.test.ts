import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SiteClient, col, createTenant, seedKnowledge, startServer, type Tenant, type TestServer } from './helpers.ts';

let server: TestServer;
let tenant: Tenant;
let site: SiteClient;

before(async () => {
  server = await startServer();
  tenant = await createTenant(server.base, { domain: 'budget.example.com' });
  await seedKnowledge(tenant);
  site = new SiteClient(server.base, tenant.siteKey, tenant.siteUrl);
});
after(async () => {
  await server.close();
});

describe('Monthly AI budget', () => {
  it('reports no budget until one is set', async () => {
    const { getBudgetStatus } = await import('../src/services/budget.ts');
    const status = await getBudgetStatus(tenant.accountId);
    assert.equal(status.configured, false);
    assert.equal(status.budget, 0);
  });

  it('saves a budget through the portal', async () => {
    await tenant.client.refreshCsrf('/app/usage');
    const res = await tenant.client.postForm('/app/usage/budget', {
      monthly_budget: '70',
      alert_percent: '80',
    });
    assert.equal(res.status, 302);

    const { getBudgetStatus } = await import('../src/services/budget.ts');
    const status = await getBudgetStatus(tenant.accountId);
    assert.equal(status.configured, true);
    assert.equal(status.budget, 70);
    assert.equal(status.alertPercent, 80);
  });

  it('uses the documented remaining-budget formula', async () => {
    const { getBudgetStatus } = await import('../src/services/budget.ts');
    const { recordUsage } = await import('../src/services/usage.ts');

    await recordUsage(tenant.accountId, tenant.websiteId, { estimatedCost: 18.42 });

    const status = await getBudgetStatus(tenant.accountId);
    // Remaining = configured budget - estimated cost for the period.
    assert.equal(Number(status.spent.toFixed(2)), 18.42);
    assert.equal(Number(status.remaining.toFixed(2)), 51.58);
    assert.equal(status.alerting, false);
  });

  it('renders the budget on the Usage screen', async () => {
    const page = await tenant.client.get('/app/usage');
    assert.equal(page.status, 200);
    assert.match(page.text, /Monthly AI budget/);
    assert.match(page.text, /\$70\.00/);
    assert.match(page.text, /\$51\.58/);
  });

  it('raises one warning when the threshold is crossed', async () => {
    const { recordUsage } = await import('../src/services/usage.ts');
    const { getBudgetStatus } = await import('../src/services/budget.ts');

    // Push past 80% of $70.
    await recordUsage(tenant.accountId, tenant.websiteId, { estimatedCost: 40 });
    assert.equal((await getBudgetStatus(tenant.accountId)).alerting, true);

    // More spend in the same period must not produce a second warning.
    await recordUsage(tenant.accountId, tenant.websiteId, { estimatedCost: 1 });
    await recordUsage(tenant.accountId, tenant.websiteId, { estimatedCost: 1 });

    const warnings = await col('notifications')
      .find({ account_id: tenant.accountId, type: 'budget.warning' })
      .toArray();
    assert.equal(warnings.length, 1, 'exactly one warning per period per threshold');
  });

  it('raises a separate alert once the budget is exceeded', async () => {
    const { recordUsage } = await import('../src/services/usage.ts');
    const { getBudgetStatus } = await import('../src/services/budget.ts');

    await recordUsage(tenant.accountId, tenant.websiteId, { estimatedCost: 20 });
    const status = await getBudgetStatus(tenant.accountId);
    assert.equal(status.overBudget, true);
    assert.ok(status.remaining < 0);

    const exceeded = await col('notifications')
      .find({ account_id: tenant.accountId, type: 'budget.exceeded' })
      .toArray();
    assert.equal(exceeded.length, 1);
  });

  it('keeps budgets scoped to one account', async () => {
    const other = await createTenant(server.base, { domain: 'other-budget.example.com' });
    const { getBudgetStatus } = await import('../src/services/budget.ts');
    assert.equal((await getBudgetStatus(other.accountId)).configured, false);
  });
});

describe('Conversation lifecycle', () => {
  it('saves timeout and retention on the website', async () => {
    await tenant.client.refreshCsrf('/app/websites/' + tenant.websiteId + '/connection');
    const res = await tenant.client.postForm('/app/websites/' + tenant.websiteId + '/settings', {
      name: 'Budget Site',
      url: tenant.siteUrl,
      status: 'active',
      inactivity_timeout_minutes: '15',
      retention_days: '30',
    });
    assert.equal(res.status, 302);

    const row = await col<{ _id: string; inactivity_timeout_minutes: number; retention_days: number }>('websites').findOne(
      { _id: tenant.websiteId as never },
      { projection: { inactivity_timeout_minutes: 1, retention_days: 1 } },
    );
    assert.equal(Number(row?.inactivity_timeout_minutes), 15);
    assert.equal(Number(row?.retention_days), 30);
  });

  it('moves an idle conversation to completed', async () => {
    await site.post('/api/v1/site/chat', {
      session_key: 'lifecycle-session-1',
      message: 'How much does drain cleaning cost?',
    });

    const conversation = await col<{ _id: string; status: string }>('conversations').findOne({ session_key: 'lifecycle-session-1' });
    assert.equal(conversation?.status, 'active');

    // Age it past the 15 minute timeout.
    const stale = new Date(Date.now() - 60 * 60_000).toISOString().slice(0, 19).replace('T', ' ');
    await col('conversations').updateOne({ _id: conversation!._id as never }, { $set: { last_activity_at: stale } });

    const { completeInactive } = await import('../src/services/maintenance.ts');
    const changed = await completeInactive();
    assert.ok(changed >= 1);

    const after = await col<{ _id: string; status: string }>('conversations').findOne({ _id: conversation!._id as never });
    assert.equal(after?.status, 'completed');
  });

  it('purges data past the retention window, and only that data', async () => {
    await site.post('/api/v1/site/chat', {
      session_key: 'lifecycle-old-session',
      message: 'How much does drain cleaning cost?',
    });
    await site.post('/api/v1/site/chat', {
      session_key: 'lifecycle-fresh-session',
      message: 'Do you offer emergency callouts?',
    });

    const old = await col('conversations').findOne({ session_key: 'lifecycle-old-session' });
    const fresh = await col('conversations').findOne({ session_key: 'lifecycle-fresh-session' });

    const ancient = new Date(Date.now() - 100 * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
    await col('conversations').updateOne({ _id: old!._id as never }, { $set: { created_at: ancient } });

    const messagesBefore = await col('messages').countDocuments({ conversation_id: old!._id });
    assert.ok(messagesBefore > 0);

    const { purgeExpired } = await import('../src/services/maintenance.ts');
    const report = await purgeExpired();
    assert.ok(report.purgedConversations >= 1);

    assert.equal(await col('conversations').findOne({ _id: old!._id as never }), null);
    // Messages cascade with the conversation.
    assert.equal(await col('messages').countDocuments({ conversation_id: old!._id }), 0);
    // The recent conversation is untouched.
    assert.ok(await col('conversations').findOne({ _id: fresh!._id as never }));
  });

  it('keeps aggregate usage history through a purge', async () => {
    const usage = await col<{ _id: string; total_tokens: number }>('usage_records').findOne({ website_id: tenant.websiteId });
    assert.ok(usage, 'usage rollups survive retention purges');
  });

  it('never purges when retention is set to keep forever', async () => {
    await col('websites').updateOne({ _id: tenant.websiteId as never }, { $set: { retention_days: 0 } });

    await site.post('/api/v1/site/chat', {
      session_key: 'lifecycle-forever-session',
      message: 'How much does drain cleaning cost?',
    });
    const conversation = await col('conversations').findOne({ session_key: 'lifecycle-forever-session' });
    const ancient = new Date(Date.now() - 5000 * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
    await col('conversations').updateOne({ _id: conversation!._id as never }, { $set: { created_at: ancient } });

    const { purgeExpired } = await import('../src/services/maintenance.ts');
    await purgeExpired();

    assert.ok(await col('conversations').findOne({ _id: conversation!._id as never }));
  });

  it('drops expired portal sessions', async () => {
    const { purgePlatformData } = await import('../src/services/maintenance.ts');
    const expired = new Date(Date.now() - 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
    const anyUser = await col('users').findOne({}, { projection: { _id: 1 } });
    await col('sessions').insertOne({
      _id: 'expired-session-row',
      user_id: anyUser!._id,
      ip_hash: '',
      user_agent: '',
      csrf_token: 'x',
      created_at: expired,
      last_seen_at: expired,
      expires_at: expired,
      revoked_at: null,
    });
    const before = await col('sessions').findOne({ _id: 'expired-session-row' as never });
    assert.ok(before);

    await purgePlatformData();
    assert.equal(await col('sessions').findOne({ _id: 'expired-session-row' as never }), null);
  });
});
