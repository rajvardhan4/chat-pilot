import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash, randomBytes } from 'node:crypto';
import {
  SiteClient,
  col,
  createTenant,
  seedKnowledge,
  startServer,
  type Tenant,
  type TestServer,
} from './helpers.ts';

let server: TestServer;
let tenant: Tenant;
let other: Tenant;
let site: SiteClient;

before(async () => {
  server = await startServer();
  tenant = await createTenant(server.base, { domain: 'site-api.example.com' });
  other = await createTenant(server.base, { domain: 'other-site.example.com' });
  await seedKnowledge(tenant);
  site = new SiteClient(server.base, tenant.siteKey, tenant.siteUrl);
});
after(async () => {
  await server.close();
});

describe('Site API key format', () => {
  it('issues a cp_live_ prefixed key and stores only its hash', async () => {
    assert.match(tenant.siteKey, /^cp_live_[0-9a-f]{16}_[A-Za-z0-9_-]{20,}$/);

    const rows = await col<{ _id: string; key_hash: string; key_id: string }>('site_api_credentials')
      .find({ website_id: tenant.websiteId })
      .toArray();
    assert.equal(rows.length, 1);
    // The plaintext must appear nowhere in the row.
    for (const row of rows) {
      assert.notEqual(row.key_hash, tenant.siteKey);
      assert.ok(!tenant.siteKey.includes(row.key_hash));
      assert.match(row.key_hash, /^[0-9a-f]{64}$/);
    }

    // And nowhere else in the database either.
    // Site keys are cp_live_<hex>_<base62-ish>: no regex metacharacters, so the
    // raw value is safe to use as a substring pattern here.
    const leakCount = await col('audit_logs').countDocuments({
      metadata: { $regex: tenant.siteKey },
    });
    assert.equal(leakCount, 0);
  });
});

describe('Site request authentication', () => {
  it('accepts a correctly signed request', async () => {
    const res = await site.post('/api/v1/site/connect', {
      site_url: tenant.siteUrl,
      plugin_version: '2.0.0',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'connected');
    assert.equal(res.body.data.website.domain, 'site-api.example.com');
  });

  it('rejects a missing key', async () => {
    const res = await fetch(server.base + '/api/v1/site/health');
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'site_key_invalid');
  });

  it('rejects an unknown key', async () => {
    const res = await site.get('/api/v1/site/health', { siteKey: 'cp_live_deadbeefdeadbeef_notarealkeyvalue' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'site_key_invalid');
  });

  it('rejects a valid key with a wrong signature', async () => {
    const res = await site.get('/api/v1/site/health', { signature: 'f'.repeat(64) });
    assert.equal(res.status, 401);
    assert.match(res.body.error.message, /signature is not valid/i);
  });

  it('rejects a stale timestamp (replay window)', async () => {
    const stale = String(Math.floor(Date.now() / 1000) - 3600);
    // Re-sign with the stale timestamp so only the freshness rule can fail.
    const nonce = randomBytes(16).toString('hex');
    const bodyHash = createHash('sha256').update('').digest('hex');
    const canonical = ['GET', '/api/v1/site/health', stale, nonce, bodyHash].join('\n');
    const signature = createHmac('sha256', tenant.siteKey).update(canonical).digest('hex');

    const res = await site.get('/api/v1/site/health', { timestamp: stale, nonce, signature });
    assert.equal(res.status, 401);
    assert.match(res.body.error.message, /expired|clock/i);
  });

  it('rejects a replayed nonce', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString('hex');
    const bodyHash = createHash('sha256').update('').digest('hex');
    const canonical = ['GET', '/api/v1/site/health', timestamp, nonce, bodyHash].join('\n');
    const signature = createHmac('sha256', tenant.siteKey).update(canonical).digest('hex');

    const first = await site.get('/api/v1/site/health', { timestamp, nonce, signature });
    assert.equal(first.status, 200);

    const replay = await site.get('/api/v1/site/health', { timestamp, nonce, signature });
    assert.equal(replay.status, 401);
    assert.match(replay.body.error.message, /already been processed/i);
  });

  it('rejects a tampered body even with a valid signature header', async () => {
    // Sign one payload, send another.
    const payload = { session_key: 'tamper-session', message: 'original question' };
    const bodyText = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString('hex');
    const bodyHash = createHash('sha256').update(bodyText).digest('hex');
    const canonical = ['POST', '/api/v1/site/chat', timestamp, nonce, bodyHash].join('\n');
    const signature = createHmac('sha256', tenant.siteKey).update(canonical).digest('hex');

    const res = await fetch(server.base + '/api/v1/site/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Chat-Pilot-Key': tenant.siteKey,
        'X-Chat-Pilot-Timestamp': timestamp,
        'X-Chat-Pilot-Nonce': nonce,
        'X-Chat-Pilot-Signature': signature,
        'X-Chat-Pilot-Site': tenant.siteUrl,
      },
      body: JSON.stringify({ session_key: 'tamper-session', message: 'SUBSTITUTED question' }),
    });
    assert.equal(res.status, 401);
  });
});

