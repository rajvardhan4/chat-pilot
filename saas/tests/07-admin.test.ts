import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PortalClient,
  SiteClient,
  col,
  createTenant,
  seedKnowledge,
  startServer,
  type Tenant,
  type TestServer,
} from './helpers.ts';

let server: TestServer;
let admin: PortalClient;
let tenant: Tenant;
let site: SiteClient;

const ADMIN_EMAIL = 'platform-admin@localmarketinggeeks.com';
const ADMIN_PASSWORD = 'MasterAdminPass77!';

before(async () => {
  server = await startServer();

  const { createSuperAdmin } = await import('../src/services/accounts.ts');
  createSuperAdmin(ADMIN_EMAIL, ADMIN_PASSWORD, 'Platform Administrator');

  admin = new PortalClient(server.base);
  const login = await admin.postForm('/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  assert.equal(login.status, 302);
  assert.equal(login.headers.get('location'), '/admin');
  await admin.refreshCsrf('/admin');

  tenant = await createTenant(server.base, { domain: 'admin-target.example.com', company: 'Target Co' });
  await seedKnowledge(tenant);
  site = new SiteClient(server.base, tenant.siteKey, tenant.siteUrl);
  await site.post('/api/v1/site/chat', {
    session_key: 'admin-seed-session',
    message: 'How much does drain cleaning cost?',
  });
});
after(async () => {
  await server.close();
});

describe('Master Admin dashboard', () => {
  it('renders platform-wide totals', async () => {
    const res = await admin.get('/admin');
    assert.equal(res.status, 200);
    assert.match(res.text, /Platform overview/);
    assert.match(res.text, /Accounts/);
    assert.match(res.text, /Active Site Keys/);
    assert.match(res.text, /Provider Errors/);
  });

  it('lists customers and opens one', async () => {
    const list = await admin.get('/admin/accounts');
    assert.equal(list.status, 200);
    assert.match(list.text, /Target Co/);

    const detail = await admin.get('/admin/accounts/' + tenant.accountId);
    assert.equal(detail.status, 200);
    assert.match(detail.text, /Target Co/);
    assert.match(detail.text, /admin-target\.example\.com/);
  });

  it('never displays a customer provider API key', async () => {
    const detail = await admin.get('/admin/accounts/' + tenant.accountId);
    // The mock key used by the fixture is "mock-ok-...".
    assert.doesNotMatch(detail.text, /mock-ok-/);
    // Only the masked hint is shown.
    assert.match(detail.text, /moc••••••••/);
    assert.doesNotMatch(detail.text, /api_key_enc/);
  });

  it('shows system health and the audit log', async () => {
    const health = await admin.get('/admin/health');
    assert.equal(health.status, 200);
    assert.match(health.text, /Provider status by website/);

    const audit = await admin.get('/admin/audit');
    assert.equal(audit.status, 200);
    assert.match(audit.text, /site_key\.issued|website\.created/);
  });
});

describe('Master Admin controls', () => {
  it('suspends an account and immediately stops its widget', async () => {
    assert.equal((await site.get('/api/v1/site/health')).status, 200);

    await admin.refreshCsrf('/admin/accounts/' + tenant.accountId);
    const suspend = await admin.postForm('/admin/accounts/' + tenant.accountId + '/status', {
      status: 'suspended',
      reason: 'Non-payment',
    });
    assert.equal(suspend.status, 302);

    const blocked = await site.get('/api/v1/site/health');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error.code, 'account_suspended');

    // The customer is locked out of their own portal too.
    const portal = await tenant.client.get('/app');
    assert.equal(portal.status, 403);

    await admin.refreshCsrf('/admin/accounts/' + tenant.accountId);
    await admin.postForm('/admin/accounts/' + tenant.accountId + '/status', {
      status: 'active', reason: 'Payment received',
    });
    assert.equal((await site.get('/api/v1/site/health')).status, 200);
  });

  it('suspends an individual website', async () => {
    await admin.refreshCsrf('/admin/websites');
    const res = await admin.postForm('/admin/websites/' + tenant.websiteId + '/status', {
      status: 'suspended', reason: 'Abuse report',
    });
    assert.equal(res.status, 302);

    const blocked = await site.get('/api/v1/site/health');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error.code, 'website_disabled');

    // The customer cannot un-suspend a platform suspension themselves.
    await tenant.client.refreshCsrf('/app/websites/' + tenant.websiteId + '/connection');
    const attempt = await tenant.client.postForm(
      '/app/websites/' + tenant.websiteId + '/settings',
      { status: 'active' },
    );
    assert.equal(attempt.status, 302);
    assert.match(attempt.headers.get('location') ?? '', /error=/);
    assert.equal(
      (await col<{ _id: string; status: string }>('websites').findOne({ _id: tenant.websiteId as never }))?.status,
      'suspended',
    );

    await admin.refreshCsrf('/admin/websites');
    await admin.postForm('/admin/websites/' + tenant.websiteId + '/status', {
      status: 'active', reason: 'Resolved',
    });
    assert.equal((await site.get('/api/v1/site/health')).status, 200);
  });

  it('revokes a site key from the platform side', async () => {
    const key = await col<{ _id: string }>('site_api_credentials').findOne({
      website_id: tenant.websiteId,
      status: 'active',
    });
    await admin.refreshCsrf('/admin/accounts/' + tenant.accountId);
    const res = await admin.postForm('/admin/keys/' + key!._id + '/revoke', {});
    assert.equal(res.status, 302);

    const blocked = await site.get('/api/v1/site/health');
    assert.equal(blocked.status, 401);
    assert.equal(blocked.body.error.code, 'site_key_revoked');

    const entry = await col<{ _id: string; actor_type: string }>('audit_logs')
      .find({ action: 'site_key.admin_revoked' })
      .sort({ created_at: -1 })
      .limit(1)
      .next();
    assert.equal(entry?.actor_type, 'super_admin');
  });

  it('changes a plan and the new limit takes effect', async () => {
    const growth = await col<{ _id: string }>('plans').findOne({ slug: 'growth' });
    await admin.refreshCsrf('/admin/accounts/' + tenant.accountId);
    const res = await admin.postForm('/admin/accounts/' + tenant.accountId + '/plan', {
      plan_id: growth!._id,
    });
    assert.equal(res.status, 302);

    const { planLimitFor } = await import('../src/services/websites.ts');
    assert.equal(await planLimitFor(tenant.accountId, 'max_websites'), 5);
  });

  it('creates a plan and updates model pricing', async () => {
    await admin.refreshCsrf('/admin/plans');
    const plan = await admin.postForm('/admin/plans', {
      name: 'Enterprise', slug: 'enterprise', price_cents: '99900',
      max_websites: '100', max_documents: '100000',
      max_messages_month: '500000', max_storage_mb: '20000', is_active: 'true',
    });
    assert.equal(plan.status, 302);
    assert.ok(await col('plans').findOne({ slug: 'enterprise' }));

    const pricing = await admin.postForm('/admin/pricing', {
      rates: JSON.stringify({ 'mock-small': { input: 1.5, output: 4.5 } }),
    });
    assert.equal(pricing.status, 302);

    const { rateFor } = await import('../src/services/pricing.ts');
    assert.deepEqual(await rateFor('mock-small'), { input: 1.5, output: 4.5 });
  });

  it('rejects malformed pricing JSON without changing anything', async () => {
    await admin.refreshCsrf('/admin/plans');
    const res = await admin.postForm('/admin/pricing', { rates: 'not json at all' });
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location') ?? '', /error=/);

    const { rateFor } = await import('../src/services/pricing.ts');
    assert.deepEqual(await rateFor('mock-small'), { input: 1.5, output: 4.5 });
  });

  it('suspends a user and kills their session', async () => {
    const membership = await col<{ _id: string; user_id: string }>('account_members').findOne({
      account_id: tenant.accountId,
    });
    await admin.refreshCsrf('/admin/accounts/' + tenant.accountId);
    const res = await admin.postForm('/admin/users/' + membership!.user_id + '/status', { status: 'suspended' });
    assert.equal(res.status, 302);

    const locked = await tenant.client.get('/app');
    assert.equal(locked.status, 401);

    const relogin = await new PortalClient(server.base).postForm('/login', {
      email: tenant.email, password: tenant.password,
    });
    assert.equal(relogin.status, 403);
  });
});

describe('Admin authorisation', () => {
  it('refuses every admin route to an unauthenticated visitor', async () => {
    const anon = new PortalClient(server.base);
    for (const path of ['/admin', '/admin/accounts', '/admin/websites', '/admin/plans', '/admin/health', '/admin/audit']) {
      assert.equal((await anon.get(path)).status, 401, path);
    }
  });

  it('refuses admin write routes to a customer', async () => {
    const customer = await createTenant(server.base, { domain: 'not-admin.example.com' });
    await customer.client.refreshCsrf('/app');
    const res = await customer.client.postForm('/admin/accounts/' + tenant.accountId + '/status', {
      status: 'suspended', reason: 'privilege escalation attempt',
    });
    assert.equal(res.status, 403);
    assert.equal(
      (await col<{ _id: string; status: string }>('accounts').findOne({ _id: tenant.accountId as never }))?.status,
      'active',
    );
  });
});
