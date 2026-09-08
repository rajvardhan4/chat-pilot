import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SiteClient, createTenant, db, seedKnowledge, startServer, type Tenant, type TestServer } from './helpers.ts';

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
    const status = getBudgetStatus(tenant.accountId);
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
    const status = getBudgetStatus(tenant.accountId);
    assert.equal(status.configured, true);
    assert.equal(status.budget, 70);
    assert.equal(status.alertPercent, 80);
  });

  it('uses the documented remaining-budget formula', async () => {
    const { getBudgetStatus } = await import('../src/services/budget.ts');
    const { recordUsage } = await import('../src/services/usage.ts');

    recordUsage(tenant.accountId, tenant.websiteId, { estimatedCost: 18.42 });

    const status = getBudgetStatus(tenant.accountId);
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
    recordUsage(tenant.accountId, tenant.websiteId, { estimatedCost: 40 });
    assert.equal(getBudgetStatus(tenant.accountId).alerting, true);

    // More spend in the same period must not produce a second warning.
    recordUsage(tenant.accountId, tenant.websiteId, { estimatedCost: 1 });
    recordUsage(tenant.accountId, tenant.websiteId, { estimatedCost: 1 });

    const warnings = db.all<{ id: string }>(
      "SELECT id FROM notifications WHERE account_id = ? AND type = 'budget.warning'",
      tenant.accountId,
    );
    assert.equal(warnings.length, 1, 'exactly one warning per period per threshold');
  });

  it('raises a separate alert once the budget is exceeded', async () => {
    const { recordUsage } = await import('../src/services/usage.ts');
    const { getBudgetStatus } = await import('../src/services/budget.ts');

    recordUsage(tenant.accountId, tenant.websiteId, { estimatedCost: 20 });
    const status = getBudgetStatus(tenant.accountId);
    assert.equal(status.overBudget, true);
    assert.ok(status.remaining < 0);

    const exceeded = db.all<{ id: string }>(
      "SELECT id FROM notifications WHERE account_id = ? AND type = 'budget.exceeded'",
      tenant.accountId,
    );
    assert.equal(exceeded.length, 1);
  });

  it('keeps budgets scoped to one account', async () => {
    const other = await createTenant(server.base, { domain: 'other-budget.example.com' });
    const { getBudgetStatus } = await import('../src/services/budget.ts');
    assert.equal(getBudgetStatus(other.accountId).configured, false);
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

    const row = db.get<{ inactivity_timeout_minutes: number; retention_days: number }>(
      'SELECT inactivity_timeout_minutes, retention_days FROM websites WHERE id = ?',
      tenant.websiteId,
    );
    assert.equal(Number(row?.inactivity_timeout_minutes), 15);
    assert.equal(Number(row?.retention_days), 30);
  });

  it('moves an idle conversation to completed', async () => {
    await site.post('/api/v1/site/chat', {
      session_key: 'lifecycle-session-1',
      message: 'How much does drain cleaning cost?',
    });

    const conversation = db.get<{ id: string; status: string }>(
      'SELECT id, status FROM conversations WHERE session_key = ?', 'lifecycle-session-1',
    );
    assert.equal(conversation?.status, 'active');

    // Age it past the 15 minute timeout.
    const stale = new Date(Date.now() - 60 * 60_000).toISOString().slice(0, 19).replace('T', ' ');
    db.run('UPDATE conversations SET last_activity_at = ? WHERE id = ?', stale, conversation!.id);

    const { completeInactive } = await import('../src/services/maintenance.ts');
    const changed = completeInactive();
    assert.ok(changed >= 1);

    const after = db.get<{ status: string }>('SELECT status FROM conversations WHERE id = ?', conversation!.id);
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

    const old = db.get<{ id: string }>('SELECT id FROM conversations WHERE session_key = ?', 'lifecycle-old-session');
    const fresh = db.get<{ id: string }>('SELECT id FROM conversations WHERE session_key = ?', 'lifecycle-fresh-session');

    const ancient = new Date(Date.now() - 100 * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
    db.run('UPDATE conversations SET created_at = ? WHERE id = ?', ancient, old!.id);

    const messagesBefore = db.scalar<number>(
      'SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ?', old!.id,
    ) ?? 0;
    assert.ok(messagesBefore > 0);

    const { purgeExpired } = await import('../src/services/maintenance.ts');
    const report = purgeExpired();
    assert.ok(report.purgedConversations >= 1);

    assert.equal(db.get('SELECT id FROM conversations WHERE id = ?', old!.id), undefined);
    // Messages cascade with the conversation.
    assert.equal(
      db.scalar<number>('SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ?', old!.id),
      0,
    );
    // The recent conversation is untouched.
    assert.ok(db.get('SELECT id FROM conversations WHERE id = ?', fresh!.id));
  });

  it('keeps aggregate usage history through a purge', () => {
    const usage = db.get<{ total_tokens: number }>(
      'SELECT total_tokens FROM usage_records WHERE website_id = ?', tenant.websiteId,
    );
    assert.ok(usage, 'usage rollups survive retention purges');
  });

  it('never purges when retention is set to keep forever', async () => {
    db.run('UPDATE websites SET retention_days = 0 WHERE id = ?', tenant.websiteId);

    await site.post('/api/v1/site/chat', {
      session_key: 'lifecycle-forever-session',
      message: 'How much does drain cleaning cost?',
    });
    const conversation = db.get<{ id: string }>(
      'SELECT id FROM conversations WHERE session_key = ?', 'lifecycle-forever-session',
    );
    const ancient = new Date(Date.now() - 5000 * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
    db.run('UPDATE conversations SET created_at = ? WHERE id = ?', ancient, conversation!.id);

    const { purgeExpired } = await import('../src/services/maintenance.ts');
    purgeExpired();

    assert.ok(db.get('SELECT id FROM conversations WHERE id = ?', conversation!.id));
  });

  it('drops expired portal sessions', async () => {
    const { purgePlatformData } = await import('../src/services/maintenance.ts');
    const expired = new Date(Date.now() - 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
    db.run(
      `INSERT INTO sessions (id, user_id, csrf_token, created_at, last_seen_at, expires_at)
       SELECT 'expired-session-row', id, 'x', ?, ?, ? FROM users LIMIT 1`,
      expired, expired, expired,
    );
    const before = db.get('SELECT id FROM sessions WHERE id = ?', 'expired-session-row');
    assert.ok(before);

    purgePlatformData();
    assert.equal(db.get('SELECT id FROM sessions WHERE id = ?', 'expired-session-row'), undefined);
  });
});
