/**
 * Customer-owned AI provider credentials and per-website model selection.
 *
 * Security invariants:
 *  - The raw provider key is encrypted (AES-256-GCM) the moment it arrives and
 *    is decrypted only inside `resolveCredentials`, which is used exclusively
 *    by server-side generation and connection-test paths.
 *  - No route, view, API response or log may ever contain the plaintext.
 *    Only `api_key_masked` leaves the server.
 */
import { db, nowIso } from '../db/index.ts';
import { AppError, notFound, validationFailed } from '../core/errors.ts';
import { decryptSecret, encryptSecret, maskSecret, newId } from '../core/crypto.ts';
import { env } from '../config/env.ts';
import { log } from '../core/logger.ts';
import { audit } from './audit.ts';
import { getWebsiteForAccount } from './websites.ts';
import { requireProvider, listProviders } from '../providers/registry.ts';
import type { ProviderCredentials, ProviderStatus, ProviderTestResult } from '../providers/types.ts';

export interface ProviderCredentialRow {
  id: string;
  account_id: string;
  website_id: string;
  provider: string;
  api_key_enc: string;
  api_key_masked: string;
  base_url: string;
  org_id: string;
  status: ProviderStatus;
  status_detail: string;
  last_tested_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  latency_ms: number;
  error_count: number;
  created_at: string;
  updated_at: string;
}

export interface ProviderConfigRow {
  id: string;
  account_id: string;
  website_id: string;
  active_provider: string;
  active_model: string;
  temperature: number;
  max_output_tokens: number;
  retrieval_threshold: number;
  max_history_messages: number;
  created_at: string;
  updated_at: string;
}

/** Safe projection: everything a client may see about a credential. */
export interface ProviderCredentialView {
  provider: string;
  name: string;
  description: string;
  consoleUrl: string;
  /** What that provider's key looks like, e.g. 'sk-ant-...'. */
  keyHint: string;
  /** Whether the customer must supply the API base URL for this provider. */
  requiresBaseUrl: boolean;
  supportsOrgId: boolean;
  configured: boolean;
  maskedKey: string;
  baseUrl: string;
  orgId: string;
  status: ProviderStatus;
  statusLabel: string;
  statusDetail: string;
  lastTestedAt: string | null;
  latencyMs: number;
  errorCount: number;
  models: Array<{ id: string; displayName: string }>;
}

export const STATUS_LABELS: Record<ProviderStatus, string> = {
  not_configured: 'Not Configured',
  connected: 'Connected',
  connection_failed: 'Connection Failed',
  temporarily_unavailable: 'Temporarily Unavailable',
  quota_limited: 'Quota Limited',
  rate_limited: 'Rate Limited',
  invalid_credential: 'Invalid Credential',
  model_unavailable: 'Model Unavailable',
};

/* --------------------------------------------------------------- config -- */

