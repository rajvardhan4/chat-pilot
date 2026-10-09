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
import { col, nowIso, withTransaction } from "../db/mongo.js";
import { AppError, notFound, validationFailed } from "../core/errors.js";
import { decryptSecret, encryptSecret, maskSecret, newId } from "../core/crypto.js";
import { env } from "../config/env.js";
import { log } from "../core/logger.js";
import { audit } from "./audit.js";
import { getWebsiteForAccount } from "./websites.js";
import { requireProvider, listProviders } from "../providers/registry.js";
export const STATUS_LABELS = {
    not_configured: 'Not Configured',
    connected: 'Connected',
    connection_failed: 'Connection Failed',
    temporarily_unavailable: 'Temporarily Unavailable',
    quota_limited: 'Quota Limited',
    rate_limited: 'Rate Limited',
    invalid_credential: 'Invalid Credential',
    model_unavailable: 'Model Unavailable',
};
function toConfigRow(d) {
    const { _id, ...rest } = d;
    return { id: _id, ...rest };
}
function toCredentialRow(d) {
    const { _id, ...rest } = d;
    return { id: _id, ...rest };
}
/* --------------------------------------------------------------- config -- */
export async function getConfig(accountId, websiteId) {
    const row = await col('ai_provider_configs').findOne({ website_id: websiteId, account_id: accountId });
    if (row)
        return toConfigRow(row);
    const id = newId();
    const now = nowIso();
    const doc = {
        _id: id, account_id: accountId, website_id: websiteId,
        active_provider: '', active_model: '', temperature: 0.4, max_output_tokens: 800,
        retrieval_threshold: 3.0, max_history_messages: 20, created_at: now, updated_at: now,
    };
    await col('ai_provider_configs').insertOne(doc);
    return toConfigRow(doc);
}
export async function updateConfig(accountId, websiteId, patch) {
    await getConfig(accountId, websiteId);
    const set = {};
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined)
            continue;
        set[key] = value;
    }
    if (!Object.keys(set).length)
        return getConfig(accountId, websiteId);
    set.updated_at = nowIso();
    await col('ai_provider_configs').updateOne({ website_id: websiteId, account_id: accountId }, { $set: set });
    return getConfig(accountId, websiteId);
}
/* ---------------------------------------------------------- credentials -- */
export async function getCredentialRow(accountId, websiteId, provider) {
    const doc = await col('ai_provider_credentials').findOne({ website_id: websiteId, account_id: accountId, provider });
    return doc ? toCredentialRow(doc) : undefined;
}
export async function saveCredential(accountId, websiteId, provider, input, actorId) {
    await getWebsiteForAccount(accountId, websiteId);
    const adapter = requireProvider(provider);
    const apiKey = (input.apiKey ?? '').trim();
    const check = adapter.validate({ apiKey, baseUrl: input.baseUrl, orgId: input.orgId });
    if (!check.ok) {
        throw validationFailed(check.message ?? 'Those provider credentials are not valid.', {
            api_key: check.message ?? 'Invalid credentials.',
        });
    }
    const existing = await getCredentialRow(accountId, websiteId, provider);
    const now = nowIso();
    if (existing) {
        await col('ai_provider_credentials').updateOne({ _id: existing.id }, {
            $set: {
                api_key_enc: encryptSecret(apiKey),
                api_key_masked: maskSecret(apiKey),
                base_url: (input.baseUrl ?? '').trim(),
                org_id: (input.orgId ?? '').trim(),
                status: 'not_configured',
                status_detail: 'Saved. Run a connection test.',
                error_count: 0,
                updated_at: now,
            },
        });
        await audit({
            accountId, websiteId, actorType: 'user', actorId,
            action: 'provider.credential_rotated', targetType: 'ai_provider_credential',
            targetId: existing.id, metadata: { provider },
        });
        return (await getCredentialRow(accountId, websiteId, provider));
    }
    const id = newId();
    await col('ai_provider_credentials').insertOne({
        _id: id, account_id: accountId, website_id: websiteId, provider,
        api_key_enc: encryptSecret(apiKey), api_key_masked: maskSecret(apiKey),
        base_url: (input.baseUrl ?? '').trim(), org_id: (input.orgId ?? '').trim(),
        status: 'not_configured', status_detail: 'Saved. Run a connection test.',
        last_tested_at: null, last_success_at: null, last_failure_at: null,
        latency_ms: 0, error_count: 0, created_at: now, updated_at: now,
    });
    await audit({
        accountId, websiteId, actorType: 'user', actorId,
        action: 'provider.credential_added', targetType: 'ai_provider_credential',
        targetId: id, metadata: { provider },
    });
    return (await getCredentialRow(accountId, websiteId, provider));
}
export async function removeCredential(accountId, websiteId, provider, actorId) {
    const row = await getCredentialRow(accountId, websiteId, provider);
    if (!row)
        throw notFound('No credentials are stored for that provider.');
    await withTransaction(async (session) => {
        await col('ai_provider_credentials').deleteOne({ _id: row.id }, { session });
        await col('ai_provider_models').deleteMany({ website_id: websiteId, provider }, { session });
        const config = await col('ai_provider_configs').findOne({ website_id: websiteId, account_id: accountId }, { session });
        if (config?.active_provider === provider) {
            await col('ai_provider_configs').updateOne({ website_id: websiteId }, { $set: { active_provider: '', active_model: '', updated_at: nowIso() } }, { session });
        }
    });
    await audit({
        accountId, websiteId, actorType: 'user', actorId,
        action: 'provider.credential_removed', targetType: 'ai_provider_credential',
        targetId: row.id, metadata: { provider },
    });
}
/** Server-side only. The single point where a provider key is decrypted. */
export async function resolveCredentials(accountId, websiteId, provider) {
    const row = await getCredentialRow(accountId, websiteId, provider);
    if (!row)
        return null;
    try {
        return {
            apiKey: decryptSecret(row.api_key_enc),
            baseUrl: row.base_url || undefined,
            orgId: row.org_id || undefined,
        };
    }
    catch {
        log.error('Failed to decrypt a stored provider credential.', { provider, websiteId }, { accountId, websiteId });
        return null;
    }
}
async function applyTestResult(rowId, result) {
    const now = nowIso();
    if (result.ok) {
        await col('ai_provider_credentials').updateOne({ _id: rowId }, { $set: { status: 'connected', status_detail: result.message, last_tested_at: now, last_success_at: now, latency_ms: result.latencyMs, error_count: 0, updated_at: now } });
    }
    else {
        await col('ai_provider_credentials').updateOne({ _id: rowId }, {
            $set: { status: result.status, status_detail: result.message.slice(0, 500), last_tested_at: now, last_failure_at: now, latency_ms: result.latencyMs, updated_at: now },
            $inc: { error_count: 1 },
        });
    }
}
/**
 * Runs a live connection test and, on success, refreshes the discovered model
 * list. Model lists are always provider-reported; nothing is hardcoded.
 */
