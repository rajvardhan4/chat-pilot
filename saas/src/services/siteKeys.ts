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
import { col, nowIso } from '../db/mongo.ts';
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

type SiteKeyDoc = Omit<SiteKeyRow, 'id'> & { _id: string };

function toSiteKeyRow(d: SiteKeyDoc): SiteKeyRow {
  const { _id, ...rest } = d;
  return { id: _id, ...rest };
}

export async function listSiteKeys(accountId: string, websiteId: string): Promise<SiteKeyRow[]> {
  const docs = await col<SiteKeyDoc>('site_api_credentials')
    .find({ website_id: websiteId, account_id: accountId })
    .sort({ created_at: -1 })
    .toArray();
  return docs.map(toSiteKeyRow);
}

export interface IssuedKey {
  record: SiteKeyRow;
  /** Only present on creation. Never retrievable afterwards. */
  plaintext: string;
}

export async function issueSiteKey(
  accountId: string,
  websiteId: string,
  label: string,
  actorId: string,
  opts: { live?: boolean; ip?: string } = {},
): Promise<IssuedKey> {
  await getWebsiteForAccount(accountId, websiteId); // tenancy check

  const generated = generateSiteKey(opts.live !== false);
  const id = newId();
  const doc: SiteKeyDoc = {
    _id: id,
    account_id: accountId,
    website_id: websiteId,
    key_id: generated.keyId,
    key_hash: generated.keyHash,
    key_prefix: opts.live !== false ? 'cp_live_' : 'cp_test_',
    last_four: generated.lastFour,
    label: label.trim() || 'Primary',
    status: 'active',
    last_used_at: null,
    last_used_ip: '',
    revoked_at: null,
    created_at: nowIso(),
  };
  await col<SiteKeyDoc>('site_api_credentials').insertOne(doc);

  await audit({
    accountId, websiteId, actorType: 'user', actorId,
    action: 'site_key.issued', targetType: 'site_api_credential', targetId: id,
    metadata: { label }, ip: opts.ip,
  });

  return { record: toSiteKeyRow(doc), plaintext: generated.plaintext };
}

export async function revokeSiteKey(
  accountId: string,
  websiteId: string,
  keyRecordId: string,
  actorId: string,
): Promise<void> {
  const row = await col<SiteKeyDoc>('site_api_credentials').findOne({
    _id: keyRecordId as never, website_id: websiteId, account_id: accountId,
  });
  if (!row) throw notFound('API key not found.');
  await col('site_api_credentials').updateOne(
    { _id: keyRecordId as never },
    { $set: { status: 'revoked', revoked_at: nowIso() } },
  );
  await audit({
    accountId, websiteId, actorType: 'user', actorId,
    action: 'site_key.revoked', targetType: 'site_api_credential', targetId: keyRecordId,
  });
}

/** Super-admin revocation (no membership required, always audited as admin). */
export async function adminRevokeSiteKey(keyRecordId: string, actorId: string): Promise<void> {
  const row = await col<SiteKeyDoc>('site_api_credentials').findOne({ _id: keyRecordId as never });
  if (!row) throw notFound('API key not found.');
  await col('site_api_credentials').updateOne(
    { _id: keyRecordId as never },
    { $set: { status: 'revoked', revoked_at: nowIso() } },
  );
  await audit({
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
export async function authenticateSiteRequest(input: SiteAuthInput): Promise<SiteAuthContext> {
  const presented = (input.presentedKey ?? '').trim();
  if (!presented) {
    throw new AppError('site_key_invalid', 'A Chat Pilot Site API Key is required.');
  }

  const keyId = parseSiteKeyId(presented);
  if (!keyId) {
    throw new AppError('site_key_invalid', 'That Site API Key is not recognised.');
  }

  const recordDoc = await col<SiteKeyDoc>('site_api_credentials').findOne({ key_id: keyId });
  if (!recordDoc || !constantTimeEqual(recordDoc.key_hash, hashSiteKey(presented))) {
    throw new AppError('site_key_invalid', 'That Site API Key is not recognised.');
  }
  const record = toSiteKeyRow(recordDoc);

  if (record.status !== 'active') {
    throw new AppError('site_key_revoked', 'This Site API Key has been revoked. Generate a new key in your Chat Pilot dashboard.');
  }

  const website = await getWebsite(record.website_id);
  if (!website) {
    throw new AppError('site_key_invalid', 'That Site API Key is not recognised.');
  }
  if (website.status === 'suspended') {
    throw new AppError('website_disabled', 'This website has been suspended. Please contact Chat Pilot support.');
  }
  if (website.status !== 'active') {
    throw new AppError('website_disabled', 'This website is currently disabled in your Chat Pilot dashboard.');
  }

  const accountDoc = await col<Omit<AccountRow, 'id'> & { _id: string }>('accounts').findOne({
    _id: record.account_id as never,
  });
  if (!accountDoc) {
    throw new AppError('site_key_invalid', 'That Site API Key is not recognised.');
  }
  const account: AccountRow = { id: accountDoc._id, ...accountDoc };
  if (account.status !== 'active') {
    throw new AppError('account_suspended', 'This Chat Pilot account is suspended. Please contact support.');
  }

  const subscription = await col<{ _id: string; status: string; current_period_end: string; created_at: string }>('subscriptions')
    .find({ account_id: account.id })
    .sort({ created_at: -1 })
    .limit(1)
    .next();
  if (subscription && !['active', 'trialing'].includes(subscription.status)) {
    throw new AppError('subscription_inactive', 'This Chat Pilot subscription is not active. Please update billing to continue.');
  }

  if (input.enforceDomain !== false) {
    if (!(await hostIsAllowedForWebsite(website, input.siteUrl))) {
      await audit({
        accountId: account.id, websiteId: website.id, actorType: 'site_key', actorId: record.id,
        action: 'site_key.domain_mismatch', metadata: { presented: input.siteUrl }, ip: input.ip,
      });
      throw new AppError(
        'domain_mismatch',
        'This Site API Key is registered to a different domain. Check the website URL in your Chat Pilot dashboard.',
      );
    }
  }

  await col('site_api_credentials').updateOne(
    { _id: record.id as never },
    { $set: { last_used_at: nowIso(), last_used_ip: (input.ip ?? '').slice(0, 45) } },
  );

  return { key: record, website, account };
}

/** Marks a successful plugin handshake. */
export async function recordConnection(websiteId: string, pluginVersion: string): Promise<void> {
  const now = nowIso();
  // A pipeline update (the array form) is what lets `verified_at` be set only
  // the first time - COALESCE(verified_at, ?) in the old SQL - atomically,
  // without a read-then-write race between two connections arriving together.
  await col('websites').updateOne({ _id: websiteId as never }, [
    {
      $set: {
        last_connected_at: now,
        connected_plugin_ver: pluginVersion.slice(0, 30),
        verified_at: { $ifNull: ['$verified_at', now] },
        updated_at: now,
      },
    },
  ]);
}
