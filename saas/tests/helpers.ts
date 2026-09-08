/**
 * Test harness.
 *
 * Boots the real Express app on an ephemeral port and drives it over HTTP the
 * same way a browser or the WordPress plugin would. Nothing is stubbed except
 * the AI provider, which uses the deterministic mock adapter.
 */
import './setup.ts';

import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../src/app.ts';
import { db } from '../src/db/index.ts';
import { resetRateLimits } from '../src/middleware/security.ts';
import { resetNonceCache } from '../src/middleware/siteAuth.ts';

export interface TestServer {
  base: string;
  close(): Promise<void>;
}

export async function startServer(): Promise<TestServer> {
  const app = createApp();
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  resetRateLimits();
  resetNonceCache();
  return {
    base: 'http://127.0.0.1:' + port,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          db.close();
          resolve();
        });
      }),
  };
}

/* -------------------------------------------------------- portal client -- */

export interface HttpResponse<T = unknown> {
  status: number;
  headers: Headers;
  body: T;
  text: string;
}

/** Cookie-jar HTTP client that behaves like a browser session. */
export class PortalClient {
  private cookies = new Map<string, string>();
  csrfToken = '';

  private base: string;

  constructor(base: string) {
    this.base = base;
  }

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => k + '=' + v).join('; ');
  }

  private absorbCookies(res: Response): void {
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const cookie of raw) {
      const [pair] = cookie.split(';');
      const idx = (pair ?? '').indexOf('=');
      if (idx <= 0) continue;
      const name = (pair as string).slice(0, idx).trim();
      const value = (pair as string).slice(idx + 1).trim();
      if (value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async raw(
    method: string,
    path: string,
    options: { form?: Record<string, string>; json?: unknown; headers?: Record<string, string> } = {},
  ): Promise<HttpResponse<any>> {
    const headers: Record<string, string> = {
      Cookie: this.cookieHeader(),
      ...(options.headers ?? {}),
    };
    let body: string | undefined;

    if (options.form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const params = new URLSearchParams(options.form);
      if (this.csrfToken && !params.has('_csrf')) params.set('_csrf', this.csrfToken);
      body = params.toString();
    } else if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['X-Requested-With'] = 'XMLHttpRequest';
      if (this.csrfToken) headers['X-CSRF-Token'] = this.csrfToken;
      body = JSON.stringify(options.json);
    }

    const res = await fetch(this.base + path, { method, headers, body, redirect: 'manual' });
    this.absorbCookies(res);
    const text = await res.text();
    let parsed: unknown = text;
    if ((res.headers.get('content-type') ?? '').includes('application/json')) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: res.status, headers: res.headers, body: parsed, text };
  }

  get(path: string, headers?: Record<string, string>) {
    return this.raw('GET', path, { headers });
  }
  postForm(path: string, form: Record<string, string>) {
    return this.raw('POST', path, { form });
  }
  postJson(path: string, json: unknown) {
    return this.raw('POST', path, { json });
  }
  getJson(path: string) {
    return this.raw('GET', path, { headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } });
  }

  /** Reads the CSRF token the server embedded in the last rendered page. */
  async refreshCsrf(path = '/app'): Promise<string> {
    const res = await this.get(path);
    const match = /name="cp-csrf" content="([^"]+)"/.exec(res.text);
    this.csrfToken = match ? (match[1] as string) : '';
    return this.csrfToken;
  }

  hasSession(): boolean {
    return this.cookies.has('cp_session');
  }

  clearCookies(): void {
    this.cookies.clear();
    this.csrfToken = '';
  }
}

/* ---------------------------------------------------------- site client -- */

/**
 * Replicates, byte for byte, what the WordPress plugin sends: the Site API
 * Key, a timestamp, a nonce and an HMAC-SHA256 signature over
 * METHOD\nPATH\nTIMESTAMP\nNONCE\nsha256(body).
 *
 * Because this is an independent implementation of the signing scheme, a green
 * test here means the documented contract is correct, not just self-consistent.
 */
export class SiteClient {
  private base: string;
  siteKey: string;
  siteUrl: string;

  constructor(base: string, siteKey: string, siteUrl: string) {
    this.base = base;
    this.siteKey = siteKey;
    this.siteUrl = siteUrl;
  }

  private sign(method: string, path: string, bodyText: string) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString('hex');
    const bodyHash = createHash('sha256').update(bodyText).digest('hex');
    const canonical = [method.toUpperCase(), path, timestamp, nonce, bodyHash].join('\n');
    const signature = createHmac('sha256', this.siteKey).update(canonical).digest('hex');
    return { timestamp, nonce, signature };
  }

  async request(
    method: string,
    path: string,
    payload?: unknown,
    overrides: { siteUrl?: string; siteKey?: string; timestamp?: string; nonce?: string; signature?: string } = {},
  ): Promise<HttpResponse<any>> {
    const bodyText = payload === undefined ? '' : JSON.stringify(payload);
    const signed = this.sign(method, path, bodyText);

    const headers: Record<string, string> = {
      'X-Chat-Pilot-Key': overrides.siteKey ?? this.siteKey,
      'X-Chat-Pilot-Timestamp': overrides.timestamp ?? signed.timestamp,
      'X-Chat-Pilot-Nonce': overrides.nonce ?? signed.nonce,
      'X-Chat-Pilot-Signature': overrides.signature ?? signed.signature,
      'X-Chat-Pilot-Site': overrides.siteUrl ?? this.siteUrl,
      Accept: 'application/json',
    };
    if (payload !== undefined) headers['Content-Type'] = 'application/json';

    const res = await fetch(this.base + path, { method, headers, body: bodyText || undefined });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: res.status, headers: res.headers, body: parsed, text };
  }

  post(path: string, payload: unknown, overrides = {}) {
    return this.request('POST', path, payload, overrides);
  }
  get(path: string, overrides = {}) {
    return this.request('GET', path, undefined, overrides);
  }
}