export function getConfig(accountId: string, websiteId: string): ProviderConfigRow {
  const row = db.get<ProviderConfigRow>(
    'SELECT * FROM ai_provider_configs WHERE website_id = ? AND account_id = ?',
    websiteId, accountId,
  );
  if (row) return row;
  const id = newId();
  const now = nowIso();
  db.run(
    `INSERT INTO ai_provider_configs (id, account_id, website_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    id, accountId, websiteId, now, now,
  );
  return db.get<ProviderConfigRow>('SELECT * FROM ai_provider_configs WHERE id = ?', id)!;
}

export function updateConfig(
  accountId: string,
  websiteId: string,
  patch: Partial<Pick<ProviderConfigRow,
    'active_provider' | 'active_model' | 'temperature' | 'max_output_tokens' |
    'retrieval_threshold' | 'max_history_messages'>>,
): ProviderConfigRow {
  getConfig(accountId, websiteId);
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    sets.push(key + ' = ?');
    params.push(value);
  }
  if (!sets.length) return getConfig(accountId, websiteId);
  sets.push('updated_at = ?');
  params.push(nowIso(), websiteId, accountId);
  db.run(
    `UPDATE ai_provider_configs SET ${sets.join(', ')} WHERE website_id = ? AND account_id = ?`,
    ...params,
  );
  return getConfig(accountId, websiteId);
}

/* ---------------------------------------------------------- credentials -- */

export function getCredentialRow(
  accountId: string,
  websiteId: string,
  provider: string,
): ProviderCredentialRow | undefined {
  return db.get<ProviderCredentialRow>(
    'SELECT * FROM ai_provider_credentials WHERE website_id = ? AND account_id = ? AND provider = ?',
    websiteId, accountId, provider,
  );
}

export function saveCredential(
  accountId: string,
  websiteId: string,
  provider: string,
  input: { apiKey: string; baseUrl?: string; orgId?: string },
  actorId: string,
): ProviderCredentialRow {
  getWebsiteForAccount(accountId, websiteId);
  const adapter = requireProvider(provider);

  const apiKey = (input.apiKey ?? '').trim();
  const check = adapter.validate({ apiKey, baseUrl: input.baseUrl, orgId: input.orgId });
  if (!check.ok) {
    throw validationFailed(check.message ?? 'Those provider credentials are not valid.', {
      api_key: check.message ?? 'Invalid credentials.',
    });
  }

  const existing = getCredentialRow(accountId, websiteId, provider);
  const now = nowIso();

  if (existing) {
    db.run(
      `UPDATE ai_provider_credentials
          SET api_key_enc = ?, api_key_masked = ?, base_url = ?, org_id = ?,
              status = 'not_configured', status_detail = 'Saved. Run a connection test.',
              error_count = 0, updated_at = ?
        WHERE id = ?`,
      encryptSecret(apiKey), maskSecret(apiKey), (input.baseUrl ?? '').trim(),
      (input.orgId ?? '').trim(), now, existing.id,
    );
    audit({
      accountId, websiteId, actorType: 'user', actorId,
      action: 'provider.credential_rotated', targetType: 'ai_provider_credential',
      targetId: existing.id, metadata: { provider },
    });
    return getCredentialRow(accountId, websiteId, provider)!;
  }

  const id = newId();
  db.run(
    `INSERT INTO ai_provider_credentials
       (id, account_id, website_id, provider, api_key_enc, api_key_masked, base_url, org_id,
        status, status_detail, error_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'not_configured', 'Saved. Run a connection test.', 0, ?, ?)`,
    id, accountId, websiteId, provider, encryptSecret(apiKey), maskSecret(apiKey),
    (input.baseUrl ?? '').trim(), (input.orgId ?? '').trim(), now, now,
  );
  audit({
    accountId, websiteId, actorType: 'user', actorId,
    action: 'provider.credential_added', targetType: 'ai_provider_credential',
    targetId: id, metadata: { provider },
  });
  return getCredentialRow(accountId, websiteId, provider)!;
}

export function removeCredential(accountId: string, websiteId: string, provider: string, actorId: string): void {
  const row = getCredentialRow(accountId, websiteId, provider);
  if (!row) throw notFound('No credentials are stored for that provider.');
  db.tx(() => {
    db.run('DELETE FROM ai_provider_credentials WHERE id = ?', row.id);
    db.run('DELETE FROM ai_provider_models WHERE website_id = ? AND provider = ?', websiteId, provider);
    const config = getConfig(accountId, websiteId);
    if (config.active_provider === provider) {
      db.run(
        `UPDATE ai_provider_configs SET active_provider = '', active_model = '', updated_at = ?
          WHERE website_id = ?`,
        nowIso(), websiteId,
      );
    }
  });
  audit({
    accountId, websiteId, actorType: 'user', actorId,
    action: 'provider.credential_removed', targetType: 'ai_provider_credential',
    targetId: row.id, metadata: { provider },
  });
}

/** Server-side only. The single point where a provider key is decrypted. */
export function resolveCredentials(
  accountId: string,
  websiteId: string,
  provider: string,
): ProviderCredentials | null {
  const row = getCredentialRow(accountId, websiteId, provider);
  if (!row) return null;
  try {
    return {
      apiKey: decryptSecret(row.api_key_enc),
      baseUrl: row.base_url || undefined,
      orgId: row.org_id || undefined,
    };
  } catch (err) {
    log.error('Failed to decrypt a stored provider credential.', { provider, websiteId }, { accountId, websiteId });
    return null;
  }
}

function applyTestResult(rowId: string, result: ProviderTestResult): void {
  const now = nowIso();
  if (result.ok) {
    db.run(
      `UPDATE ai_provider_credentials
          SET status = 'connected', status_detail = ?, last_tested_at = ?, last_success_at = ?,
              latency_ms = ?, error_count = 0, updated_at = ?
        WHERE id = ?`,
      result.message, now, now, result.latencyMs, now, rowId,
    );
  } else {
    db.run(
      `UPDATE ai_provider_credentials
          SET status = ?, status_detail = ?, last_tested_at = ?, last_failure_at = ?,
              latency_ms = ?, error_count = error_count + 1, updated_at = ?
        WHERE id = ?`,
      result.status, result.message.slice(0, 500), now, now, result.latencyMs, now, rowId,
    );
  }
}

export interface TestAndDiscoverResult {
  test: ProviderTestResult;
  models: Array<{ id: string; displayName: string }>;
  suggestedModel: string;
}

/**
 * Runs a live connection test and, on success, refreshes the discovered model
 * list. Model lists are always provider-reported; nothing is hardcoded.
 */
export async function testAndDiscover(
  accountId: string,
  websiteId: string,
  provider: string,
  actorId: string,
): Promise<TestAndDiscoverResult> {
  getWebsiteForAccount(accountId, websiteId);
  const adapter = requireProvider(provider);
  const row = getCredentialRow(accountId, websiteId, provider);
  if (!row) throw notFound('Save your provider API key before testing the connection.');

  const creds = resolveCredentials(accountId, websiteId, provider);
  if (!creds) {
    throw new AppError('internal_error', 'Stored credentials could not be read. Please re-enter your API key.');
  }

  const test = await adapter.testConnection(creds, env.PROVIDER_TIMEOUT_MS);
  applyTestResult(row.id, test);

  audit({
    accountId, websiteId, actorType: 'user', actorId,
    action: 'provider.connection_tested', targetType: 'ai_provider_credential', targetId: row.id,
    metadata: { provider, ok: test.ok, status: test.status },
  });

  if (!test.ok) return { test, models: [], suggestedModel: '' };

  const models = await adapter.listModels(creds, env.PROVIDER_TIMEOUT_MS);
  replaceDiscoveredModels(accountId, websiteId, provider, models);
  return { test, models, suggestedModel: chooseDefaultModel(provider, models.map((m) => m.id)) };
}

export function replaceDiscoveredModels(
  accountId: string,
  websiteId: string,
  provider: string,
  models: Array<{ id: string; displayName: string }>,
): void {
  const now = nowIso();
  db.tx(() => {
    db.run('DELETE FROM ai_provider_models WHERE website_id = ? AND provider = ?', websiteId, provider);
    for (const m of models) {
      db.run(
        `INSERT INTO ai_provider_models (id, account_id, website_id, provider, model_id, display_name, discovered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        newId(), accountId, websiteId, provider, m.id, m.displayName, now,
      );
    }
  });
}

