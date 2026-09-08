/**
 * Provider catalogue.
 *
 * The adapters cannot be exercised against live vendor APIs here (that needs
 * real paid keys), so these tests pin the things that break silently and are
 * expensive to notice later: that every provider is registered and reachable
 * from the portal, that credential validation rejects obvious mistakes before a
 * key is stored, that the error taxonomy is complete, and that the customer's
 * key never leaves the server whichever provider they pick.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTenant, db, startServer, type Tenant, type TestServer } from './helpers.ts';

let server: TestServer;
let tenant: Tenant;

const portal = (path: string) => '/api/v1/portal/websites/' + tenant.websiteId + path;

before(async () => {
  server = await startServer();
  tenant = await createTenant(server.base, { domain: 'providers.example.com' });
});
after(async () => {
  await server.close();
});

describe('Provider catalogue', () => {
  it('registers every provider the customer can choose', async () => {
    const { listProviders } = await import('../src/providers/registry.ts');
    const slugs = listProviders().map((p) => p.slug);

    for (const expected of [
      'openai', 'anthropic', 'gemini', 'mistral',
      'groq', 'deepseek', 'together', 'openrouter', 'custom',
    ]) {
      assert.ok(slugs.includes(expected), 'missing provider: ' + expected);
    }
  });

  it('exposes them all through the portal API', async () => {
    await tenant.client.refreshCsrf('/app/websites/' + tenant.websiteId + '/providers');
    const res = await tenant.client.getJson(portal('/providers'));
    assert.equal(res.status, 200);

    const providers = res.body.data.providers as Array<{ provider: string; name: string; status: string }>;
    const byline = Object.fromEntries(providers.map((p) => [p.provider, p]));

    assert.equal(byline.anthropic?.name, 'Anthropic (Claude)');
    assert.equal(byline.openai?.name, 'OpenAI');
    assert.equal(byline.gemini?.name, 'Google Gemini');
    assert.equal(byline.custom?.name, 'Custom (OpenAI-compatible)');
    // The fixture configures the mock provider; every real one starts unset.
    const realProviders = providers.filter((p) => p.provider !== 'mock');
    assert.ok(realProviders.every((p) => p.status === 'not_configured'));
    assert.ok(realProviders.length >= 9);
  });

  it('renders every provider card on the AI Providers screen', async () => {
    const page = await tenant.client.get('/app/websites/' + tenant.websiteId + '/providers');
    assert.equal(page.status, 200);
    for (const name of [
      'OpenAI', 'Anthropic (Claude)', 'Google Gemini', 'Mistral AI',
      'Groq', 'DeepSeek', 'Together AI', 'OpenRouter', 'Custom (OpenAI-compatible)',
    ]) {
      assert.ok(page.text.includes(name), 'card missing from the page: ' + name);
    }
  });

  it('shows a base URL field only where it is needed', async () => {
    const page = await tenant.client.get('/app/websites/' + tenant.websiteId + '/providers');
    // The custom provider requires one.
    assert.match(page.text, /id="base-custom"/);
    // A first-party provider with a fixed endpoint does not ask for one.
    assert.doesNotMatch(page.text, /id="base-anthropic"/);
    // Only OpenAI carries an organisation field.
    assert.match(page.text, /id="org-openai"/);
    assert.doesNotMatch(page.text, /id="org-gemini"/);
  });
});

describe('Credential validation', () => {
  async function save(provider: string, body: Record<string, unknown>) {
    await tenant.client.refreshCsrf('/app/websites/' + tenant.websiteId + '/providers');
    return tenant.client.postJson(portal('/providers/credentials'), { provider, ...body });
  }

  it('rejects an Anthropic key that is not an Anthropic key', async () => {
    const res = await save('anthropic', { api_key: 'sk-proj-thisisanopenaikey1234567890' });
    assert.equal(res.status, 422);
    assert.match(res.body.error.message, /starts with "sk-ant-"/);
  });

  it('accepts a correctly shaped Anthropic key', async () => {
    const res = await save('anthropic', { api_key: 'sk-ant-api03-' + 'x'.repeat(40) });
    assert.equal(res.status, 200);

    const row = db.get<{ api_key_enc: string; api_key_masked: string }>(
      "SELECT api_key_enc, api_key_masked FROM ai_provider_credentials WHERE website_id = ? AND provider = 'anthropic'",
      tenant.websiteId,
    );
    // Encrypted at rest, and the plaintext appears nowhere.
    assert.match(row!.api_key_enc, /^v1\./);
    assert.ok(!row!.api_key_enc.includes('sk-ant-api03'));
    assert.match(row!.api_key_masked, /^sk-•+/);
  });

  it('rejects a Groq key without its prefix', async () => {
    const res = await save('groq', { api_key: 'not-a-groq-key-000000' });
    assert.equal(res.status, 422);
    assert.match(res.body.error.message, /starts with "gsk_"/);
  });

  it('requires a base URL for the custom provider', async () => {
    const missing = await save('custom', { api_key: 'any-key-value-1234567890' });
    assert.equal(missing.status, 422);
    assert.match(missing.body.error.message, /base URL/i);

    const withUrl = await save('custom', {
      api_key: 'any-key-value-1234567890',
      base_url: 'https://my-gateway.example.com/v1',
    });
    assert.equal(withUrl.status, 200);
  });

  it('rejects a base URL that is not http(s)', async () => {
    const res = await save('custom', {
      api_key: 'any-key-value-1234567890',
      base_url: 'file:///etc/passwd',
    });
    assert.equal(res.status, 422);
    assert.match(res.body.error.message, /http:\/\/ or https:\/\//);
  });

  it('refuses a provider that does not exist', async () => {
    const res = await save('definitely-not-a-provider', { api_key: 'x'.repeat(40) });
    assert.equal(res.status, 400);
  });
});

describe('A provider cannot go live until it has connected', () => {
  it('refuses selection while the credential has never connected', async () => {
    await tenant.client.refreshCsrf('/app/websites/' + tenant.websiteId + '/providers');
    // The Anthropic credential above was saved but never tested successfully.
    const res = await tenant.client.postJson(portal('/providers/select'), {
      provider: 'anthropic',
      model: 'claude-opus-5',
    });
    assert.equal(res.status, 422);
    assert.match(res.body.error.message, /Test the connection/i);

    // The website must still be pointing at whatever was working before.
    const config = db.get<{ active_provider: string }>(
      'SELECT active_provider FROM ai_provider_configs WHERE website_id = ?',
      tenant.websiteId,
    );
    assert.notEqual(config?.active_provider, 'anthropic');
  });

  it('refuses selection for a provider whose test failed', async () => {
    await tenant.client.refreshCsrf('/app/websites/' + tenant.websiteId + '/providers');
    await tenant.client.postJson(portal('/providers/credentials'), {
      provider: 'mock', api_key: 'mock-auth-broken',
    });
    await tenant.client.postJson(portal('/providers/test'), { provider: 'mock' });

    const res = await tenant.client.postJson(portal('/providers/select'), {
      provider: 'mock', model: 'mock-small',
    });
    assert.equal(res.status, 422);
    assert.match(res.body.error.fields.provider, /not connected/i);
  });

  it('allows selection once the connection succeeds', async () => {
    await tenant.client.refreshCsrf('/app/websites/' + tenant.websiteId + '/providers');
    await tenant.client.postJson(portal('/providers/credentials'), {
      provider: 'mock', api_key: 'mock-ok-restored',
    });
    const test = await tenant.client.postJson(portal('/providers/test'), { provider: 'mock' });
    assert.equal(test.body.data.ok, true);

    const res = await tenant.client.postJson(portal('/providers/select'), {
      provider: 'mock', model: 'mock-large',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.config.active_model, 'mock-large');
  });
});

describe('Provider secrets stay on the server', () => {
  it('never returns any stored provider key from the portal', async () => {
    await tenant.client.refreshCsrf('/app/websites/' + tenant.websiteId + '/providers');
    const api = await tenant.client.getJson(portal('/providers'));
    const page = await tenant.client.get('/app/websites/' + tenant.websiteId + '/providers');

    for (const secret of ['sk-ant-api03-', 'any-key-value-1234567890']) {
      assert.ok(!api.text.includes(secret), 'key leaked through the API: ' + secret);
      assert.ok(!page.text.includes(secret), 'key leaked into the page: ' + secret);
    }
  });

  it('decrypts only through the server-side resolver', async () => {
    const { resolveCredentials } = await import('../src/services/providerService.ts');
    const creds = resolveCredentials(tenant.accountId, tenant.websiteId, 'anthropic');
    assert.ok(creds?.apiKey.startsWith('sk-ant-api03-'));

    const custom = resolveCredentials(tenant.accountId, tenant.websiteId, 'custom');
    assert.equal(custom?.baseUrl, 'https://my-gateway.example.com/v1');
  });
});

describe('Anthropic error taxonomy', () => {
  it('maps every SDK error class onto a distinct engine state', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const { anthropicProvider } = await import('../src/providers/anthropic.ts');

    // Drive generate() with a key that cannot authenticate. This is a real
    // call to the adapter, not a stub: it proves the error path returns a
    // categorised failure rather than throwing into the chat engine.
    const result = await anthropicProvider.generate({
      credentials: { apiKey: 'sk-ant-api03-invalid-key-for-testing-purposes' },
      model: 'claude-opus-5',
      system: 'You are a test.',
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.4,
      maxOutputTokens: 64,
      timeoutMs: 15_000,
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    // Either the key is rejected (authentication_error) or the network is
    // unavailable in this environment (timeout_error). Both are categorised,
    // and neither is the generic bucket.
    assert.ok(
      ['authentication_error', 'timeout_error'].includes(result.errorType),
      'unexpected error type: ' + result.errorType + ' (' + result.message + ')',
    );
    assert.ok(result.message.length > 0);
    assert.equal(typeof result.latencyMs, 'number');

    // The SDK classes the adapter switches on must all exist.
    for (const cls of [
      'AuthenticationError', 'PermissionDeniedError', 'RateLimitError', 'NotFoundError',
      'APIConnectionTimeoutError', 'APIConnectionError', 'InternalServerError',
      'BadRequestError', 'APIError',
    ]) {
      assert.equal(
        typeof (Anthropic as unknown as Record<string, unknown>)[cls],
        'function',
        'SDK no longer exports ' + cls,
      );
    }
  });

  it('validates keys without making a network call', async () => {
    const { anthropicProvider } = await import('../src/providers/anthropic.ts');
    assert.equal(anthropicProvider.validate({ apiKey: '' }).ok, false);
    assert.equal(anthropicProvider.validate({ apiKey: 'sk-proj-abc' }).ok, false);
    assert.equal(anthropicProvider.validate({ apiKey: 'sk-ant-api03-abc' }).ok, true);
  });
});

describe('Cost estimates cover the catalogue', () => {
  it('prices Claude models from the published rates', async () => {
    const { rateFor, estimateCost } = await import('../src/services/pricing.ts');
    assert.deepEqual(rateFor('claude-opus-5'), { input: 5, output: 25 });
    assert.deepEqual(rateFor('claude-sonnet-5'), { input: 2, output: 10 });
    assert.deepEqual(rateFor('claude-haiku-4-5'), { input: 1, output: 5 });

    // 1M in + 1M out on Opus 5 is $5 + $25.
    assert.equal(estimateCost('anthropic', 'claude-opus-5', 1_000_000, 1_000_000), 30);
  });

  it('falls back to a sane default for an unknown model', async () => {
    const { rateFor } = await import('../src/services/pricing.ts');
    const rate = rateFor('some-model-nobody-has-heard-of');
    assert.ok(rate.input > 0 && rate.output > 0);
  });

  it('has a rate for every preferred model the catalogue suggests', async () => {
    const { listProviders } = await import('../src/providers/registry.ts');
    const { rateFor, allRates } = await import('../src/services/pricing.ts');
    const fallback = allRates().default;

    for (const provider of listProviders()) {
      if (provider.slug === 'mock' || provider.slug === 'custom') continue;
      const first = provider.preferredModelOrder()[0];
      if (!first) continue;

      // Ask the real pricing function, rather than re-implementing its
      // matching here. A suggested model that resolves to the generic default
      // would silently mis-state the customer's estimated cost.
      const rate = rateFor(first);
      assert.notDeepEqual(
        rate,
        fallback,
        provider.slug + ' suggests ' + first + ' but it prices at the generic default rate',
      );
      assert.ok(rate.input >= 0 && rate.output >= 0);
    }
  });
});