/* ------------------------------------------------------------ fixtures -- */

export interface Tenant {
  client: PortalClient;
  email: string;
  password: string;
  accountId: string;
  websiteId: string;
  siteKey: string;
  siteUrl: string;
  domain: string;
}

let counter = 0;

/**
 * Creates a complete, working tenant: user + account + website + provider
 * credential + selected model + a Site API Key.
 */
export async function createTenant(
  base: string,
  options: { domain?: string; providerKey?: string; company?: string } = {},
): Promise<Tenant> {
  counter += 1;
  const suffix = counter + '-' + randomBytes(3).toString('hex');
  const domain = options.domain ?? 'tenant' + suffix + '.example.com';
  const email = 'owner' + suffix + '@example.com';
  const password = 'TestPassword123!';
  const client = new PortalClient(base);

  const signup = await client.postForm('/signup', {
    full_name: 'Owner ' + suffix,
    company_name: options.company ?? 'Company ' + suffix,
    email,
    password,
  });
  if (signup.status !== 302) {
    throw new Error('Signup failed (' + signup.status + '): ' + signup.text.slice(0, 300));
  }

  await client.refreshCsrf('/app');

  const created = await client.postForm('/app/websites', {
    name: 'Site ' + suffix,
    url: 'https://' + domain,
  });
  if (created.status !== 302) {
    throw new Error('Website creation failed (' + created.status + '): ' + created.text.slice(0, 300));
  }
  const location = created.headers.get('location') ?? '';
  const websiteId = (/\/app\/websites\/([^/?]+)/.exec(location) ?? [])[1] as string;
  if (!websiteId) throw new Error('Could not determine website id from ' + location);

  const accountRow = db.get<{ id: string }>(
    'SELECT a.id FROM accounts a JOIN websites w ON w.account_id = a.id WHERE w.id = ?',
    websiteId,
  );
  const accountId = accountRow?.id as string;

  await client.refreshCsrf('/app/websites/' + websiteId + '/providers');

  const saved = await client.postJson(
    '/api/v1/portal/websites/' + websiteId + '/providers/credentials',
    { provider: 'mock', api_key: options.providerKey ?? 'mock-ok-' + suffix },
  );
  if (saved.status !== 200) throw new Error('Saving credentials failed: ' + saved.text.slice(0, 300));

  const tested = await client.postJson(
    '/api/v1/portal/websites/' + websiteId + '/providers/test',
    { provider: 'mock' },
  );
  if (tested.status !== 200) throw new Error('Provider test failed: ' + tested.text.slice(0, 300));

  const selected = await client.postJson(
    '/api/v1/portal/websites/' + websiteId + '/providers/select',
    { provider: 'mock', model: 'mock-small' },
  );
  if (selected.status !== 200) throw new Error('Model selection failed: ' + selected.text.slice(0, 300));

  const key = await client.postJson('/api/v1/portal/websites/' + websiteId + '/keys', { label: 'Test' });
  if (key.status !== 200) throw new Error('Key issue failed: ' + key.text.slice(0, 300));

  return {
    client,
    email,
    password,
    accountId,
    websiteId,
    siteKey: key.body.data.key as string,
    siteUrl: 'https://' + domain,
    domain,
  };
}

/** Adds knowledge to a tenant via the portal API, as a real customer would. */
export async function seedKnowledge(tenant: Tenant): Promise<void> {
  const base = '/api/v1/portal/websites/' + tenant.websiteId;

  await tenant.client.postJson(base + '/knowledge/faq', {
    question: 'Do you offer emergency callouts?',
    answer: 'Yes. Emergency callouts are available 24 hours a day, 7 days a week, at a flat 95 dollar callout fee.',
  });

  await tenant.client.postJson(base + '/knowledge/manual', {
    title: 'Water heater replacement',
    content:
      'Water heater replacement covers removal of the old unit, supply and installation of a new tank or ' +
      'tankless heater, and disposal. A standard water heater replacement costs between 1,200 and 2,400 dollars ' +
      'and takes about four hours. Every water heater replacement includes a six year parts warranty.',
  });

  await tenant.client.postJson(base + '/knowledge/manual', {
    title: 'Drain cleaning service',
    content:
      'Drain cleaning clears blocked sinks, showers and main lines using motorised augers and hydro jetting. ' +
      'A standard drain cleaning visit costs 180 dollars and usually takes about ninety minutes.',
  });

  await tenant.client.postJson(base + '/knowledge/manual', {
    title: 'Contact and service areas',
    content:
      'You can reach our office on 555-0142 or by email at hello@' + tenant.domain + '. ' +
      'We serve Riverton, Oakvale and the surrounding county.',
  });
}

export { db };
