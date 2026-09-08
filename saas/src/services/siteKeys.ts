/**
 * Chat Pilot Site API keys.
 *
 * Threat model
 * ------------
 *  - The plaintext key is generated once, shown once, and never stored.
 *    We keep HMAC-SHA256(SITE_KEY_PEPPER, key) plus a non-secret `key_id`
 *    embedded in the key itself so lookup is O(1) without a table scan.
 *  - A key authorises exactly one website, for exactly the site-scoped
 *    operations in /api/v1/site/*. It can never read another website, another
 *    account, or any portal/admin surface.
 *  - Presenting a key is not enough: the request must also come from a host
 *    registered to that website (see `authenticateSiteRequest`).
 */
import { db, nowIso } from '../db/index.ts';
import { AppError, notFound } from '../core/errors.ts';
import {
  constantTimeEqual,
  generateSiteKey,
  hashSiteKey,
  newId,
  parseSiteKeyId,
} from '../core/crypto.ts';
import { audit } from './audit.ts';
import { getWebsite, getWebsiteForAccount, hostIsAllowedForWebsite, type WebsiteRow } from './websites.ts';
import type { AccountRow } from './accounts.ts';

export interface SiteKeyRow {
  id: string;
  account_id: string;
  website_id: string;
  key_id: string;
  key_hash: string;
  key_prefix: string;
  last_four: string;
  label: string;
  status: 'active' | 'revoked';
  last_used_at: string | null;
  last_used_ip: string;
  revoked_at: string | null;
  created_at: string;
}

export function listSiteKeys(accountId: string, websiteId: string): SiteKeyRow[] {
  return db.all<SiteKeyRow>(
    `SELECT * FROM site_api_credentials
      WHERE website_id = ? AND account_id = ?
      ORDER BY created_at DESC`,
    websiteId,
    accountId,
  );
}

export interface IssuedKey {
  record: SiteKeyRow;
  /** Only present on creation. Never retrievable afterwards. */
  plaintext: string;
}