describe('Domain binding', () => {
  it('rejects a key presented from an unregistered domain', async () => {
    const res = await site.post(
      '/api/v1/site/connect',
      { site_url: 'https://attacker-site.example.net' },
      { siteUrl: 'https://attacker-site.example.net' },
    );
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'domain_mismatch');
  });

  it('accepts the www. variant of the registered domain', async () => {
    const res = await site.get('/api/v1/site/health', { siteUrl: 'https://www.site-api.example.com' });
    assert.equal(res.status, 200);
  });

  it('accepts an explicitly added additional domain and not others', async () => {
    await tenant.client.refreshCsrf('/app/websites/' + tenant.websiteId + '/connection');
    const added = await tenant.client.postForm(
      '/app/websites/' + tenant.websiteId + '/domains',
      { domain: 'staging.site-api.example.com' },
    );
    assert.equal(added.status, 302);

    const allowed = await site.get('/api/v1/site/health', { siteUrl: 'https://staging.site-api.example.com' });
    assert.equal(allowed.status, 200);

    const denied = await site.get('/api/v1/site/health', { siteUrl: 'https://dev.site-api.example.com' });
    assert.equal(denied.status, 403);
  });

  it('records a domain mismatch in the audit log', async () => {
    const count = await col('audit_logs').countDocuments({
      action: 'site_key.domain_mismatch',
      website_id: tenant.websiteId,
    });
    assert.ok(count >= 1);
  });

  it('does not let one tenant key address another tenant website', async () => {
    const crossSite = new SiteClient(server.base, tenant.siteKey, other.siteUrl);
    const res = await crossSite.get('/api/v1/site/health');
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'domain_mismatch');
  });
});

describe('Key and account lifecycle', () => {
  it('reports website disabled when the customer deactivates the site', async () => {
    await tenant.client.refreshCsrf('/app/websites/' + tenant.websiteId + '/connection');
    await tenant.client.postForm('/app/websites/' + tenant.websiteId + '/settings', {
      name: 'Site API Tenant',
      url: tenant.siteUrl,
      status: 'inactive',
    });

    const res = await site.get('/api/v1/site/health');
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'website_disabled');

    await tenant.client.refreshCsrf('/app/websites/' + tenant.websiteId + '/connection');
    await tenant.client.postForm('/app/websites/' + tenant.websiteId + '/settings', {
      name: 'Site API Tenant',
      url: tenant.siteUrl,
      status: 'active',
    });
    assert.equal((await site.get('/api/v1/site/health')).status, 200);
  });

  it('reports account suspended', async () => {
    await col('accounts').updateOne({ _id: tenant.accountId as never }, { $set: { status: 'suspended' } });
    const res = await site.get('/api/v1/site/health');
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'account_suspended');
    await col('accounts').updateOne({ _id: tenant.accountId as never }, { $set: { status: 'active' } });
  });

  it('reports subscription inactive', async () => {
    await col('subscriptions').updateOne({ account_id: tenant.accountId }, { $set: { status: 'canceled' } });
    const res = await site.get('/api/v1/site/health');
    assert.equal(res.status, 402);
    assert.equal(res.body.error.code, 'subscription_inactive');
    await col('subscriptions').updateOne({ account_id: tenant.accountId }, { $set: { status: 'active' } });
  });

  it('stops working the moment the key is revoked', async () => {
    assert.equal((await site.get('/api/v1/site/health')).status, 200);

    const record = await col<{ _id: string }>('site_api_credentials').findOne({
      website_id: tenant.websiteId,
      status: 'active',
    });
    await tenant.client.refreshCsrf('/app/websites/' + tenant.websiteId + '/connection');
    const revoked = await tenant.client.postJson(
      '/api/v1/portal/websites/' + tenant.websiteId + '/keys/' + record!._id + '/revoke', {},
    );
    assert.equal(revoked.status, 200);

    const res = await site.get('/api/v1/site/health');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'site_key_revoked');
  });

  it('works again with a freshly issued key', async () => {
    await tenant.client.refreshCsrf('/app/websites/' + tenant.websiteId + '/connection');
    const issued = await tenant.client.postJson(
      '/api/v1/portal/websites/' + tenant.websiteId + '/keys', { label: 'Replacement' },
    );
    assert.equal(issued.status, 200);
    tenant.siteKey = issued.body.data.key;
    site = new SiteClient(server.base, tenant.siteKey, tenant.siteUrl);
    assert.equal((await site.get('/api/v1/site/health')).status, 200);
  });
});

describe('Site API response hygiene', () => {
  it('never returns a provider key or internal detail', async () => {
    const config = await site.get('/api/v1/site/config');
    assert.equal(config.status, 200);
    const text = JSON.stringify(config.body);
    assert.ok(!text.includes('mock-ok-'), 'provider key must not appear in the config payload');
    assert.ok(!/api_key|api_key_enc|password_hash|key_hash/.test(text));
    // The system prompt is server-side only; only visitor-facing copy ships.
    assert.ok(!text.includes('GROUNDING'));
    assert.ok(config.body.data.messages.fallback.length > 0);
  });

  it('returns a stable, minimal chat payload', async () => {
    const res = await site.post('/api/v1/site/chat', {
      session_key: 'hygiene-session',
      message: 'Do you offer emergency callouts?',
    });
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body.data).sort(), ['conversation_id', 'status', 'text']);
    assert.match(res.body.data.text, /emergency|24 hours|95/i);
  });

  it('does not expose diagnostics to the site API', async () => {
    const res = await site.post('/api/v1/site/chat', {
      session_key: 'hygiene-session-2',
      message: 'What is drain cleaning?',
    });
    assert.equal(res.body.data.diagnostics, undefined);
  });
});
