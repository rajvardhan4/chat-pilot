import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
let site: SiteClient;

const portal = (path: string) => '/api/v1/portal/websites/' + tenant.websiteId + path;

before(async () => {
  server = await startServer();
  tenant = await createTenant(server.base, { domain: 'forms.example.com' });
  await seedKnowledge(tenant);
  site = new SiteClient(server.base, tenant.siteKey, tenant.siteUrl);
});
after(async () => {
  await server.close();
});

describe('Widget configuration', () => {
  it('ships a default config with no secrets', async () => {
    const res = await site.get('/api/v1/site/config');
    assert.equal(res.status, 200);
    const widget = res.body.data.widget;
    assert.equal(widget.enabled, true);
    assert.equal(widget.position, 'bottom-right');
    // A new website starts on the Chat Pilot brand blue, not on whatever the
    // previous design happened to use.
    assert.equal(widget.primaryColor, '#0678f9');
    assert.ok(Array.isArray(widget.suggestedQuestions));
    assert.equal(widget.prechat.enabled, true);
    assert.ok(widget.prechat.fields.length >= 2);
  });

  it('propagates a settings change to the plugin payload', async () => {
    await tenant.client.refreshCsrf('/app/websites/' + tenant.websiteId + '/widget');
    const saved = await tenant.client.postJson(portal('/widget'), {
      display_name: 'Riverton Assistant',
      primary_color: '#a855f7',
      position: 'bottom-left',
      welcome_message: 'Welcome to Riverton Plumbing.',
      suggested_questions: 'What do you charge?\nWhere do you work?',
      auto_open_chat: true,
      auto_open_delay: 9,
    });
    assert.equal(saved.status, 200);

    const config = await site.get('/api/v1/site/config');
    const widget = config.body.data.widget;
    assert.equal(widget.displayName, 'Riverton Assistant');
    assert.equal(widget.primaryColor, '#a855f7');
    assert.equal(widget.position, 'bottom-left');
    assert.equal(widget.autoOpenChat, true);
    assert.equal(widget.autoOpenDelay, 9);
    assert.deepEqual(widget.suggestedQuestions, ['What do you charge?', 'Where do you work?']);
  });

  it('rejects an invalid colour and a non-https logo', async () => {
    await tenant.client.refreshCsrf('/app/websites/' + tenant.websiteId + '/widget');
    const badColour = await tenant.client.postJson(portal('/widget'), { primary_color: 'red' });
    assert.equal(badColour.status, 422);

    const badLogo = await tenant.client.postJson(portal('/widget'), {
      logo_url: 'javascript:alert(1)',
    });
    assert.equal(badLogo.status, 422);
  });

  it('stops answering when the widget is disabled', async () => {
    await tenant.client.refreshCsrf('/app/websites/' + tenant.websiteId + '/widget');
    await tenant.client.postJson(portal('/widget'), { enabled: false });

    const config = await site.get('/api/v1/site/config');
    assert.equal(config.body.data.widget.enabled, false);

    const chat = await site.post('/api/v1/site/chat', {
      session_key: 'widget-disabled-session', message: 'Are you there?',
    });
    assert.equal(chat.status, 403);
    assert.equal(chat.body.error.code, 'website_disabled');

    await tenant.client.refreshCsrf('/app/websites/' + tenant.websiteId + '/widget');
    await tenant.client.postJson(portal('/widget'), { enabled: true });
    assert.equal((await site.get('/api/v1/site/config')).body.data.widget.enabled, true);
  });
});

