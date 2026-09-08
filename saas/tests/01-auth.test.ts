import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PortalClient, startServer, type TestServer } from './helpers.ts';

let server: TestServer;

before(async () => {
  server = await startServer();
});
after(async () => {
  await server.close();
});

describe('Authentication', () => {
  it('rejects a weak signup password with a field error', async () => {
    const client = new PortalClient(server.base);
    const res = await client.postForm('/signup', {
      full_name: 'Weak Password',
      company_name: 'Weak Co',
      email: 'weak@example.com',
      password: 'short',
    });
    assert.equal(res.status, 422);
    assert.match(res.text, /at least 10 characters/i);
    assert.equal(client.hasSession(), false);
  });

  it('signs a new customer up and starts a session', async () => {
    const client = new PortalClient(server.base);
    const res = await client.postForm('/signup', {
      full_name: 'Ada Lovelace',
      company_name: 'Analytical Engines',
      email: 'ada@example.com',
      password: 'CorrectHorse42!',
    });
    assert.equal(res.status, 302);
    assert.equal(client.hasSession(), true);

    const dashboard = await client.get('/app');
    assert.equal(dashboard.status, 200);
    assert.match(dashboard.text, /Account overview/);
  });

  it('refuses a duplicate email address', async () => {
    const client = new PortalClient(server.base);
    const res = await client.postForm('/signup', {
      full_name: 'Impostor',
      company_name: 'Impostor Co',
      email: 'ada@example.com',
      password: 'CorrectHorse42!',
    });
    assert.equal(res.status, 409);
    assert.match(res.text, /already exists/i);
  });

  it('signs in with valid credentials and out again', async () => {
    const client = new PortalClient(server.base);
    const login = await client.postForm('/login', { email: 'ada@example.com', password: 'CorrectHorse42!' });
    assert.equal(login.status, 302);
    assert.equal(login.headers.get('location'), '/app');

    await client.refreshCsrf('/app');
    const logout = await client.postForm('/logout', {});
    assert.equal(logout.status, 302);

    const afterLogout = await client.get('/app');
    assert.equal(afterLogout.status, 401);
  });

  it('gives the same generic error for a wrong password and an unknown user', async () => {
    const a = new PortalClient(server.base);
    const b = new PortalClient(server.base);
    const wrongPassword = await a.postForm('/login', { email: 'ada@example.com', password: 'NotThePassword1!' });
    const unknownUser = await b.postForm('/login', { email: 'nobody@example.com', password: 'NotThePassword1!' });

    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownUser.status, 401);
    assert.match(wrongPassword.text, /Email or password is incorrect/);
    assert.match(unknownUser.text, /Email or password is incorrect/);
  });

  it('blocks the portal without a session', async () => {
    const client = new PortalClient(server.base);
    assert.equal((await client.get('/app')).status, 401);
    assert.equal((await client.get('/app/websites')).status, 401);
    assert.equal((await client.getJson('/api/v1/portal/websites/anything/providers')).status, 401);
  });

  it('does not leak account existence from the password reset form', async () => {
    const client = new PortalClient(server.base);
    const known = await client.postForm('/forgot-password', { email: 'ada@example.com' });
    const unknown = await client.postForm('/forgot-password', { email: 'ghost@example.com' });
    assert.equal(known.status, 200);
    assert.equal(unknown.status, 200);
    assert.match(known.text, /If that email address has a Chat Pilot account/);
    assert.match(unknown.text, /If that email address has a Chat Pilot account/);
  });

  it('completes a password reset and invalidates the old password', async () => {
    const client = new PortalClient(server.base);
    await client.postForm('/forgot-password', { email: 'ada@example.com' });

    const { col } = await import('../src/db/mongo.ts');
    const notification = await col<{ _id: string; body: string }>('notifications')
      .find({ type: 'auth.password_reset' })
      .sort({ created_at: -1 })
      .limit(1)
      .next();
    assert.ok(notification, 'a reset notification should have been recorded');
    const token = (/token=([A-Za-z0-9_-]+)/.exec(notification.body) ?? [])[1];
    assert.ok(token, 'the notification should carry a reset token');

    const reset = await client.postForm('/reset-password', { token: token as string, password: 'BrandNewPass99!' });
    assert.equal(reset.status, 302);

    const oldPassword = await new PortalClient(server.base).postForm('/login', {
      email: 'ada@example.com',
      password: 'CorrectHorse42!',
    });
    assert.equal(oldPassword.status, 401);

    const newPassword = await new PortalClient(server.base).postForm('/login', {
      email: 'ada@example.com',
      password: 'BrandNewPass99!',
    });
    assert.equal(newPassword.status, 302);
  });
});

describe('CSRF protection', () => {
  it('rejects a state-changing portal request without a CSRF token', async () => {
    const client = new PortalClient(server.base);
    await client.postForm('/signup', {
      full_name: 'CSRF Tester',
      company_name: 'CSRF Co',
      email: 'csrf@example.com',
      password: 'CorrectHorse42!',
    });
    // Deliberately do NOT refresh the CSRF token.
    client.csrfToken = '';
    const res = await client.postJson('/api/v1/portal/websites/whatever/providers/test', { provider: 'mock' });
    assert.equal(res.status, 403);
    assert.match(res.text, /stale|expired/i);
  });

  it('rejects a forged CSRF token', async () => {
    const client = new PortalClient(server.base);
    await client.postForm('/signup', {
      full_name: 'CSRF Two',
      company_name: 'CSRF Two Co',
      email: 'csrf2@example.com',
      password: 'CorrectHorse42!',
    });
    await client.refreshCsrf('/app');
    client.csrfToken = 'totally-made-up-token-value';
    const res = await client.postJson('/api/v1/portal/websites/whatever/providers/test', { provider: 'mock' });
    assert.equal(res.status, 403);
  });
});
