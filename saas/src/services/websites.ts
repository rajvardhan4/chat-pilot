/**
 * Website registration and the per-website configuration records that every
 * other module hangs off (provider config, instructions, widget, default form).
 */
import { db, nowIso } from '../db/index.ts';
import { AppError, conflict, notFound, validationFailed } from '../core/errors.ts';
import { newId, randomToken } from '../core/crypto.ts';
import { canonicalHost, isLocalHost, normaliseHost } from '../core/domain.ts';
import { audit } from './audit.ts';
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_FALLBACK, DEFAULT_GENERATION_ERROR } from './instructionDefaults.ts';

export interface WebsiteRow {
  id: string;
  account_id: string;
  name: string;
  primary_domain: string;
  url: string;
  status: 'active' | 'inactive' | 'suspended';
  suspend_reason: string;
  timezone: string;
  verification_token: string;
  verified_at: string | null;
  last_connected_at: string | null;
  connected_plugin_ver: string;
  inactivity_timeout_minutes: number;
  retention_days: number;
  created_at: string;
  updated_at: string;
}

export function getWebsite(websiteId: string): WebsiteRow | undefined {
  return db.get<WebsiteRow>('SELECT * FROM websites WHERE id = ?', websiteId);
}

/** Tenant-scoped fetch. Never call getWebsite() directly from a route. */
export function getWebsiteForAccount(accountId: string, websiteId: string): WebsiteRow {
  const row = db.get<WebsiteRow>(
    'SELECT * FROM websites WHERE id = ? AND account_id = ?',
    websiteId,
    accountId,
  );
  if (!row) throw notFound('Website not found.');
  return row;
}

export function listWebsites(accountId: string): WebsiteRow[] {
  return db.all<WebsiteRow>(
    'SELECT * FROM websites WHERE account_id = ? ORDER BY created_at ASC',
    accountId,
  );
}

export function countWebsites(accountId: string): number {
  return db.scalar<number>('SELECT COUNT(*) AS c FROM websites WHERE account_id = ?', accountId) ?? 0;
}

export interface CreateWebsiteInput {
  accountId: string;
  name: string;
  url: string;
  timezone?: string;
  actorId: string;
  ip?: string;
}