export async function testAndDiscover(accountId, websiteId, provider, actorId) {
    await getWebsiteForAccount(accountId, websiteId);
    const adapter = requireProvider(provider);
    const row = await getCredentialRow(accountId, websiteId, provider);
    if (!row)
        throw notFound('Save your provider API key before testing the connection.');
    const creds = await resolveCredentials(accountId, websiteId, provider);
    if (!creds) {
        throw new AppError('internal_error', 'Stored credentials could not be read. Please re-enter your API key.');
    }
    const test = await adapter.testConnection(creds, env.PROVIDER_TIMEOUT_MS);
    await applyTestResult(row.id, test);
    await audit({
        accountId, websiteId, actorType: 'user', actorId,
        action: 'provider.connection_tested', targetType: 'ai_provider_credential', targetId: row.id,
        metadata: { provider, ok: test.ok, status: test.status },
    });
    if (!test.ok)
        return { test, models: [], suggestedModel: '' };
    const models = await adapter.listModels(creds, env.PROVIDER_TIMEOUT_MS);
    await replaceDiscoveredModels(accountId, websiteId, provider, models);
    return { test, models, suggestedModel: chooseDefaultModel(provider, models.map((m) => m.id)) };
}
export async function replaceDiscoveredModels(accountId, websiteId, provider, models) {
    const now = nowIso();
    await withTransaction(async (session) => {
        await col('ai_provider_models').deleteMany({ website_id: websiteId, provider }, { session });
        for (const m of models) {
            await col('ai_provider_models').insertOne({ _id: newId(), account_id: accountId, website_id: websiteId, provider, model_id: m.id, display_name: m.displayName, discovered_at: now }, { session });
        }
    });
}
export async function listDiscoveredModels(accountId, websiteId, provider) {
    const docs = await col('ai_provider_models')
        .find({ website_id: websiteId, account_id: accountId, provider })
        .sort({ model_id: 1 })
        .toArray();
    return docs.map((r) => ({ id: r.model_id, displayName: r.display_name || r.model_id }));
}
export function chooseDefaultModel(provider, available) {
    if (!available.length)
        return '';
    const adapter = requireProvider(provider);
    for (const preferred of adapter.preferredModelOrder()) {
        if (available.includes(preferred))
            return preferred;
        const prefixMatch = available.find((m) => m.startsWith(preferred));
        if (prefixMatch)
            return prefixMatch;
    }
    return available[0];
}
/**
 * Selects the active provider/model for a website.
 * Switching providers clears a model that the new provider cannot serve.
 */
