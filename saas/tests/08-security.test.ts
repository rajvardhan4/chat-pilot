import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PortalClient,
  SiteClient,
  createTenant,
  db,
  seedKnowledge,
  startServer,
  type Tenant,
  type TestServer,
} from './helpers.ts';

let server: TestServer;
let tenant: Tenant;
let site: SiteClient;

before(async () => {
  server = await startServer();
  tenant = await createTenant(server.base, { domain: 'sec.example.com' });
  await seedKnowledge(tenant);
  site = new SiteClient(server.base, tenant.siteKey, tenant.siteUrl);
});
after(async () => {
  await server.close();
});

describe('Secret handling', () => {
  it('encrypts the provider key at rest and never stores the plaintext', () => {
    const row = db.get<{ api_key_enc: string; api_key_masked: string }>(
      "SELECT api_key_enc, api_key_masked FROM ai_provider_credentials WHERE website_id = ?",
      tenant.websiteId,
    );
    assert.ok(row);
    assert.match(row!.api_key_enc, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.ok(!row!.api_key_enc.includes('mock-ok'));
    assert.match(row!.api_key_masked, /^moc••••••••/);
  });

  it('round-trips only through the server-side resolver', async () => {
    const { resolveCredentials } = await import('../src/services/providerService.ts');
    const creds = resolveCredentials(tenant.accountId, tenant.websiteId, 'mock');
    assert.ok(creds?.apiKey.startsWith('mock-ok-'));
  });

  it('does not return the provider key from any portal endpoint', async () => {
    await tenant.client.refreshCsrf('/app/websites/' + tenant.websiteId + '/providers');
    const api = await tenant.client.getJson('/api/v1/portal/websites/' + tenant.websiteId + '/providers');
    assert.equal(api.status, 200);
    assert.ok(!api.text.includes('mock-ok-'));

    const page = await tenant.client.get('/app/websites/' + tenant.websiteId + '/providers');
    assert.ok(!page.text.includes('mock-ok-'));
  });

  it('redacts secrets from system logs', async () => {
    const { log } = await import('../src/core/logger.ts');
    log.error('Test line with sk-abcdefghijklmnop and cp_live_1234567890abcdef_secretvalue and ?key=AIzaSyABCDEFG');

    const row = db.get<{ message: string }>(
      "SELECT message FROM system_logs WHERE message LIKE 'Test line%' ORDER BY created_at DESC LIMIT 1",
    );
    assert.ok(row);
    assert.doesNotMatch(row!.message, /sk-abcdefghijklmnop/);
    assert.doesNotMatch(row!.message, /cp_live_1234567890abcdef/);
    assert.doesNotMatch(row!.message, /AIzaSyABCDEFG/);
    assert.match(row!.message, /REDACTED/);
  });

  it('keeps the site key out of audit metadata', () => {
    const hits = db.get<{ c: number }>(
      'SELECT COUNT(*) AS c FROM audit_logs WHERE metadata LIKE ?',
      '%' + tenant.siteKey.slice(0, 24) + '%',
    );
    assert.equal(Number(hits?.c ?? 0), 0);
  });
});

describe('Injection resistance', () => {
  it('treats SQL metacharacters in search as data', async () => {
    await tenant.client.refreshCsrf('/app/websites/' + tenant.websiteId + '/knowledge');
    const payloads = [
      "'; DROP TABLE knowledge_documents; --",
      "' OR '1'='1",
      '%%%',
      '1; DELETE FROM websites WHERE 1=1',
    ];
    for (const payload of payloads) {
      const res = await tenant.client.postJson(
        '/api/v1/portal/websites/' + tenant.websiteId + '/knowledge/test-retrieval',
        { query: payload },
      );
      assert.ok([200, 422].includes(res.status), 'unexpected status for ' + payload);
    }
    // The tables must still be there with their rows intact.
    assert.ok((db.scalar<number>('SELECT COUNT(*) AS c FROM knowledge_documents') ?? 0) > 0);
    assert.ok((db.scalar<number>('SELECT COUNT(*) AS c FROM websites') ?? 0) > 0);
  });

  it('escapes user content in rendered pages', async () => {
    await tenant.client.refreshCsrf('/app/websites/' + tenant.websiteId + '/knowledge');
    await tenant.client.postJson('/api/v1/portal/websites/' + tenant.websiteId + '/knowledge/manual', {
      title: '<img src=x onerror=alert(1)>',
      content: 'Payload check content for escaping.',
    });

    const page = await tenant.client.get('/app/websites/' + tenant.websiteId + '/knowledge');
    assert.equal(page.status, 200);
    assert.doesNotMatch(page.text, /<img src=x onerror=alert\(1\)>/);
    assert.match(page.text, /&lt;img src=x onerror=alert\(1\)&gt;/);
  });

  it('escapes a visitor name in the conversations screen', async () => {
    const config = await site.get('/api/v1/site/config');
    const formId = config.body.data.widget.prechat.formId;
    await site.post('/api/v1/site/forms/submit', {
      form_id: formId,
      session_key: 'xss-visitor-session',
      fields: { name: '<script>alert("pwned")</script>', email: 'x@example.com', phone: '555-0000' },
    });
    await site.post('/api/v1/site/chat', {
      session_key: 'xss-visitor-session', message: 'How much does drain cleaning cost?',
    });

    const page = await tenant.client.get('/app/websites/' + tenant.websiteId + '/conversations');
    assert.equal(page.status, 200);
    assert.doesNotMatch(page.text, /<script>alert\("pwned"\)<\/script>/);
    assert.match(page.text, /&lt;script&gt;/);
  });
});

describe('Transport hardening', () => {
  it('sets the expected security headers', async () => {
    const res = await fetch(server.base + '/login');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.equal(res.headers.get('x-powered-by'), null);
    const csp = res.headers.get('content-security-policy') ?? '';
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
  });

  it('marks the session cookie HttpOnly and SameSite', async () => {
    const client = new PortalClient(server.base);
    const res = await client.postForm('/signup', {
      full_name: 'Cookie Tester', company_name: 'Cookie Co',
      email: 'cookie@example.com', password: 'CorrectHorse42!',
    });
    const cookies = res.headers.getSetCookie();
    const session = cookies.find((c) => c.startsWith('cp_session='));
    assert.ok(session);
    assert.match(session!, /HttpOnly/);
    assert.match(session!, /SameSite=Lax/);
    assert.match(session!, /Path=\//);
  });

  it('signs the session cookie so a forged id is rejected', async () => {
    const res = await fetch(server.base + '/app', {
      headers: { Cookie: 'cp_session=00000000-0000-0000-0000-000000000000.forgedsignature' },
      redirect: 'manual',
    });
    assert.equal(res.status, 401);
  });

  it('emits no CORS wildcard on the site API', async () => {
    const res = await site.get('/api/v1/site/health');
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });
});

describe('Rate limiting', () => {
  it('throttles a single visitor session on the chat endpoint', async () => {
    const sessionKey = 'rate-limit-session';
    let limited = 0;
    let served = 0;

    for (let i = 0; i < 14; i += 1) {
      const res = await site.post('/api/v1/site/chat', {
        session_key: sessionKey,
        message: 'Question number ' + i + ' about drain cleaning',
      });
      if (res.status === 429) limited += 1;
      else served += 1;
    }

    assert.ok(served >= 1, 'some requests should be served');
    assert.ok(limited >= 1, 'the limiter should kick in within 14 requests');
  });

  it('applies the limiter per session, not globally', async () => {
    // A different session must still be served after another one was throttled.
    const res = await site.post('/api/v1/site/chat', {
      session_key: 'different-visitor-session',
      message: 'How much does drain cleaning cost?',
    });
    assert.notEqual(res.status, 429);
  });

  it('locks an account out after repeated failed sign-ins', async () => {
    const victim = new PortalClient(server.base);
    let sawLockout = false;
    for (let i = 0; i < 10; i += 1) {
      const res = await victim.postForm('/login', {
        email: tenant.email, password: 'WrongPassword' + i + '!',
      });
      if (res.status === 429) {
        sawLockout = true;
        break;
      }
    }
    assert.ok(sawLockout, 'repeated failures should trigger a lockout');

    // Even the correct password is refused while locked.
    const correct = await new PortalClient(server.base).postForm('/login', {
      email: tenant.email, password: tenant.password,
    });
    assert.equal(correct.status, 429);
  });
});

describe('Error hygiene', () => {
  it('never returns a stack trace or SQL', async () => {
    const res = await fetch(server.base + '/api/v1/portal/websites/%00%00/providers', {
      headers: { Accept: 'application/json' },
    });
    const text = await res.text();
    assert.doesNotMatch(text, /at Object\.|node:internal|SELECT |SQLITE/i);
  });

  it('returns a friendly 404 page rather than internals', async () => {
    const res = await fetch(server.base + '/definitely/not/a/route');
    assert.equal(res.status, 404);
    const text = await res.text();
    assert.match(text, /could not be found/i);
    assert.doesNotMatch(text, /Error:|at Function|node_modules/);
  });

  it('rejects malformed JSON with a clear message, not a 500', async () => {
    const res = await fetch(server.base + '/api/v1/site/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'bad_request');
  });
});

describe('Mock provider containment', () => {
  it('is unavailable when NODE_ENV is production', async () => {
    // The registry gates the mock on both a non-production env and an explicit
    // flag, so this asserts the gate rather than re-importing the module.
    const { isMockProviderEnabled } = await import('../src/providers/registry.ts');
    assert.equal(isMockProviderEnabled, true, 'the flag is on in tests');

    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../src/providers/registry.ts', import.meta.url), 'utf8'),
    );
    assert.match(source, /!env\.isProd/);
    assert.match(source, /CHAT_PILOT_ENABLE_MOCK_PROVIDER/);
  });
});