export function listDiscoveredModels(
  accountId: string,
  websiteId: string,
  provider: string,
): Array<{ id: string; displayName: string }> {
  return db
    .all<{ model_id: string; display_name: string }>(
      `SELECT model_id, display_name FROM ai_provider_models
        WHERE website_id = ? AND account_id = ? AND provider = ?
        ORDER BY model_id`,
      websiteId, accountId, provider,
    )
    .map((r) => ({ id: r.model_id, displayName: r.display_name || r.model_id }));
}

export function chooseDefaultModel(provider: string, available: string[]): string {
  if (!available.length) return '';
  const adapter = requireProvider(provider);
  for (const preferred of adapter.preferredModelOrder()) {
    if (available.includes(preferred)) return preferred;
    const prefixMatch = available.find((m) => m.startsWith(preferred));
    if (prefixMatch) return prefixMatch;
  }
  return available[0] as string;
}

/**
 * Selects the active provider/model for a website.
 * Switching providers clears a model that the new provider cannot serve.
 */
export function setActiveProviderAndModel(
  accountId: string,
  websiteId: string,
  provider: string,
  model: string,
  actorId: string,
): ProviderConfigRow {
  getWebsiteForAccount(accountId, websiteId);
  requireProvider(provider);

  const credential = getCredentialRow(accountId, websiteId, provider);
  if (!credential) {
    throw validationFailed('Add and test this provider before selecting it.', {
      provider: 'This provider has no saved API key.',
    });
  }

  /**
   * A provider may only go live once its credential has actually connected.
   * Without this gate a customer could select a provider whose key was rejected
   * and only find out when visitors started seeing the generation-error
   * message - the failure would surface on the website rather than on this
   * screen, which is exactly backwards.
   */
  if (credential.status !== 'connected') {
    throw validationFailed('Test the connection before selecting this provider.', {
      provider: 'This provider is not connected (' + STATUS_LABELS[credential.status] + ').',
    });
  }

  const available = listDiscoveredModels(accountId, websiteId, provider).map((m) => m.id);
  let chosen = (model ?? '').trim();

  if (chosen && available.length && !available.includes(chosen)) {
    throw validationFailed('That model is not available for the selected provider.', {
      model: 'Pick a model from the discovered list.',
    });
  }
  if (!chosen) chosen = chooseDefaultModel(provider, available);

  // A connected endpoint that lists no models is legitimate - some
  // OpenAI-compatible gateways do not implement /models - so a typed-in model
  // id is accepted there. What is never accepted is no model at all.
  if (!chosen) {
    throw validationFailed(
      'This provider did not report any models. Enter the model id you want to use.',
      { model: 'No models discovered. Enter a model id.' },
    );
  }

  const config = updateConfig(accountId, websiteId, { active_provider: provider, active_model: chosen });
  audit({
    accountId, websiteId, actorType: 'user', actorId,
    action: 'provider.model_selected', targetType: 'website', targetId: websiteId,
    metadata: { provider, model: chosen },
  });
  return config;
}

