/**
 * Test environment.
 *
 * MUST be the first import in the harness. ES module imports are hoisted, so
 * assigning process.env inside helpers.ts would run *after* the application
 * modules had already read their configuration. Putting the assignments in
 * their own module and importing it first guarantees ordering.
 */
process.env.NODE_ENV = 'test';
process.env.CHAT_PILOT_ENABLE_MOCK_PROVIDER = 'true';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'a'.repeat(64);
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? 'b'.repeat(64);
process.env.SITE_KEY_PEPPER = process.env.SITE_KEY_PEPPER ?? 'c'.repeat(64);

// The IP rate limiter is shared across a whole test file; raise the auth window
// so ordinary fixtures do not trip it. Rate limiting has its own dedicated test
// that drives the limiter directly.
process.env.RATE_LIMIT_AUTH_PER_15MIN = process.env.RATE_LIMIT_AUTH_PER_15MIN ?? '1000';
process.env.RATE_LIMIT_CHAT_PER_MINUTE = process.env.RATE_LIMIT_CHAT_PER_MINUTE ?? '8';

export const TEST_ENV_READY = true;
