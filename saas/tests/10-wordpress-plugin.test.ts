/**
 * Cross-language integration test: the REAL WordPress plugin PHP against a REAL
 * Chat Pilot server.
 *
 * The plugin source is loaded on a minimal WordPress shim (tests/wp-harness) and
 * driven end to end. Nothing about the request signing, the connection state
 * machine, the AJAX guards or the widget markup is re-implemented here - this
 * executes the same files that ship to a customer site.
 *
 * If PHP is not on the machine the whole suite is skipped rather than silently
 * passing, and the skip is reported.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTenant, db, seedKnowledge, startServer, type Tenant, type TestServer } from './helpers.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = path.join(HERE, 'wp-harness', 'run.php');
const CLOUD_URL_HARNESS = path.join(HERE, 'wp-harness', 'run-cloud-url.php');
const DOMAIN = 'wp-harness.example.com';
const SITE_URL = 'https://' + DOMAIN;
const PLUGIN_ROOT = path.join(HERE, '..', '..', 'wordpress-plugin', 'chat-pilot');

/**
 * The plugin's own version, read from its source.
 *
 * Hardcoding it here would mean every release breaks these tests for no reason,
 * and - worse - that someone would "fix" them by editing the number rather than
 * checking what the plugin actually reported.
 */
const PLUGIN_VERSION = (() => {
  const source = readFileSync(path.join(PLUGIN_ROOT, 'chat-pilot.php'), 'utf8');
  const match = source.match(/define\(\s*'CHAT_PILOT_VERSION',\s*'([^']+)'/);
  if (!match) throw new Error('CHAT_PILOT_VERSION not found in chat-pilot.php');
  return match[1];
})();

/** Locates a PHP binary: CHAT_PILOT_PHP_BIN, then PATH. */
function findPhp(): string | null {
  const explicit = process.env.CHAT_PILOT_PHP_BIN;
  if (explicit && existsSync(explicit)) return explicit;
  for (const candidate of ['php', 'php.exe']) {
    try {
      execFileSync(candidate, ['-v'], { stdio: 'ignore' });
      return candidate;
    } catch {
      /* not on PATH */
    }
  }
  return null;
}

const PHP = findPhp();

let server: TestServer;
let tenant: Tenant;
let harness: Record<string, any> = {};
let cloudUrl: Record<string, any> = {};

before(async () => {
  if (!PHP) return;
  server = await startServer();
  tenant = await createTenant(server.base, { domain: DOMAIN, company: 'Harness Plumbing' });
  await seedKnowledge(tenant);

  // -n ignores any local php.ini, so the cURL extension has to be enabled
  // explicitly. Ask PHP itself where its binary lives rather than deriving it
  // from the invocation path, which may be a shell-mapped path PHP cannot
  // resolve on Windows.
  const realBinary = execFileSync(PHP, ['-r', 'echo PHP_BINARY;'], { encoding: 'utf8' }).trim();
  const extDir = path.join(path.dirname(realBinary), 'ext');

  const args = ['-n'];
  if (existsSync(extDir)) {
    args.push('-d', 'extension_dir=' + extDir, '-d', 'extension=curl');
  }
  /**
   * Runs one harness script and parses its JSON document.
   *
   * Must be async: the SaaS under test runs in THIS process, so blocking the
   * event loop with spawnSync would stop the server answering PHP entirely.
   */
  async function runHarness(script: string, extra: string[]): Promise<Record<string, any>> {
    const run = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(PHP!, [...args, script, ...extra], { timeout: 120_000 });
      let out = '';
      let err = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { out += chunk; });
      child.stderr.on('data', (chunk) => { err += chunk; });
      child.on('error', reject);
      child.on('close', () => resolve({ stdout: out, stderr: err }));
    });

    // Each harness prints one JSON document. Pick the last JSON-looking line so
    // a stray notice from a particular PHP build cannot break the parse.
    const jsonLine = run.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('{') && line.endsWith('}'))
      .pop();

    assert.ok(
      jsonLine,
      script + ' produced no JSON.\nstdout:\n' + run.stdout.slice(0, 1500) +
        '\nstderr:\n' + (run.stderr ?? '').slice(0, 1500),
    );
    return JSON.parse(jsonLine);
  }

  harness = await runHarness(HARNESS, [server.base, tenant.siteKey, SITE_URL]);
  cloudUrl = await runHarness(CLOUD_URL_HARNESS, [server.base, SITE_URL]);
});