describe('Pre-chat forms', () => {
  let formId = '';
  let secondFormId = '';

  it('exposes the default form to the widget', async () => {
    const config = await site.get('/api/v1/site/config');
    const prechat = config.body.data.widget.prechat;
    formId = prechat.formId;
    assert.ok(formId);
    const keys = prechat.fields.map((f: { key: string }) => f.key);
    assert.deepEqual(keys, ['name', 'email', 'phone']);
    assert.equal(prechat.fields.find((f: any) => f.key === 'email').required, true);
  });

  it('rejects a submission that omits a required field', async () => {
    const res = await site.post('/api/v1/site/forms/submit', {
      form_id: formId,
      session_key: 'form-session-required',
      fields: { name: 'Jane Doe' },
    });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'validation_failed');
    assert.match(JSON.stringify(res.body.error.fields), /email/i);
  });

  it('rejects a malformed email and phone', async () => {
    const badEmail = await site.post('/api/v1/site/forms/submit', {
      form_id: formId,
      session_key: 'form-session-bademail',
      fields: { name: 'Jane', email: 'not-an-email', phone: '5550142' },
    });
    assert.equal(badEmail.status, 422);
    assert.match(JSON.stringify(badEmail.body.error.fields), /valid email/i);

    const badPhone = await site.post('/api/v1/site/forms/submit', {
      form_id: formId,
      session_key: 'form-session-badphone',
      fields: { name: 'Jane', email: 'jane@example.com', phone: '12' },
    });
    assert.equal(badPhone.status, 422);
  });

  it('accepts a valid submission and stores the lead', async () => {
    const res = await site.post('/api/v1/site/forms/submit', {
      form_id: formId,
      session_key: 'form-session-valid',
      page_url: 'https://forms.example.com/contact',
      fields: { name: 'Jane Doe', email: 'jane@example.com', phone: '555-0142' },
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.submission_id);

    const row = await col<{ _id: string; name: string; email: string; website_id: string }>(
      'form_submissions',
    ).findOne({ _id: res.body.data.submission_id });
    assert.equal(row?.name, 'Jane Doe');
    assert.equal(row?.email, 'jane@example.com');
    assert.equal(row?.website_id, tenant.websiteId);
  });

  it('drops unknown fields instead of storing them', async () => {
    const res = await site.post('/api/v1/site/forms/submit', {
      form_id: formId,
      session_key: 'form-session-extra',
      fields: {
        name: 'Extra Fields',
        email: 'extra@example.com',
        phone: '555-0100',
        is_admin: 'true',
        injected_column: 'value',
      },
    });
    assert.equal(res.status, 200);
    const row = await col<{ _id: string; fields: string }>('form_submissions').findOne({
      _id: res.body.data.submission_id,
    });
    const stored = JSON.parse(row!.fields);
    assert.deepEqual(Object.keys(stored).sort(), ['email', 'name', 'phone']);
  });

  it('links the submission to the conversation on the same session', async () => {
    const session = 'form-linked-session';
    await site.post('/api/v1/site/forms/submit', {
      form_id: formId,
      session_key: session,
      fields: { name: 'Linked Visitor', email: 'linked@example.com', phone: '555-0199' },
    });

    const chat = await site.post('/api/v1/site/chat', {
      session_key: session, message: 'How much does drain cleaning cost?',
    });
    assert.equal(chat.status, 200);
    const conversationId = chat.body.data.conversation_id;

    const submission = await col<{ _id: string; conversation_id: string }>('form_submissions').findOne({
      session_key: session,
    });
    assert.equal(submission?.conversation_id, conversationId);

    const conversation = await col<{ _id: string; visitor_name: string; visitor_email: string }>(
      'conversations',
    ).findOne({ _id: conversationId as never });
    assert.equal(conversation?.visitor_name, 'Linked Visitor');
    assert.equal(conversation?.visitor_email, 'linked@example.com');
  });

  it('never mixes two visitors', async () => {
    await site.post('/api/v1/site/forms/submit', {
      form_id: formId, session_key: 'visitor-a-session',
      fields: { name: 'Visitor A', email: 'a@example.com', phone: '555-0001' },
    });
    await site.post('/api/v1/site/forms/submit', {
      form_id: formId, session_key: 'visitor-b-session',
      fields: { name: 'Visitor B', email: 'b@example.com', phone: '555-0002' },
    });
    await site.post('/api/v1/site/chat', { session_key: 'visitor-a-session', message: 'Question from A' });
    await site.post('/api/v1/site/chat', { session_key: 'visitor-b-session', message: 'Question from B' });

    const a = await col<{ _id: string; visitor_name: string }>('conversations').findOne({
      session_key: 'visitor-a-session',
    });
    const b = await col<{ _id: string; visitor_name: string }>('conversations').findOne({
      session_key: 'visitor-b-session',
    });
    assert.equal(a?.visitor_name, 'Visitor A');
    assert.equal(b?.visitor_name, 'Visitor B');
    assert.notEqual(a?._id, b?._id);

    const aMessages = await col<{ _id: string; content: string }>('messages')
      .find({ conversation_id: a!._id, role: 'user' })
      .toArray();
    assert.ok(aMessages.every((m) => !m.content.includes('from B')));
  });

  it('builds a custom form and switches the widget to it', async () => {
    await tenant.client.refreshCsrf('/app/websites/' + tenant.websiteId + '/forms');
    const created = await tenant.client.postJson(portal('/forms'), {
      name: 'Quote Request',
      status: 'active',
      fields: [
        { type: 'text', label: 'Full name', required: true, enabled: true },
        { type: 'email', label: 'Email', required: true, enabled: true },
        { type: 'dropdown', label: 'Service needed', options: 'Repair\nInstallation\nInspection', required: true, enabled: true },
        { type: 'textarea', label: 'Details', required: false, enabled: true },
      ],
    });
    assert.equal(created.status, 200);
    secondFormId = created.body.data.form.id;

    const activated = await tenant.client.postJson(portal('/forms/active'), { form_id: secondFormId });
    assert.equal(activated.status, 200);

    const config = await site.get('/api/v1/site/config');
    const prechat = config.body.data.widget.prechat;
    assert.equal(prechat.formId, secondFormId);
    const keys = prechat.fields.map((f: { key: string }) => f.key);
    assert.deepEqual(keys, ['full_name', 'email', 'service_needed', 'details']);
    const dropdown = prechat.fields.find((f: any) => f.key === 'service_needed');
    assert.deepEqual(dropdown.options, ['Repair', 'Installation', 'Inspection']);
  });

  it('validates dropdown values against the configured options', async () => {
    const invalid = await site.post('/api/v1/site/forms/submit', {
      form_id: secondFormId,
      session_key: 'dropdown-invalid-session',
      fields: { full_name: 'Test', email: 't@example.com', service_needed: 'Free Money' },
    });
    assert.equal(invalid.status, 422);

    const valid = await site.post('/api/v1/site/forms/submit', {
      form_id: secondFormId,
      session_key: 'dropdown-valid-session',
      fields: { full_name: 'Test', email: 't@example.com', service_needed: 'Installation' },
    });
    assert.equal(valid.status, 200);
  });

  it('rejects an unsupported field type at the API boundary', async () => {
    await tenant.client.refreshCsrf('/app/websites/' + tenant.websiteId + '/forms');
    const res = await tenant.client.postJson(portal('/forms'), {
      name: 'Bad Form',
      fields: [{ type: 'file_upload', label: 'Upload', required: false, enabled: true }],
    });
    assert.equal(res.status, 422);
  });

  it('turns the pre-chat form off entirely', async () => {
    await tenant.client.refreshCsrf('/app/websites/' + tenant.websiteId + '/forms');
    const off = await tenant.client.postJson(portal('/forms/active'), { form_id: '' });
    assert.equal(off.status, 200);

    const config = await site.get('/api/v1/site/config');
    assert.equal(config.body.data.widget.prechat.enabled, false);

    // Chat must still start normally with no form.
    const chat = await site.post('/api/v1/site/chat', {
      session_key: 'no-form-session', message: 'How much does drain cleaning cost?',
    });
    assert.equal(chat.status, 200);
    assert.equal(chat.body.data.status, 'success');
  });

  it('records a lead notification without blocking the submission', async () => {
    const count = await col('notifications').countDocuments({
      type: 'lead.created',
      website_id: tenant.websiteId,
    });
    assert.ok(count >= 1);
  });
});

describe('Conversations in the portal', () => {
  it('lists the conversation with the right visitor and transcript', async () => {
    const conversation = await col<{ _id: string }>('conversations').findOne({
      website_id: tenant.websiteId,
      session_key: 'form-linked-session',
    });
    const page = await tenant.client.get(
      '/app/websites/' + tenant.websiteId + '/conversations/' + conversation!._id,
    );
    assert.equal(page.status, 200);
    assert.match(page.text, /Linked Visitor/);
    assert.match(page.text, /drain cleaning/i);
    assert.doesNotMatch(page.text, /Visitor B/);
  });

  it('updates conversation status and read state', async () => {
    const conversation = await col<{ _id: string }>('conversations').findOne({
      website_id: tenant.websiteId,
      session_key: 'form-linked-session',
    });
    await tenant.client.refreshCsrf('/app/websites/' + tenant.websiteId + '/conversations');
    const status = await tenant.client.postJson(
      portal('/conversations/' + conversation!._id + '/status'), { status: 'completed' },
    );
    assert.equal(status.status, 200);

    const row = await col<{ _id: string; status: string }>('conversations').findOne({
      _id: conversation!._id as never,
    });
    assert.equal(row?.status, 'completed');
  });
});