/** Everything the AI Providers screen needs, with no secrets. */
export function providerOverview(accountId: string, websiteId: string): ProviderCredentialView[] {
  return listProviders().map((adapter) => {
    const row = getCredentialRow(accountId, websiteId, adapter.slug);
    return {
      provider: adapter.slug,
      name: adapter.name,
      description: adapter.description,
      consoleUrl: adapter.consoleUrl,
      keyHint: adapter.keyHint,
      requiresBaseUrl: adapter.requiresBaseUrl,
      supportsOrgId: adapter.supportsOrgId,
      configured: Boolean(row),
      maskedKey: row?.api_key_masked ?? '',
      baseUrl: row?.base_url ?? '',
      orgId: row?.org_id ?? '',
      status: (row?.status ?? 'not_configured') as ProviderStatus,
      statusLabel: STATUS_LABELS[(row?.status ?? 'not_configured') as ProviderStatus],
      statusDetail: row?.status_detail ?? '',
      lastTestedAt: row?.last_tested_at ?? null,
      latencyMs: row?.latency_ms ?? 0,
      errorCount: row?.error_count ?? 0,
      models: listDiscoveredModels(accountId, websiteId, adapter.slug),
    };
  });
}

/** Records a runtime provider failure observed during generation. */
export function recordProviderFailure(
  accountId: string,
  websiteId: string,
  provider: string,
  status: ProviderStatus,
  detail: string,
): void {
  const row = getCredentialRow(accountId, websiteId, provider);
  if (!row) return;
  db.run(
    `UPDATE ai_provider_credentials
        SET status = ?, status_detail = ?, last_failure_at = ?, error_count = error_count + 1, updated_at = ?
      WHERE id = ?`,
    status, detail.slice(0, 500), nowIso(), nowIso(), row.id,
  );
}

export function recordProviderSuccess(accountId: string, websiteId: string, provider: string, latencyMs: number): void {
  const row = getCredentialRow(accountId, websiteId, provider);
  if (!row) return;
  db.run(
    `UPDATE ai_provider_credentials
        SET status = 'connected', status_detail = 'Operational', last_success_at = ?,
            latency_ms = ?, error_count = 0, updated_at = ?
      WHERE id = ?`,
    nowIso(), latencyMs, nowIso(), row.id,
  );
}