after(async () => {
  if (server) await server.close();
});

describe('WordPress plugin against a live Chat Pilot server', { skip: PHP ? false : 'PHP is not installed on this machine' }, () => {
  it('activates and mints an ownership token', () => {
    assert.equal(harness.activate?.exception, undefined, JSON.stringify(harness.activate));
    assert.ok(harness.activate.site_token_length >= 16);
    assert.equal(harness.activate.plugin_version, PLUGIN_VERSION);
  });

  it('serves the ownership token from its REST route', () => {
    assert.equal(harness.rest_site_token.status, 200);
    assert.equal(harness.rest_site_token.match, true);
    assert.ok(harness.rest_site_token.token.length >= 16);
  });

  it('refuses an invalid Site API Key with friendly copy', () => {
    const step = harness.connect_invalid_key;
    assert.equal(step.success, false);
    assert.equal(step.code, 'site_key_invalid');
    assert.match(step.message, /not recognised/i);
    // Friendly copy only: no exception class, no stack frame, no API path,
    // no HTTP status and no echo of the rejected key.
    assert.doesNotMatch(step.message, /Exception|Fatal|Warning|Stack trace|\/api\/|\bcp_live_|\b40[0-9]\b/);
  });

  it('connects with a valid key and stores the state', () => {
    const step = harness.connect;
    assert.equal(step.success, true, JSON.stringify(step));
    assert.equal(step.code, 'connected');
    assert.equal(step.is_connected, true);
    assert.equal(step.domain, DOMAIN);
    assert.equal(step.account_name, 'Harness Plumbing');
    // The admin UI only ever sees a masked key.
    assert.match(step.masked_key, /^cp_live_.{6}\*{8}/);
    assert.ok(!step.masked_key.includes(tenant.siteKey));
  });

  it('records the handshake on the SaaS side', () => {
    const row = db.get<{ last_connected_at: string; connected_plugin_ver: string }>(
      'SELECT last_connected_at, connected_plugin_ver FROM websites WHERE id = ?',
      tenant.websiteId,
    );
    assert.ok(row?.last_connected_at);
    assert.equal(row?.connected_plugin_ver, PLUGIN_VERSION);
  });

  it('caches a widget config that carries no secrets', () => {
    const step = harness.widget_config;
    assert.equal(step.has_widget, true);
    assert.equal(step.enabled, true);
    assert.equal(step.prechat_enabled, true);
    assert.deepEqual(step.prechat_fields, ['name', 'email', 'phone']);
    assert.ok(step.fallback_message.length > 0);

    assert.equal(step.contains_site_key, false, 'the Site API Key must not be in the cached config');
    assert.equal(step.contains_provider_key, false, 'the provider key must never reach WordPress');
    assert.equal(step.contains_system_prompt, false, 'the system prompt stays on the server');
  });

  it('renders the v1 widget markup', () => {
    const step = harness.widget_markup;
    assert.equal(step.rendered, true);
    assert.equal(step.has_container, true);
    assert.equal(step.has_launcher, true);
    assert.equal(step.has_box, true);
    assert.equal(step.has_prechat, true);
    assert.equal(step.has_input, true);
    assert.equal(step.has_branding, true);
    assert.equal(step.leaks_secret, false, 'the widget markup must not contain the Site API Key');
  });

  it('enforces required pre-chat fields server-side', () => {
    const step = harness.prechat_missing_required;
    assert.equal(step.ajax_ok, false);
    assert.match(JSON.stringify(step.payload.fields ?? step.payload.message), /email/i);
  });

  it('accepts a valid pre-chat submission', () => {
    const step = harness.prechat_valid;
    assert.equal(step.ajax_ok, true, JSON.stringify(step));
    assert.ok(step.payload.submission_id);

    const row = db.get<{ name: string; email: string; website_id: string }>(
      'SELECT name, email, website_id FROM form_submissions WHERE id = ?',
      step.payload.submission_id,
    );
    assert.equal(row?.name, 'Harness Visitor');
    assert.equal(row?.email, 'harness@visitor.example');
    assert.equal(row?.website_id, tenant.websiteId);
  });

  it('answers a visitor question from that website knowledge', () => {
    const step = harness.chat_first;
    assert.equal(step.ajax_ok, true, JSON.stringify(step));
    assert.equal(step.payload.status, 'success');
    assert.match(step.payload.text, /1,200|2,400/);
    // The visitor payload is text + status only.
    assert.deepEqual(Object.keys(step.payload).sort(), ['status', 'text']);
  });

  it('keeps conversational context across a follow-up', () => {
    const step = harness.chat_followup;
    assert.equal(step.ajax_ok, true);
    assert.equal(step.payload.status, 'success');
    assert.match(step.payload.text, /four hours|hours/i);
  });

  it('returns the configured fallback for an unknown topic', () => {
    const step = harness.chat_missing_knowledge;
    assert.equal(step.ajax_ok, true);
    assert.equal(step.payload.status, 'fallback');
    assert.match(step.payload.text, /couldn't find that information/i);
  });

  it('refuses a chat request without a valid nonce', () => {
    const step = harness.chat_without_nonce;
    assert.equal(step.ajax_ok, false);
    assert.match(step.payload.message, /session expired|reload/i);
  });

  it('refuses connect without the required capability', () => {
    const step = harness.connect_without_capability;
    assert.equal(step.ajax_ok, false);
    assert.match(step.payload.message, /permission/i);
  });

  it('reads live health from the SaaS', () => {
    const step = harness.health;
    assert.equal(step.success, true, JSON.stringify(step));
    assert.equal(step.provider_configured, true);
    assert.ok(step.knowledge_documents >= 4);
    assert.equal(step.widget_enabled, true);
    assert.equal(step.website_status, 'active');
  });

  it('is rejected when the signature headers are missing', () => {
    const step = harness.signature_required;
    assert.equal(step.status, 401);
    assert.match(step.body, /signature/i);
  });

  it('never writes the Site API Key to the plugin log', () => {
    const step = harness.log_redaction;
    assert.equal(step.contains_site_key, false);
  });

  it('disconnects cleanly', () => {
    const step = harness.disconnect;
    assert.equal(step.success, true);
    assert.equal(step.key_cleared, true);
    assert.equal(step.is_connected, false);
  });

  it('stored the conversation against the right visitor and website', () => {
    const conversation = db.get<{
      website_id: string; account_id: string; source: string;
      visitor_name: string; visitor_email: string; message_count: number; page_url: string;
    }>(
      "SELECT * FROM conversations WHERE website_id = ? AND source = 'widget' ORDER BY created_at ASC LIMIT 1",
      tenant.websiteId,
    );
    assert.ok(conversation, 'a widget conversation should exist');
    assert.equal(conversation!.account_id, tenant.accountId);
    assert.equal(conversation!.visitor_name, 'Harness Visitor');
    assert.equal(conversation!.visitor_email, 'harness@visitor.example');
    assert.equal(conversation!.page_url, 'https://wp-harness.example.com/pricing');
    assert.ok(conversation!.message_count >= 4);
  });

  it('recorded usage and analytics for the plugin traffic', () => {
    const usage = db.get<{ messages: number; ai_requests: number; total_tokens: number }>(
      'SELECT messages, ai_requests, total_tokens FROM usage_records WHERE website_id = ?',
      tenant.websiteId,
    );
    assert.ok(Number(usage?.ai_requests) >= 3);
    assert.ok(Number(usage?.total_tokens) > 0);

    const sources = db.all<{ source: string; c: number }>(
      'SELECT source, COUNT(*) AS c FROM ai_requests WHERE website_id = ? GROUP BY source',
      tenant.websiteId,
    );
    assert.ok(sources.some((s) => s.source === 'widget'));
  });
});

/*
 * The contract the plugin's admin JavaScript depends on.
 *
 * wp_send_json_error() answers with a 4xx, which jQuery routes to its error
 * handler rather than its success handler. Every refusal below therefore has to
 * carry BOTH a non-2xx status and a message worth reading - and admin-script.js
 * has to read that message out of the error response. When it did not, every
 * refusal, however specific, reached the administrator as the generic
 * "Something went wrong. Please try again."
 */
describe('admin refusals reach the administrator intact', { skip: PHP ? false : 'PHP is not installed on this machine' }, () => {
  const refusals = () => [
    ['a malformed Site API Key', harness.connect_rejects_malformed_key, /cp_live_/],
    ['an empty Site API Key', harness.connect_rejects_empty_key, /paste/i],
    ['a non-http Cloud address', cloudUrl.rejects_non_http, /https:\/\//],
    ['a Cloud address with no host', cloudUrl.rejects_hostless, /https:\/\//],
    ['a caller without the capability', cloudUrl.refuses_without_capability, /permission/i],
  ] as Array<[string, any, RegExp]>;

  it('sends a non-2xx status on every refusal', () => {
    for (const [label, step] of refusals()) {
      assert.equal(step?.ajax_ok, false, label + ' should have been refused');
      assert.ok(
        step.ajax_status >= 400 && step.ajax_status < 500,
        label + ' returned status ' + step.ajax_status + ', which jQuery would treat as success',
      );
    }
  });

  it('sends an actionable message with every refusal', () => {
    for (const [label, step, pattern] of refusals()) {
      const message = step.payload?.message ?? step.message ?? '';
      assert.ok(message.length > 10, label + ' refused with no usable message');
      assert.match(message, pattern, label + ' did not say why');
      // Never a raw technical detail on an admin screen.
      assert.doesNotMatch(message, /Exception|Fatal|Stack trace|\bnull\b|Array\(/);
    }
  });

  it('the admin script reads the message out of the error response', async () => {
    const { readFile } = await import('node:fs/promises');
    const script = await readFile(path.join(PLUGIN_ROOT, 'assets', 'js', 'admin-script.js'), 'utf8');
    // The whole bug was an error handler that ignored the body it was given.
    assert.match(script, /error:\s*function\s*\(\s*jqXHR/);
    assert.match(script, /responseJSON/);
  });
});

/*
 * The Cloud address. Without this a site whose WordPress install was never
 * given a wp-config.php constant can only ever talk to the shipped default,
 * which is exactly the state that makes a correct Site API Key look broken.
 */
describe('the Chat Pilot Cloud address is configurable', { skip: PHP ? false : 'PHP is not installed on this machine' }, () => {
  it('falls back to the shipped default when nothing is saved', () => {
    assert.equal(cloudUrl.unpinned.is_pinned, false);
    assert.equal(cloudUrl.unpinned.saved, '');
    assert.equal(cloudUrl.unpinned.base, cloudUrl.unpinned.default);
  });

  it('saves an address and signs against it, trailing slash and all', () => {
    const step = cloudUrl.saves_and_takes_effect;
    assert.equal(step.ajax_ok, true, JSON.stringify(step));
    assert.equal(step.base, server.base);
    assert.equal(step.saved, server.base, 'the trailing slash should have been trimmed');
    assert.equal(cloudUrl.signs_against_the_saved_address.base, server.base);
  });

  it('clearing the field returns to the default', () => {
    const step = cloudUrl.clears_back_to_default;
    assert.equal(step.ajax_ok, true);
    assert.equal(step.saved, '');
    assert.equal(step.base, step.default);
  });

  it('a wp-config.php pin cannot be overridden from the admin screen', () => {
    // run.php defines CHAT_PILOT_API_URL before loading the plugin.
    assert.equal(harness.api_url_default.is_pinned, true);
    assert.equal(harness.api_url_saves.ajax_ok, false);
    assert.match(harness.api_url_saves.payload.message, /wp-config\.php/);
    assert.equal(harness.api_url_saves.saved, '', 'nothing should have been written');
    assert.equal(harness.api_url_saves.base_after, harness.api_url_default.base);
  });
});

/*
 * The plugin's own screens. Six of the eleven tabs it once carried were pages
 * of copy plus a link into Chat Pilot Cloud; they made the plugin look like it
 * edited data it does not own.
 */
describe('the plugin ships only the screens it owns', { skip: PHP ? false : 'PHP is not installed on this machine' }, () => {
  it('carries four tabs, all of them locally owned', () => {
    assert.deepEqual(harness.admin_tabs.tabs, ['dashboard', 'connection', 'widget', 'settings']);
  });

  it('still points at every Cloud screen it stopped mirroring', () => {
    for (const section of ['providers', 'knowledge', 'instructions', 'forms', 'conversations', 'analytics']) {
      assert.ok(
        harness.admin_tabs.destinations.includes(section),
        section + ' lost its link when its tab was removed',
      );
    }
  });
});

/*
 * The admin screens themselves. Every other check here exercises the AJAX
 * routes and the widget markup, all of which keep passing while a template
 * throws a notice or calls a helper that no longer exists - so the templates
 * are rendered and looked at.
 */
describe('every admin screen renders', { skip: PHP ? false : 'PHP is not installed on this machine' }, () => {
  it('renders each tab without a notice or a fatal', () => {
    for (const tab of ['dashboard', 'connection', 'widget', 'settings']) {
      const step = harness.render_templates[tab];
      assert.ok(step, tab + ' has no template');
      assert.equal(step.exists, true, tab + ' template is missing');
      assert.equal(step.error, '', tab + ' raised: ' + step.error);
      assert.ok(step.length > 500, tab + ' rendered only ' + step.length + ' bytes');
      assert.equal(step.has_card, true, tab + ' rendered no content');
    }
  });

  it('renders the shell with the brand and exactly the owned tabs', () => {
    const shell = harness.render_templates._shell;
    assert.equal(shell.error, '');
    assert.equal(shell.has_logo, true);
    assert.equal(shell.tab_links, 4, 'the tab strip should carry the four owned screens');
  });

  it('masks the Site API Key field and gives it a reveal button', () => {
    const connection = harness.render_templates.connection;
    assert.equal(connection.key_typed, true, 'the key field must be type=password');
    assert.equal(connection.plain_key, false, 'the key field must not render as plain text');
    assert.equal(connection.has_eye, true, 'the key field must carry its reveal button');
  });

  it('leaves the Connection tab as just the key', () => {
    // The Cloud endpoint is set once per install in wp-config.php, so the screen
    // a client sees is "paste your key" and nothing else to get wrong.
    assert.equal(harness.render_templates.connection.api_url_field, false);
  });
});

/*
 * Tab navigation. An unconnected click used to be bounced back to Connection,
 * which read as a dead tab: the click produced no visible response and nothing
 * on screen said why.
 */
describe('every tab opens, connected or not', { skip: PHP ? false : 'PHP is not installed on this machine' }, () => {
  for (const mode of ['connected', 'disconnected']) {
    it('resolves every tab to itself when ' + mode, () => {
      const resolved = harness.tab_access[mode].resolved;
      for (const [requested, got] of Object.entries(resolved)) {
        assert.equal(got, requested, 'asking for ' + requested + ' landed on ' + got + ' while ' + mode);
      }
    });
  }

  it('lands on Connection with no key and on Dashboard with one', () => {
    assert.equal(harness.tab_access.disconnected.landing, 'connection');
    assert.equal(harness.tab_access.connected.landing, 'dashboard');
  });

  it('explains itself instead of opening blank when there is nothing live', () => {
    assert.equal(harness.tab_access.disconnected.notice, true, 'no "not connected" panel');
    assert.equal(harness.tab_access.disconnected.notice_cta, true, 'the panel must link to Connection');
    // And it stays out of the way once the site is connected.
    assert.equal(harness.tab_access.connected.notice, false);
  });
});