export async function setActiveProviderAndModel(accountId, websiteId, provider, model, actorId) {
    await getWebsiteForAccount(accountId, websiteId);
    requireProvider(provider);
    const credential = await getCredentialRow(accountId, websiteId, provider);
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
    const available = (await listDiscoveredModels(accountId, websiteId, provider)).map((m) => m.id);
    let chosen = (model ?? '').trim();
    if (chosen && available.length && !available.includes(chosen)) {
        throw validationFailed('That model is not available for the selected provider.', {
            model: 'Pick a model from the discovered list.',
        });
    }
    if (!chosen)
        chosen = chooseDefaultModel(provider, available);
    // A connected endpoint that lists no models is legitimate - some
    // OpenAI-compatible gateways do not implement /models - so a typed-in model
    // id is accepted there. What is never accepted is no model at all.
    if (!chosen) {
        throw validationFailed('This provider did not report any models. Enter the model id you want to use.', { model: 'No models discovered. Enter a model id.' });
    }
    const config = await updateConfig(accountId, websiteId, { active_provider: provider, active_model: chosen });
    await audit({
        accountId, websiteId, actorType: 'user', actorId,
        action: 'provider.model_selected', targetType: 'website', targetId: websiteId,
        metadata: { provider, model: chosen },
    });
    return config;
}
/** Everything the AI Providers screen needs, with no secrets. */
export async function providerOverview(accountId, websiteId) {
    return Promise.all(listProviders().map(async (adapter) => {
        const row = await getCredentialRow(accountId, websiteId, adapter.slug);
        const models = await listDiscoveredModels(accountId, websiteId, adapter.slug);
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
            status: (row?.status ?? 'not_configured'),
            statusLabel: STATUS_LABELS[(row?.status ?? 'not_configured')],
            statusDetail: row?.status_detail ?? '',
            lastTestedAt: row?.last_tested_at ?? null,
            latencyMs: row?.latency_ms ?? 0,
            errorCount: row?.error_count ?? 0,
            models,
            suggestedModel: chooseDefaultModel(adapter.slug, models.map((m) => m.id)),
        };
    }));
}
/** Records a runtime provider failure observed during generation. */
export async function recordProviderFailure(accountId, websiteId, provider, status, detail) {
    const row = await getCredentialRow(accountId, websiteId, provider);
    if (!row)
        return;
    await col('ai_provider_credentials').updateOne({ _id: row.id }, {
        $set: { status, status_detail: detail.slice(0, 500), last_failure_at: nowIso(), updated_at: nowIso() },
        $inc: { error_count: 1 },
    });
}
export async function recordProviderSuccess(accountId, websiteId, provider, latencyMs) {
    const row = await getCredentialRow(accountId, websiteId, provider);
    if (!row)
        return;
    await col('ai_provider_credentials').updateOne({ _id: row.id }, { $set: { status: 'connected', status_detail: 'Operational', last_success_at: nowIso(), latency_ms: latencyMs, error_count: 0, updated_at: nowIso() } });
}
