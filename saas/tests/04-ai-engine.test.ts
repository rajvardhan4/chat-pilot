import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
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

const portal = (path: string) => '/api/v1/portal/websites/' + tenant.websiteId + path;

/** Drives the Developer Chat Preview, which returns full diagnostics. */
async function preview(sessionKey: string, message: string) {
  await tenant.client.refreshCsrf('/app/websites/' + tenant.websiteId + '/preview');
  const res = await tenant.client.postJson(portal('/preview/chat'), {
    session_key: sessionKey,
    message,
  });
  assert.equal(res.status, 200, 'preview chat failed: ' + res.text.slice(0, 300));
  return res.body.data as {
    text: string;
    status: string;
    conversationId: string;
    diagnostics: Record<string, any>;
  };
}

before(async () => {
  server = await startServer();
  tenant = await createTenant(server.base, { domain: 'engine.example.com', company: 'Riverton Plumbing' });
  await seedKnowledge(tenant);
  site = new SiteClient(server.base, tenant.siteKey, tenant.siteUrl);
});
after(async () => {
  await server.close();
});

describe('Retrieval', () => {
  it('answers a direct business question from the knowledge base', async () => {
    const result = await preview('direct-1', 'How much does water heater replacement cost?');
    assert.equal(result.status, 'success');
    assert.match(result.text, /1,200|2,400/);
    assert.equal(result.diagnostics.intent, 'knowledge');
    assert.ok(result.diagnostics.documents.length > 0);
  });

  it('understands a paraphrase of the same question', async () => {
    const result = await preview('paraphrase-1', 'What do you charge to swap out a hot water tank?');
    assert.ok(
      result.diagnostics.documents.some((d: { title: string }) => /water heater/i.test(d.title)),
      'expected the water heater document, got: ' +
        JSON.stringify(result.diagnostics.documents.map((d: any) => d.title)),
    );
  });

  it('prefers an FAQ over other sources when both match', async () => {
    const result = await preview('faq-priority-1', 'Do you offer emergency callouts?');
    assert.equal(result.diagnostics.documents[0].sourceType, 'faq');
    assert.match(result.text, /24 hours|emergency|95/i);
  });

  it('returns the configured fallback when nothing relevant exists', async () => {
    const result = await preview('missing-1', 'Do you sell replacement guitar strings for a Stratocaster?');
    assert.equal(result.status, 'fallback');
    assert.equal(result.diagnostics.confidence, 'Fallback');
    assert.equal(result.diagnostics.documents.length, 0);
    assert.match(result.text, /couldn't find that information/i);
  });

  it('exposes retrieval scores through the diagnostics endpoint', async () => {
    await tenant.client.refreshCsrf('/app/websites/' + tenant.websiteId + '/knowledge');
    const res = await tenant.client.postJson(portal('/knowledge/test-retrieval'), {
      query: 'drain cleaning price',
    });
    assert.equal(res.status, 200);
    const results = res.body.data.results as Array<{ title: string; score: number; aboveThreshold: boolean }>;
    assert.ok(results.length > 0);
    assert.ok(results[0]!.score > 0);
    assert.ok(results.some((r) => /drain cleaning/i.test(r.title)));
  });
});

describe('Conversational context', () => {
  it('resolves a pronoun follow-up to the prior topic', async () => {
    const session = 'followup-cost';
    const first = await preview(session, 'Tell me about water heater replacement.');
    assert.equal(first.status, 'success');

    const second = await preview(session, 'How much does that cost?');
    assert.equal(second.diagnostics.usedContext, true, 'the follow-up should have used conversation context');
    assert.match(second.diagnostics.contextualQuery, /water|heater/i);
    assert.notEqual(second.status, 'fallback');
    assert.match(second.text, /1,200|2,400/);
  });

  it('resolves an elliptical duration follow-up', async () => {
    const session = 'followup-duration';
    await preview(session, 'What is involved in a water heater replacement?');
    const second = await preview(session, 'How long does it take?');
    assert.equal(second.diagnostics.usedContext, true);
    assert.notEqual(second.status, 'fallback');
    assert.match(second.text, /four hours|hours/i);
  });

  it('handles a bare "how much?" with no subject of its own', async () => {
    const session = 'followup-bare';
    await preview(session, 'Tell me about drain cleaning.');
    const second = await preview(session, 'How much?');
    assert.equal(second.diagnostics.usedContext, true);
    assert.match(second.diagnostics.contextualQuery, /drain|cleaning/i);
  });

  it('does not let the assistant introduce its own words into the topic', async () => {
    // The mock prefixes every answer with "Based on our information:". Words
    // that appear only in the assistant's prose must never end up in the
    // rewritten search query - they dilute retrieval and are visible to
    // administrators in the diagnostics.
    const session = 'followup-noise';
    const first = await preview(session, 'Tell me about water heater replacement.');
    assert.match(first.text, /Based on our information/);

    const second = await preview(session, 'How much does that cost?');
    assert.equal(second.diagnostics.usedContext, true);
    assert.doesNotMatch(second.diagnostics.contextualQuery, /\bbased\b/i);
    assert.doesNotMatch(second.diagnostics.contextualQuery, /\binformation\b/i);
    // The real topic still survives.
    assert.match(second.diagnostics.contextualQuery, /water|heater|replacement/i);
  });

  it('does not drag the old topic across a clear topic change', async () => {
    const session = 'topic-switch';
    await preview(session, 'Tell me about water heater replacement.');
    const switched = await preview(session, 'What areas do you serve?');
    assert.equal(switched.diagnostics.usedContext, false);
    assert.equal(switched.diagnostics.contextualQuery, 'What areas do you serve?');
    assert.match(switched.text, /Riverton|Oakvale|county/i);
  });

  it('carries no business vocabulary in the engine itself', async () => {
    // A second tenant in a completely different industry must get the same
    // quality of follow-up resolution with no shared vocabulary.
    const salon = await createTenant(server.base, { domain: 'salon.example.com', company: 'Bella Salon' });
    await salon.client.refreshCsrf('/app/websites/' + salon.websiteId);
    await salon.client.postJson('/api/v1/portal/websites/' + salon.websiteId + '/knowledge/manual', {
      title: 'Balayage colour service',
      content:
        'Our balayage colour service is a freehand highlighting technique. A full balayage appointment ' +
        'costs 210 dollars and takes around three hours, including a gloss and blow dry.',
    });

    await salon.client.refreshCsrf('/app/websites/' + salon.websiteId + '/preview');
    await salon.client.postJson('/api/v1/portal/websites/' + salon.websiteId + '/preview/chat', {
      session_key: 'salon-1', message: 'Tell me about the balayage colour service.',
    });
    const followUp = await salon.client.postJson(
      '/api/v1/portal/websites/' + salon.websiteId + '/preview/chat',
      { session_key: 'salon-1', message: 'How much does that cost?' },
    );
    assert.equal(followUp.status, 200);
    assert.equal(followUp.body.data.diagnostics.usedContext, true);
    assert.match(followUp.body.data.diagnostics.contextualQuery, /balayage|colour/i);
    assert.match(followUp.body.data.text, /210/);
  });
});

describe('Greetings and small talk', () => {
  it('answers a greeting without triggering the missing-knowledge fallback', async () => {
    const result = await preview('greeting-1', 'Hi');
    assert.equal(result.diagnostics.intent, 'greeting');
    assert.equal(result.status, 'success');
    assert.doesNotMatch(result.text, /couldn't find that information/i);
  });

  it('handles thanks as small talk', async () => {
    const result = await preview('smalltalk-1', 'Thanks!');
    assert.equal(result.diagnostics.intent, 'small_talk');
    assert.doesNotMatch(result.text, /couldn't find that information/i);
  });

  it('does not spend a provider call on a greeting', async () => {
    const before = db.get<{ c: number }>(
      "SELECT COUNT(*) AS c FROM ai_requests WHERE website_id = ? AND status = 'success' AND total_tokens > 0",
      tenant.websiteId,
    );
    await preview('greeting-2', 'Good morning');
    const after = db.get<{ c: number }>(
      "SELECT COUNT(*) AS c FROM ai_requests WHERE website_id = ? AND status = 'success' AND total_tokens > 0",
      tenant.websiteId,
    );
    assert.equal(Number(after?.c), Number(before?.c));
  });
});

describe('Provider failures are distinct from missing knowledge', () => {
  async function switchProviderKey(key: string) {
    await tenant.client.refreshCsrf('/app/websites/' + tenant.websiteId + '/providers');
    const saved = await tenant.client.postJson(portal('/providers/credentials'), {
      provider: 'mock', api_key: key,
    });
    assert.equal(saved.status, 200);
  }

  it('returns the generation-error message, not the knowledge fallback, on quota exhaustion', async () => {
    await switchProviderKey('mock-quota-x');
    const result = await preview('provider-quota', 'How much does water heater replacement cost?');

    assert.equal(result.status, 'provider_error');
    assert.equal(result.diagnostics.errorType, 'quota_exceeded');
    assert.equal(result.diagnostics.errorLabel, 'Quota Exceeded');
    assert.equal(result.diagnostics.httpStatus, 429);
    assert.match(result.text, /having trouble generating a response/i);
    assert.doesNotMatch(result.text, /couldn't find that information/i);
    // Knowledge WAS found - this is unambiguously a provider problem.
    assert.ok(result.diagnostics.documents.length > 0);
  });

  it('categorises an invalid credential separately', async () => {
    await switchProviderKey('mock-auth-x');
    const result = await preview('provider-auth', 'How much does drain cleaning cost?');
    assert.equal(result.diagnostics.errorType, 'authentication_error');
    assert.equal(result.diagnostics.httpStatus, 401);
  });

  it('categorises a timeout separately', async () => {
    await switchProviderKey('mock-timeout-x');
    const result = await preview('provider-timeout', 'How much does drain cleaning cost?');
    assert.equal(result.diagnostics.errorType, 'timeout_error');
  });

  it('categorises an unavailable model separately', async () => {
    await switchProviderKey('mock-badmodel-x');
    const result = await preview('provider-model', 'How much does drain cleaning cost?');
    assert.equal(result.diagnostics.errorType, 'model_unavailable');
    assert.equal(result.diagnostics.httpStatus, 404);
  });

  it('never leaks the provider error text to a website visitor', async () => {
    await switchProviderKey('mock-quota-y');
    const res = await site.post('/api/v1/site/chat', {
      session_key: 'visitor-provider-error',
      message: 'How much does water heater replacement cost?',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'provider_error');
    assert.match(res.body.data.text, /having trouble generating a response/i);
    assert.doesNotMatch(res.text, /quota|429|Resource has been exhausted|mock-quota/i);
  });

  it('records the failure for the administrator and throttles the alert', async () => {
    const requests = db.all<{ status: string; error_label: string }>(
      "SELECT status, error_label FROM ai_requests WHERE website_id = ? AND status = 'provider_error'",
      tenant.websiteId,
    );
    assert.ok(requests.length >= 4);
    assert.ok(requests.some((r) => r.error_label === 'Quota Exceeded'));

    const alerts = db.all<{ id: string }>(
      "SELECT id FROM notifications WHERE type = 'provider.failure' AND website_id = ?",
      tenant.websiteId,
    );
    // Four distinct error categories were provoked, and quota happened twice.
    // De-duplication must collapse the repeat rather than send five alerts.
    assert.ok(alerts.length <= 4, 'provider alerts should be de-duplicated, got ' + alerts.length);
    assert.ok(alerts.length >= 1);
  });

  it('recovers when a working key is restored', async () => {
    await switchProviderKey('mock-ok-restored');
    const result = await preview('provider-recovered', 'How much does water heater replacement cost?');
    assert.equal(result.status, 'success');
    assert.match(result.text, /1,200|2,400/);

    const credential = db.get<{ status: string }>(
      "SELECT status FROM ai_provider_credentials WHERE website_id = ? AND provider = 'mock'",
      tenant.websiteId,
    );
    assert.equal(credential?.status, 'connected');
  });
});

describe('Preview and widget share one engine', () => {
  it('produces the same answer through both surfaces', async () => {
    const question = 'How much does drain cleaning cost?';
    const fromPreview = await preview('parity-preview', question);
    const fromWidget = await site.post('/api/v1/site/chat', {
      session_key: 'parity-widget', message: question,
    });

    assert.equal(fromWidget.status, 200);
    assert.equal(fromPreview.status, 'success');
    assert.equal(fromWidget.body.data.status, 'success');
    assert.match(fromPreview.text, /180/);
    assert.match(fromWidget.body.data.text, /180/);
  });

  it('labels the conversation source correctly on each surface', () => {
    const previewRow = db.get<{ source: string }>(
      'SELECT source FROM conversations WHERE website_id = ? AND session_key = ?',
      tenant.websiteId, 'parity-preview',
    );
    const widgetRow = db.get<{ source: string }>(
      'SELECT source FROM conversations WHERE website_id = ? AND session_key = ?',
      tenant.websiteId, 'parity-widget',
    );
    assert.equal(previewRow?.source, 'preview');
    assert.equal(widgetRow?.source, 'widget');
  });
});

describe('Answer safety', () => {
  it('strips HTML from a model response before it reaches a visitor', async () => {
    // The mock echoes retrieved content, so injecting markup into knowledge
    // proves the output sanitiser runs on the generated answer.
    await tenant.client.refreshCsrf('/app/websites/' + tenant.websiteId + '/knowledge');
    await tenant.client.postJson(portal('/knowledge/manual'), {
      title: 'Xsstest widget policy',
      content: 'Our xsstest policy says <script>alert(1)</script> and <img src=x onerror=alert(2)> are documented.',
    });

    const res = await site.post('/api/v1/site/chat', {
      session_key: 'xss-session', message: 'What is the xsstest policy?',
    });
    assert.equal(res.status, 200);
    assert.doesNotMatch(res.body.data.text, /<script|onerror=|<img/i);
  });
});
