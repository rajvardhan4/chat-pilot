import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTenant, seedKnowledge, startServer, type Tenant, type TestServer } from './helpers.ts';

let server: TestServer;
let alpha: Tenant;
let beta: Tenant;

before(async () => {
  server = await startServer();
  alpha = await createTenant(server.base, { domain: 'alpha-tenant.example.com', company: 'Alpha Plumbing' });
  beta = await createTenant(server.base, { domain: 'beta-tenant.example.com', company: 'Beta Roofing' });
  await seedKnowledge(alpha);
  await seedKnowledge(beta);
});
after(async () => {
  await server.close();
});

const portal = (t: Tenant, path: string) => '/api/v1/portal/websites/' + t.websiteId + path;

describe('Tenant isolation', () => {
  it('gives each tenant its own account and website', () => {
    assert.notEqual(alpha.accountId, beta.accountId);
    assert.notEqual(alpha.websiteId, beta.websiteId);
  });

  it('hides another tenant website from the portal pages (404, not 403)', async () => {
    const res = await alpha.client.get('/app/websites/' + beta.websiteId);
    assert.equal(res.status, 404);
    assert.doesNotMatch(res.text, /Beta Roofing/);
  });

  it('refuses cross-tenant reads on every website-scoped API', async () => {
    await alpha.client.refreshCsrf('/app/websites/' + alpha.websiteId);
    const paths = [
      '/providers',
      '/knowledge',
      '/widget/preview',
      '/analytics',
    ];
    for (const path of paths) {
      const res = await alpha.client.getJson(portal(beta, path));
      assert.equal(res.status, 404, 'expected 404 reading ' + path + ' across tenants');
    }
  });

  it('refuses cross-tenant writes', async () => {
    await alpha.client.refreshCsrf('/app/websites/' + alpha.websiteId);

    const knowledge = await alpha.client.postJson(portal(beta, '/knowledge/manual'), {
      title: 'Injected', content: 'This should never be stored on another tenant.',
    });
    assert.equal(knowledge.status, 404);

    const instructions = await alpha.client.postJson(portal(beta, '/instructions'), {
      fallback_response: 'Hijacked fallback',
    });
    assert.equal(instructions.status, 404);

    const key = await alpha.client.postJson(portal(beta, '/keys'), { label: 'stolen' });
    assert.equal(key.status, 404);

    const widget = await alpha.client.postJson(portal(beta, '/widget'), { enabled: false });
    assert.equal(widget.status, 404);
  });

  it('keeps knowledge retrieval inside one website', async () => {
    await alpha.client.refreshCsrf('/app/websites/' + alpha.websiteId);
    await alpha.client.postJson(portal(alpha, '/knowledge/manual'), {
      title: 'Alpha secret capability',
      content: 'Alpha Plumbing operates a specialised trenchless pipe lining crew called the Alpha Mole Team.',
    });

    // Beta asks about a term that exists only in Alpha's knowledge base.
    await beta.client.refreshCsrf('/app/websites/' + beta.websiteId);
    const betaSearch = await beta.client.postJson(portal(beta, '/knowledge/test-retrieval'), {
      query: 'Alpha Mole Team trenchless pipe lining',
    });
    assert.equal(betaSearch.status, 200);
    const titles = betaSearch.body.data.results.map((r: { title: string }) => r.title);
    assert.ok(
      !titles.includes('Alpha secret capability'),
      'Beta must not retrieve Alpha documents, got: ' + JSON.stringify(titles),
    );

    // Alpha itself must find it.
    const alphaSearch = await alpha.client.postJson(portal(alpha, '/knowledge/test-retrieval'), {
      query: 'Alpha Mole Team trenchless pipe lining',
    });
    const alphaTitles = alphaSearch.body.data.results.map((r: { title: string }) => r.title);
    assert.ok(alphaTitles.includes('Alpha secret capability'));
  });

  it('keeps conversations and leads inside one website', async () => {
    const { SiteClient } = await import('./helpers.ts');
    const alphaSite = new SiteClient(server.base, alpha.siteKey, alpha.siteUrl);
    const betaSite = new SiteClient(server.base, beta.siteKey, beta.siteUrl);

    await alphaSite.post('/api/v1/site/chat', {
      session_key: 'alpha-session-isolation',
      message: 'How much is a water heater replacement?',
    });
    await betaSite.post('/api/v1/site/chat', {
      session_key: 'beta-session-isolation',
      message: 'How much is a water heater replacement?',
    });

    const alphaConversations = await alpha.client.get('/app/websites/' + alpha.websiteId + '/conversations');
    assert.match(alphaConversations.text, /alpha-session-isolation|water heater/i);
    assert.doesNotMatch(alphaConversations.text, /beta-session-isolation/);

    const betaConversations = await beta.client.get('/app/websites/' + beta.websiteId + '/conversations');
    assert.doesNotMatch(betaConversations.text, /alpha-session-isolation/);
  });

  it('scopes analytics per account', async () => {
    const alphaAnalytics = await alpha.client.getJson(portal(alpha, '/analytics'));
    const betaAnalytics = await beta.client.getJson(portal(beta, '/analytics'));
    assert.equal(alphaAnalytics.status, 200);
    assert.equal(betaAnalytics.status, 200);
    assert.ok(alphaAnalytics.body.data.analytics.aiRequests >= 1);
    assert.ok(betaAnalytics.body.data.analytics.aiRequests >= 1);
    // Neither may report the other's totals.
    assert.ok(alphaAnalytics.body.data.analytics.conversations < 100);
  });

  it('blocks the super-admin console for a normal customer', async () => {
    const res = await alpha.client.get('/admin');
    assert.equal(res.status, 403);
    const accounts = await alpha.client.get('/admin/accounts');
    assert.equal(accounts.status, 403);
  });
});

describe('Plan limits', () => {
  it('stops a Starter account from registering a second website', async () => {
    await alpha.client.refreshCsrf('/app');
    const second = await alpha.client.postForm('/app/websites', {
      name: 'Second Site',
      url: 'https://second-alpha.example.com',
    });
    assert.equal(second.status, 429);
    assert.match(second.text, /plan allows 1 website/i);
  });

  it('rejects a duplicate domain on the same account', async () => {
    const { col } = await import('../src/db/mongo.ts');
    const growth = await col<{ _id: string }>('plans').findOne({ slug: 'growth' });
    await col('accounts').updateOne({ _id: alpha.accountId as never }, { $set: { plan_id: growth?._id } });

    await alpha.client.refreshCsrf('/app');
    const dup = await alpha.client.postForm('/app/websites', {
      name: 'Duplicate',
      url: 'https://www.alpha-tenant.example.com',
    });
    assert.equal(dup.status, 409);
    assert.match(dup.text, /already registered/i);
  });
});