export function createWebsite(input: CreateWebsiteInput): WebsiteRow {
  const host = normaliseHost(input.url);
  if (!host) {
    throw validationFailed('Enter a valid website URL, for example https://example.com', {
      url: 'Enter a valid website URL.',
    });
  }
  const canonical = canonicalHost(host);

  const clash = db.get<{ id: string }>(
    'SELECT id FROM websites WHERE account_id = ? AND primary_domain = ?',
    input.accountId,
    canonical,
  );
  if (clash) throw conflict('That domain is already registered on this account.');

  // Enforce the plan's website allowance.
  const limit = planLimitFor(input.accountId, 'max_websites');
  if (limit > 0 && countWebsites(input.accountId) >= limit) {
    throw new AppError(
      'usage_limit_reached',
      `Your plan allows ${limit} website${limit === 1 ? '' : 's'}. Upgrade to add more.`,
    );
  }

  const id = newId();
  const now = nowIso();
  const normalisedUrl = input.url.includes('://') ? input.url.trim() : 'https://' + host;

  db.tx(() => {
    db.run(
      `INSERT INTO websites (id, account_id, name, primary_domain, url, status, timezone,
                             verification_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      id,
      input.accountId,
      input.name.trim(),
      canonical,
      normalisedUrl,
      input.timezone ?? 'UTC',
      randomToken(16),
      now,
      now,
    );
    // Also allow the www. variant out of the box.
    db.run(
      'INSERT INTO website_domains (id, account_id, website_id, domain, created_at) VALUES (?, ?, ?, ?, ?)',
      newId(),
      input.accountId,
      id,
      'www.' + canonical,
      now,
    );
    seedWebsiteDefaults(input.accountId, id, input.name.trim());
  });

  audit({
    accountId: input.accountId,
    websiteId: id,
    actorType: 'user',
    actorId: input.actorId,
    action: 'website.created',
    targetType: 'website',
    targetId: id,
    metadata: { domain: canonical },
    ip: input.ip,
  });

  return getWebsite(id)!;
}

/** Creates the config rows a website cannot function without. */
export function seedWebsiteDefaults(accountId: string, websiteId: string, businessName: string): void {
  const now = nowIso();

  db.run(
    `INSERT INTO ai_provider_configs (id, account_id, website_id, active_provider, active_model, created_at, updated_at)
     VALUES (?, ?, ?, '', '', ?, ?)`,
    newId(), accountId, websiteId, now, now,
  );

  db.run(
    `INSERT INTO ai_instructions (id, account_id, website_id, business_name, system_prompt,
                                  fallback_response, generation_error_response, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId(), accountId, websiteId, businessName,
    DEFAULT_SYSTEM_PROMPT, DEFAULT_FALLBACK, DEFAULT_GENERATION_ERROR, now, now,
  );

  db.run(
    `INSERT INTO widget_settings (id, account_id, website_id, display_name, suggested_questions, created_at, updated_at)
     VALUES (?, ?, ?, 'Chat Pilot', ?, ?, ?)`,
    newId(), accountId, websiteId,
    'What services do you provide?\nWhat areas do you serve?\nHow can I contact you?',
    now, now,
  );

  // Default pre-chat form, mirroring the plugin's seeded form.
  const formId = newId();
  db.run(
    `INSERT INTO forms (id, account_id, website_id, name, is_default, status, created_at, updated_at)
     VALUES (?, ?, ?, 'Default Pre-Chat Form', 1, 'active', ?, ?)`,
    formId, accountId, websiteId, now, now,
  );
  const fields: Array<[string, string, string, string, number, number]> = [
    ['name', 'text', 'Name', 'Enter your name...', 1, 0],
    ['email', 'email', 'Email', 'Enter your email...', 1, 1],
    ['phone', 'phone', 'Phone', 'Enter your phone...', 0, 2],
  ];
  for (const [key, type, label, placeholder, required, order] of fields) {
    db.run(
      `INSERT INTO form_fields (id, account_id, website_id, form_id, field_key, type, label,
                                placeholder, options, required, enabled, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, 1, ?)`,
      newId(), accountId, websiteId, formId, key, type, label, placeholder, required, order,
    );
  }
  db.run('UPDATE widget_settings SET active_form_id = ? WHERE website_id = ?', formId, websiteId);
}

export function updateWebsite(
  accountId: string,
  websiteId: string,
  patch: {
    name?: string;
    url?: string;
    timezone?: string;
    status?: 'active' | 'inactive';
    inactivity_timeout_minutes?: number;
    retention_days?: number;
  },
  actorId: string,
): WebsiteRow {
  const site = getWebsiteForAccount(accountId, websiteId);
  const sets: string[] = [];
  const params: unknown[] = [];

  if (patch.name !== undefined) {
    sets.push('name = ?');
    params.push(patch.name.trim());
  }
  if (patch.url !== undefined) {
    const host = normaliseHost(patch.url);
    if (!host) throw validationFailed('Enter a valid website URL.', { url: 'Enter a valid website URL.' });
    const canonical = canonicalHost(host);
    const clash = db.get<{ id: string }>(
      'SELECT id FROM websites WHERE account_id = ? AND primary_domain = ? AND id != ?',
      accountId, canonical, websiteId,
    );
    if (clash) throw conflict('That domain is already registered on this account.');
    sets.push('primary_domain = ?', 'url = ?');
    params.push(canonical, patch.url.includes('://') ? patch.url.trim() : 'https://' + host);
  }
  if (patch.timezone !== undefined) {
    sets.push('timezone = ?');
    params.push(patch.timezone);
  }
  if (patch.status !== undefined) {
    if (site.status === 'suspended') {
      throw new AppError('forbidden', 'This website is suspended by the platform administrator.');
    }
    sets.push('status = ?');
    params.push(patch.status);
  }
  if (patch.inactivity_timeout_minutes !== undefined) {
    sets.push('inactivity_timeout_minutes = ?');
    params.push(Math.min(1440, Math.max(0, Math.round(patch.inactivity_timeout_minutes))));
  }
  if (patch.retention_days !== undefined) {
    sets.push('retention_days = ?');
    params.push(Math.min(3650, Math.max(0, Math.round(patch.retention_days))));
  }
  if (!sets.length) return site;

  sets.push('updated_at = ?');
  params.push(nowIso(), websiteId, accountId);
  db.run(`UPDATE websites SET ${sets.join(', ')} WHERE id = ? AND account_id = ?`, ...params);

  audit({
    accountId, websiteId, actorType: 'user', actorId,
    action: 'website.updated', targetType: 'website', targetId: websiteId, metadata: patch,
  });
  return getWebsiteForAccount(accountId, websiteId);
}

export function deleteWebsite(accountId: string, websiteId: string, actorId: string): void {
  getWebsiteForAccount(accountId, websiteId);
  db.run('DELETE FROM websites WHERE id = ? AND account_id = ?', websiteId, accountId);
  audit({
    accountId, actorType: 'user', actorId,
    action: 'website.deleted', targetType: 'website', targetId: websiteId,
  });
}

export function setWebsitePlatformStatus(
  websiteId: string,
  status: 'active' | 'suspended',
  reason: string,
  actorId: string,
): void {
  const site = getWebsite(websiteId);
  if (!site) throw notFound('Website not found.');
  db.run('UPDATE websites SET status = ?, suspend_reason = ?, updated_at = ? WHERE id = ?',
    status, reason, nowIso(), websiteId);
  audit({
    accountId: site.account_id, websiteId, actorType: 'super_admin', actorId,
    action: 'website.platform_status_changed', targetType: 'website', targetId: websiteId,
    metadata: { status, reason },
  });
}

/* ------------------------------------------------------------- domains -- */

export interface DomainRow {
  id: string;
  account_id: string;
  website_id: string;
  domain: string;
  created_at: string;
}

export function listDomains(accountId: string, websiteId: string): DomainRow[] {
  return db.all<DomainRow>(
    'SELECT * FROM website_domains WHERE website_id = ? AND account_id = ? ORDER BY domain',
    websiteId, accountId,
  );
}

export function addDomain(accountId: string, websiteId: string, raw: string): DomainRow {
  getWebsiteForAccount(accountId, websiteId);
  const host = normaliseHost(raw);
  if (!host) throw validationFailed('Enter a valid domain.', { domain: 'Enter a valid domain.' });
  const existing = db.get<DomainRow>(
    'SELECT * FROM website_domains WHERE website_id = ? AND domain = ?', websiteId, host,
  );
  if (existing) return existing;
  const id = newId();
  db.run(
    'INSERT INTO website_domains (id, account_id, website_id, domain, created_at) VALUES (?, ?, ?, ?, ?)',
    id, accountId, websiteId, host, nowIso(),
  );
  return db.get<DomainRow>('SELECT * FROM website_domains WHERE id = ?', id)!;
}

export function removeDomain(accountId: string, websiteId: string, domainId: string): void {
  db.run(
    'DELETE FROM website_domains WHERE id = ? AND website_id = ? AND account_id = ?',
    domainId, websiteId, accountId,
  );
}

/**
 * Authoritative host check used by every site-authenticated request.
 * Accepts the primary domain (with or without "www.") plus explicitly added
 * additional domains. Local/private hosts are accepted only when the website
 * itself is registered on a local host (development installs).
 */
export function hostIsAllowedForWebsite(site: WebsiteRow, presentedHost: string): boolean {
  const host = normaliseHost(presentedHost);
  if (!host) return false;
  if (canonicalHost(host) === site.primary_domain) return true;

  const extra = db.get<{ id: string }>(
    'SELECT id FROM website_domains WHERE website_id = ? AND (domain = ? OR domain = ?)',
    site.id, host, canonicalHost(host),
  );
  if (extra) return true;

  if (isLocalHost(host) && isLocalHost(site.primary_domain)) return true;
  return false;
}

/* --------------------------------------------------------- plan limits -- */

export type PlanLimitKey =
  | 'max_websites'
  | 'max_documents'
  | 'max_messages_month'
  | 'max_storage_mb';

export function planLimitFor(accountId: string, key: PlanLimitKey): number {
  const row = db.get<Record<string, number>>(
    `SELECT p.${key} AS value
       FROM accounts a LEFT JOIN plans p ON p.id = a.plan_id
      WHERE a.id = ?`,
    accountId,
  );
  const value = row?.value;
  return typeof value === 'number' ? value : 0; // 0 == unlimited / unset
}