export function issueSiteKey(
  accountId: string,
  websiteId: string,
  label: string,
  actorId: string,
  opts: { live?: boolean; ip?: string } = {},
): IssuedKey {
  getWebsiteForAccount(accountId, websiteId); // tenancy check

  const generated = generateSiteKey(opts.live !== false);
  const id = newId();
  db.run(
    `INSERT INTO site_api_credentials
       (id, account_id, website_id, key_id, key_hash, key_prefix, last_four, label, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    id,
    accountId,
    websiteId,
    generated.keyId,
    generated.keyHash,
    opts.live !== false ? 'cp_live_' : 'cp_test_',
    generated.lastFour,
    label.trim() || 'Primary',
    nowIso(),
  );

  audit({
    accountId, websiteId, actorType: 'user', actorId,
    action: 'site_key.issued', targetType: 'site_api_credential', targetId: id,
    metadata: { label }, ip: opts.ip,
  });

  return { record: db.get<SiteKeyRow>('SELECT * FROM site_api_credentials WHERE id = ?', id)!, plaintext: generated.plaintext };
}

export function revokeSiteKey(accountId: string, websiteId: string, keyRecordId: string, actorId: string): void {
  const row = db.get<SiteKeyRow>(
    'SELECT * FROM site_api_credentials WHERE id = ? AND website_id = ? AND account_id = ?',
    keyRecordId, websiteId, accountId,
  );
  if (!row) throw notFound('API key not found.');
  db.run(
    "UPDATE site_api_credentials SET status = 'revoked', revoked_at = ? WHERE id = ?",
    nowIso(), keyRecordId,
  );
  audit({
    accountId, websiteId, actorType: 'user', actorId,
    action: 'site_key.revoked', targetType: 'site_api_credential', targetId: keyRecordId,
  });
}

/** Super-admin revocation (no membership required, always audited as admin). */
export function adminRevokeSiteKey(keyRecordId: string, actorId: string): void {
  const row = db.get<SiteKeyRow>('SELECT * FROM site_api_credentials WHERE id = ?', keyRecordId);
  if (!row) throw notFound('API key not found.');
  db.run("UPDATE site_api_credentials SET status = 'revoked', revoked_at = ? WHERE id = ?", nowIso(), keyRecordId);
  audit({
    accountId: row.account_id, websiteId: row.website_id, actorType: 'super_admin', actorId,
    action: 'site_key.admin_revoked', targetType: 'site_api_credential', targetId: keyRecordId,
  });
}

/* ------------------------------------------------------ authentication -- */

export interface SiteAuthContext {
  key: SiteKeyRow;
  website: WebsiteRow;
  account: AccountRow;
}

export interface SiteAuthInput {
  presentedKey: string;
  /** Host the plugin says it is serving from (from a signed field, not a header alone). */
  siteUrl: string;
  ip?: string;
  /** When false, the caller only wants identity, not a host check (e.g. /connect). */
  enforceDomain?: boolean;
}

/**
 * Resolves and fully authorises a site-key request.
 *
 * Order matters: identity first, then key state, then website state, then
 * account state, then subscription, then domain. Each failure has its own
 * error code so the plugin can show a specific, friendly status.
 */
export function authenticateSiteRequest(input: SiteAuthInput): SiteAuthContext {
  const presented = (input.presentedKey ?? '').trim();
  if (!presented) {
    throw new AppError('site_key_invalid', 'A Chat Pilot Site API Key is required.');
  }

  const keyId = parseSiteKeyId(presented);
  if (!keyId) {
    throw new AppError('site_key_invalid', 'That Site API Key is not recognised.');
  }

  const record = db.get<SiteKeyRow>('SELECT * FROM site_api_credentials WHERE key_id = ?', keyId);
  if (!record || !constantTimeEqual(record.key_hash, hashSiteKey(presented))) {
    throw new AppError('site_key_invalid', 'That Site API Key is not recognised.');
  }

  if (record.status !== 'active') {
    throw new AppError('site_key_revoked', 'This Site API Key has been revoked. Generate a new key in your Chat Pilot dashboard.');
  }

  const website = getWebsite(record.website_id);
  if (!website) {
    throw new AppError('site_key_invalid', 'That Site API Key is not recognised.');
  }
  if (website.status === 'suspended') {
    throw new AppError('website_disabled', 'This website has been suspended. Please contact Chat Pilot support.');
  }
  if (website.status !== 'active') {
    throw new AppError('website_disabled', 'This website is currently disabled in your Chat Pilot dashboard.');
  }

  const account = db.get<AccountRow>('SELECT * FROM accounts WHERE id = ?', record.account_id);
  if (!account) {
    throw new AppError('site_key_invalid', 'That Site API Key is not recognised.');
  }
  if (account.status !== 'active') {
    throw new AppError('account_suspended', 'This Chat Pilot account is suspended. Please contact support.');
  }

  const subscription = db.get<{ status: string; current_period_end: string }>(
    `SELECT status, current_period_end FROM subscriptions
      WHERE account_id = ? ORDER BY created_at DESC LIMIT 1`,
    account.id,
  );
  if (subscription && !['active', 'trialing'].includes(subscription.status)) {
    throw new AppError('subscription_inactive', 'This Chat Pilot subscription is not active. Please update billing to continue.');
  }

  if (input.enforceDomain !== false) {
    if (!hostIsAllowedForWebsite(website, input.siteUrl)) {
      audit({
        accountId: account.id, websiteId: website.id, actorType: 'site_key', actorId: record.id,
        action: 'site_key.domain_mismatch', metadata: { presented: input.siteUrl }, ip: input.ip,
      });
      throw new AppError(
        'domain_mismatch',
        'This Site API Key is registered to a different domain. Check the website URL in your Chat Pilot dashboard.',
      );
    }
  }

  db.run(
    'UPDATE site_api_credentials SET last_used_at = ?, last_used_ip = ? WHERE id = ?',
    nowIso(),
    (input.ip ?? '').slice(0, 45),
    record.id,
  );

  return { key: record, website, account };
}

/** Marks a successful plugin handshake. */
export function recordConnection(websiteId: string, pluginVersion: string): void {
  db.run(
    'UPDATE websites SET last_connected_at = ?, connected_plugin_ver = ?, verified_at = COALESCE(verified_at, ?), updated_at = ? WHERE id = ?',
    nowIso(), pluginVersion.slice(0, 30), nowIso(), nowIso(), websiteId,
  );
}
