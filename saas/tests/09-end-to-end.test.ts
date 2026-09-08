/**
 * The complete production path, driven exactly as a real customer and a real
 * WordPress plugin would drive it:
 *
 *   signup -> register website -> configure provider -> discover models ->
 *   select model -> build knowledge -> issue Site API Key -> plugin connects ->
 *   plugin fetches config -> visitor submits pre-chat form -> visitor chats ->
 *   answer is grounded in that website's knowledge -> conversation, usage and
 *   analytics are all recorded against the right tenant.
 *
 * Nothing is called in-process except the assertions: every step goes over HTTP.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PortalClient, SiteClient, db, startServer, type TestServer } from './helpers.ts';

let server: TestServer;

const customer = new (class {
  email = 'journey@rivertonplumbing.example';
  password = 'JourneyPass2026!';
  accountId = '';
  websiteId = '';
  siteKey = '';
  client!: PortalClient;
})();

const DOMAIN = 'rivertonplumbing.example';
const SITE_URL = 'https://' + DOMAIN;

before(async () => {
  server = await startServer();
  customer.client = new PortalClient(server.base);
});
after(async () => {
  await server.close();
});

describe('Chat Pilot end-to-end journey', () => {
  it('1. customer signs up', async () => {
    const res = await customer.client.postForm('/signup', {
      full_name: 'Dana Rivers',
      company_name: 'Riverton Plumbing',
      email: customer.email,
      password: customer.password,
    });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/app/websites/new?welcome=1');
    assert.equal(customer.client.hasSession(), true);
  });

  it('2. customer registers their website', async () => {
    await customer.client.refreshCsrf('/app/websites/new');
    const res = await customer.client.postForm('/app/websites', {
      name: 'Riverton Plumbing', url: SITE_URL,
    });
    assert.equal(res.status, 302);

    customer.websiteId = (/\/app\/websites\/([^/?]+)/.exec(res.headers.get('location') ?? '') ?? [])[1] as string;
    assert.ok(customer.websiteId);

    const row = db.get<{ account_id: string; primary_domain: string; status: string }>(
      'SELECT account_id, primary_domain, status FROM websites WHERE id = ?', customer.websiteId,
    );
    customer.accountId = row!.account_id;
    assert.equal(row?.primary_domain, DOMAIN);
    assert.equal(row?.status, 'active');
  });

  it('3. customer saves their own AI provider key (encrypted, write-only)', async () => {
    await customer.client.refreshCsrf('/app/websites/' + customer.websiteId + '/providers');
    const res = await customer.client.postJson(
      '/api/v1/portal/websites/' + customer.websiteId + '/providers/credentials',
      { provider: 'mock', api_key: 'mock-ok-journey-key' },
    );
    assert.equal(res.status, 200);
    assert.ok(!res.text.includes('mock-ok-journey-key'));

    const stored = db.get<{ api_key_enc: string; status: string }>(
      "SELECT api_key_enc, status FROM ai_provider_credentials WHERE website_id = ?", customer.websiteId,
    );
    assert.ok(!stored!.api_key_enc.includes('mock-ok-journey-key'));
    assert.equal(stored?.status, 'not_configured');
  });

  it('4. connection test succeeds and discovers real models', async () => {
    const res = await customer.client.postJson(
      '/api/v1/portal/websites/' + customer.websiteId + '/providers/test',
      { provider: 'mock' },
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.ok, true);
    assert.equal(res.body.data.status, 'connected');
    assert.ok(res.body.data.models.length >= 2);
    assert.ok(res.body.data.suggestedModel);

    const stored = db.get<{ status: string }>(
      "SELECT status FROM ai_provider_credentials WHERE website_id = ?", customer.websiteId,
    );
    assert.equal(stored?.status, 'connected');
  });

  it('5. customer selects a discovered model, and only a discovered one', async () => {
    const invalid = await customer.client.postJson(
      '/api/v1/portal/websites/' + customer.websiteId + '/providers/select',
      { provider: 'mock', model: 'gpt-imaginary-9' },
    );
    assert.equal(invalid.status, 422);

    const res = await customer.client.postJson(
      '/api/v1/portal/websites/' + customer.websiteId + '/providers/select',
      { provider: 'mock', model: 'mock-large' },
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.config.active_provider, 'mock');
    assert.equal(res.body.data.config.active_model, 'mock-large');
  });

  it('6. customer builds the knowledge base', async () => {
    await customer.client.refreshCsrf('/app/websites/' + customer.websiteId + '/knowledge');
    const base = '/api/v1/portal/websites/' + customer.websiteId;

    const faq = await customer.client.postJson(base + '/knowledge/faq', {
      question: 'Do you offer a warranty?',
      answer: 'Every installation carries a six year parts and labour warranty.',
    });
    assert.equal(faq.status, 200);

    const manual = await customer.client.postJson(base + '/knowledge/manual', {
      title: 'Bathroom refit service',
      content:
        'Our bathroom refit service covers design, removal of the old suite, plumbing, tiling and ' +
        'installation. A full bathroom refit costs from 6,500 dollars and takes about two weeks.',
    });
    assert.equal(manual.status, 200);
    assert.equal(manual.body.data.stats.totalDocuments, 2);
  });

  it('7. customer tunes the AI instructions', async () => {
    await customer.client.refreshCsrf('/app/websites/' + customer.websiteId + '/instructions');
    const res = await customer.client.postJson(
      '/api/v1/portal/websites/' + customer.websiteId + '/instructions',
      {
        business_name: 'Riverton Plumbing',
        tone: 'friendly',
        fallback_response: 'I could not find that in our information. Please call the office on 555-0142.',
      },
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.instructions.business_name, 'Riverton Plumbing');
  });

  it('8. customer verifies behaviour in the Developer Chat Preview', async () => {
    await customer.client.refreshCsrf('/app/websites/' + customer.websiteId + '/preview');
    const res = await customer.client.postJson(
      '/api/v1/portal/websites/' + customer.websiteId + '/preview/chat',
      { session_key: 'journey-preview', message: 'How much is a bathroom refit?' },
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'success');
    assert.match(res.body.data.text, /6,500/);
    assert.equal(res.body.data.diagnostics.provider, 'mock');
    assert.equal(res.body.data.diagnostics.model, 'mock-large');
    assert.ok(res.body.data.diagnostics.documents.length > 0);
  });

  it('9. customer generates the Site API Key (shown exactly once)', async () => {
    await customer.client.refreshCsrf('/app/websites/' + customer.websiteId + '/connection');
    const res = await customer.client.postJson(
      '/api/v1/portal/websites/' + customer.websiteId + '/keys', { label: 'Production' },
    );
    assert.equal(res.status, 200);
    customer.siteKey = res.body.data.key;
    assert.match(customer.siteKey, /^cp_live_/);

    // Reloading the page must not show it again.
    const page = await customer.client.get('/app/websites/' + customer.websiteId + '/connection');
    assert.ok(!page.text.includes(customer.siteKey));
    assert.match(page.text, /cp_live_/); // only the truncated hint
  });

  it('10. the WordPress plugin connects with that key', async () => {
    const site = new SiteClient(server.base, customer.siteKey, SITE_URL);
    const res = await site.post('/api/v1/site/connect', {
      site_url: SITE_URL, plugin_version: '2.0.0', wp_version: '6.7',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'connected');
    assert.equal(res.body.data.website.domain, DOMAIN);
    assert.equal(res.body.data.account.name, 'Riverton Plumbing');
    assert.ok(res.body.data.widget);

    const row = db.get<{ last_connected_at: string; connected_plugin_ver: string }>(
      'SELECT last_connected_at, connected_plugin_ver FROM websites WHERE id = ?', customer.websiteId,
    );
    assert.ok(row?.last_connected_at);
    assert.equal(row?.connected_plugin_ver, '2.0.0');
  });

  it('11. the plugin fetches widget config with no secrets in it', async () => {
    const site = new SiteClient(server.base, customer.siteKey, SITE_URL);
    const res = await site.get('/api/v1/site/config');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.widget.enabled, true);
    assert.equal(res.body.data.widget.prechat.enabled, true);
    assert.ok(!res.text.includes('mock-ok-journey-key'));
    assert.match(res.body.data.messages.fallback, /Please call the office/);
  });

  it('12. a visitor submits the pre-chat form', async () => {
    const site = new SiteClient(server.base, customer.siteKey, SITE_URL);
    const config = await site.get('/api/v1/site/config');
    const formId = config.body.data.widget.prechat.formId;

    const res = await site.post('/api/v1/site/forms/submit', {
      form_id: formId,
      session_key: 'journey-visitor-session',
      visitor_key: 'journey-visitor-session',
      page_url: SITE_URL + '/bathrooms',
      fields: { name: 'Sam Visitor', email: 'sam@visitor.example', phone: '555-0177' },
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.submission_id);
  });

  it('13. the visitor chats and gets a grounded answer', async () => {
    const site = new SiteClient(server.base, customer.siteKey, SITE_URL);
    const res = await site.post('/api/v1/site/chat', {
      session_key: 'journey-visitor-session',
      visitor_key: 'journey-visitor-session',
      page_url: SITE_URL + '/bathrooms',
      message: 'How much does a bathroom refit cost?',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'success');
    assert.match(res.body.data.text, /6,500/);
    assert.ok(res.body.data.conversation_id);
  });

  it('14. a follow-up keeps the topic', async () => {
    const site = new SiteClient(server.base, customer.siteKey, SITE_URL);
    const res = await site.post('/api/v1/site/chat', {
      session_key: 'journey-visitor-session',
      message: 'How long does that take?',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'success');
    assert.match(res.body.data.text, /two weeks/i);
  });

  it('15. the conversation is stored against the right visitor and website', () => {
    const conversation = db.get<{
      id: string; website_id: string; account_id: string; source: string;
      visitor_name: string; visitor_email: string; message_count: number; page_url: string;
    }>('SELECT * FROM conversations WHERE session_key = ?', 'journey-visitor-session');

    assert.equal(conversation?.website_id, customer.websiteId);
    assert.equal(conversation?.account_id, customer.accountId);
    assert.equal(conversation?.source, 'widget');
    assert.equal(conversation?.visitor_name, 'Sam Visitor');
    assert.equal(conversation?.visitor_email, 'sam@visitor.example');
    assert.equal(conversation?.message_count, 4);
    assert.equal(conversation?.page_url, SITE_URL + '/bathrooms');

    const submission = db.get<{ conversation_id: string }>(
      'SELECT conversation_id FROM form_submissions WHERE session_key = ?', 'journey-visitor-session',
    );
    assert.equal(submission?.conversation_id, conversation?.id);

    const transcript = db.all<{ role: string; content: string }>(
      'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY seq', conversation!.id,
    );
    assert.equal(transcript.length, 4);
    assert.equal(transcript[0]!.role, 'user');
    assert.match(transcript[0]!.content, /bathroom refit cost/i);
    assert.equal(transcript[1]!.role, 'assistant');
  });

  it('16. usage and analytics are recorded for this tenant', () => {
    const usage = db.get<{ messages: number; ai_requests: number; total_tokens: number; estimated_cost: number }>(
      'SELECT messages, ai_requests, total_tokens, estimated_cost FROM usage_records WHERE website_id = ?',
      customer.websiteId,
    );
    assert.ok(usage);
    assert.ok(Number(usage!.messages) >= 4);
    assert.ok(Number(usage!.ai_requests) >= 2);
    assert.ok(Number(usage!.total_tokens) > 0);

    const requests = db.all<{ provider: string; model: string; status: string; input_tokens: number }>(
      'SELECT provider, model, status, input_tokens FROM ai_requests WHERE website_id = ?',
      customer.websiteId,
    );
    assert.ok(requests.length >= 3);
    const widgetRequests = requests.filter((r) => r.status === 'success' && r.input_tokens > 0);
    assert.ok(widgetRequests.every((r) => r.provider === 'mock'));
    assert.ok(widgetRequests.some((r) => r.model === 'mock-large'));
  });

  it('17. the customer sees it all in the portal', async () => {
    const conversations = await customer.client.get(
      '/app/websites/' + customer.websiteId + '/conversations',
    );
    assert.equal(conversations.status, 200);
    assert.match(conversations.text, /Sam Visitor/);

    const leads = await customer.client.get('/app/websites/' + customer.websiteId + '/leads');
    assert.equal(leads.status, 200);
    assert.match(leads.text, /sam@visitor\.example/);

    const analytics = await customer.client.get('/app/websites/' + customer.websiteId + '/analytics');
    assert.equal(analytics.status, 200);
    assert.match(analytics.text, /Total Tokens/);
    assert.match(analytics.text, /Estimated Cost/);

    const overview = await customer.client.get('/app/websites/' + customer.websiteId);
    assert.equal(overview.status, 200);
    assert.match(overview.text, /Riverton Plumbing/);
    assert.match(overview.text, /mock-large/);

    const dashboard = await customer.client.get('/app');
    assert.equal(dashboard.status, 200);
    assert.match(dashboard.text, /Account overview/);
  });

  it('18. every portal page renders without error', async () => {
    const pages = [
      '', '/providers', '/knowledge', '/instructions', '/preview',
      '/widget', '/forms', '/leads', '/conversations', '/analytics', '/connection',
    ];
    for (const page of pages) {
      const res = await customer.client.get('/app/websites/' + customer.websiteId + page);
      assert.equal(res.status, 200, 'page failed: ' + (page || '(overview)'));
      // The brand lockup proves the shell rendered, not just the inner view.
      assert.match(res.text, /class="cp-logo-img"/);
      assert.match(res.text, /Chat Pilot Cloud/);
      // Day/night is part of the shell, so a page missing it is a broken shell.
      assert.match(res.text, /data-theme-set="dark"/);
      assert.doesNotMatch(res.text, /Something went wrong/);
    }
    for (const page of ['/app', '/app/websites', '/app/usage', '/app/billing', '/app/account', '/app/support']) {
      const res = await customer.client.get(page);
      assert.equal(res.status, 200, 'page failed: ' + page);
    }
  });

  it('19. the analytics CSV export works', async () => {
    const res = await customer.client.get(
      '/app/websites/' + customer.websiteId + '/analytics.csv?range=30days',
    );
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/csv/);
    assert.match(res.text, /date,conversations,ai_requests,tokens,estimated_cost/);
  });
});
