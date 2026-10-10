/**
 * Website registration and the per-website configuration records that every
 * other module hangs off (provider config, instructions, widget, default form).
 */
import { cascadeDeleteWebsite, col, nowIso, withTransaction } from "../db/mongo.js";
import { AppError, conflict, notFound, validationFailed } from "../core/errors.js";
import { newId, randomToken } from "../core/crypto.js";
import { canonicalHost, isLocalHost, normaliseHost } from "../core/domain.js";
import { audit } from "./audit.js";
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_FALLBACK, DEFAULT_GENERATION_ERROR } from "./instructionDefaults.js";
function toWebsiteRow(d) {
    const { _id, ...rest } = d;
    return {
        id: _id,
        monthly_budget: 0,
        budget_warning_pct: 80,
        notification_email: '',
        enable_notifications: 1,
        notify_on_lead: 1,
        notify_on_form: 1,
        notify_on_conversation: 0,
        notify_on_budget_warning: 1,
        notify_on_ai_failure: 1,
        default_language: 'en',
        store_conversations: 1,
        store_visitor_info: 1,
        anonymize_ips: 1,
        inactivity_timeout_minutes: 30,
        retention_days: 90,
        ...rest,
    };
}
export async function getWebsite(websiteId) {
    const doc = await col('websites').findOne({ _id: websiteId });
    return doc ? toWebsiteRow(doc) : undefined;
}
/** Tenant-scoped fetch. Never call getWebsite() directly from a route. */
export async function getWebsiteForAccount(accountId, websiteId) {
    const doc = await col('websites').findOne({ _id: websiteId, account_id: accountId });
    if (!doc)
        throw notFound('Website not found.');
    return toWebsiteRow(doc);
}
export async function listWebsites(accountId) {
    const docs = await col('websites').find({ account_id: accountId }).sort({ created_at: 1 }).toArray();
    return docs.map(toWebsiteRow);
}
export async function countWebsites(accountId) {
    return col('websites').countDocuments({ account_id: accountId });
}
export async function createWebsite(input) {
    const host = normaliseHost(input.url);
    if (!host) {
        throw validationFailed('Enter a valid website URL, for example https://example.com', {
            url: 'Enter a valid website URL.',
        });
    }
    const canonical = canonicalHost(host);
    const clash = await col('websites').findOne({ account_id: input.accountId, primary_domain: canonical }, { projection: { _id: 1 } });
    if (clash)
        throw conflict('That domain is already registered on this account.');
    // Enforce the plan's website allowance.
    const limit = await planLimitFor(input.accountId, 'max_websites');
    if (limit > 0 && (await countWebsites(input.accountId)) >= limit) {
        throw new AppError('usage_limit_reached', `Your plan allows ${limit} website${limit === 1 ? '' : 's'}. Upgrade to add more.`);
    }
    const id = newId();
    const now = nowIso();
    const normalisedUrl = input.url.includes('://') ? input.url.trim() : 'https://' + host;
    await withTransaction(async (session) => {
        await col('websites').insertOne({
            _id: id,
            account_id: input.accountId,
            name: input.name.trim(),
            primary_domain: canonical,
            url: normalisedUrl,
            status: 'active',
            suspend_reason: '',
            timezone: input.timezone ?? 'UTC',
            verification_token: randomToken(16),
            verified_at: null,
            last_connected_at: null,
            connected_plugin_ver: '',
            inactivity_timeout_minutes: 30,
            retention_days: 90,
            created_at: now,
            updated_at: now,
        }, { session });
        // Also allow the www. variant out of the box.
        await col('website_domains').insertOne({ _id: newId(), account_id: input.accountId, website_id: id, domain: 'www.' + canonical, created_at: now }, { session });
        await seedWebsiteDefaults(input.accountId, id, input.name.trim(), session);
    });
    await audit({
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
    return (await getWebsite(id));
}
/** Creates the config rows a website cannot function without. */
export async function seedWebsiteDefaults(accountId, websiteId, businessName, session) {
    const now = nowIso();
    const opts = session ? { session } : undefined;
    await col('ai_provider_configs').insertOne({
        _id: newId(),
        account_id: accountId,
        website_id: websiteId,
        active_provider: '',
        active_model: '',
        temperature: 0.4,
        max_output_tokens: 800,
        retrieval_threshold: 3.0,
        max_history_messages: 20,
        created_at: now,
        updated_at: now,
    }, opts);
    await col('ai_instructions').insertOne({
        _id: newId(),
        account_id: accountId,
        website_id: websiteId,
        business_name: businessName,
        system_prompt: DEFAULT_SYSTEM_PROMPT,
        tone: 'professional',
        answer_length: 'concise',
        fallback_response: DEFAULT_FALLBACK,
        greeting_response: '',
        generation_error_response: DEFAULT_GENERATION_ERROR,
        // These flags are stored as 0/1 everywhere else in this codebase (see
        // widget.ts, forms.ts, instructions.ts), not BSON booleans — matching
        // that so any equality query against them keeps working.
        allow_small_talk: 1,
        strict_grounding: 1,
        created_at: now,
        updated_at: now,
    }, opts);
    await col('widget_settings').insertOne({
        _id: newId(),
        account_id: accountId,
        website_id: websiteId,
        enabled: 1,
        display_name: 'Chat Pilot',
        position: 'bottom-right',
        primary_color: '#0678f9',
        logo_url: '',
        welcome_message: 'Hi there! How can I help you today?',
        placeholder_text: 'Ask a question...',
        suggested_questions: 'What services do you provide?\nWhat areas do you serve?\nHow can I contact you?',
        enable_typing: 1,
        enable_streaming: 1,
        auto_open_chat: 0,
        auto_open_delay: 5,
        open_once_per_visitor: 1,
        prechat_enabled: 1,
        active_form_id: null,
        created_at: now,
        updated_at: now,
    }, opts);
    // Default pre-chat form, mirroring the plugin's seeded form.
    const formId = newId();
    await col('forms').insertOne({
        _id: formId,
        account_id: accountId,
        website_id: websiteId,
        name: 'Default Pre-Chat Form',
        // is_default is stored as 0/1 everywhere else (see forms.ts), not a
        // BSON boolean — matching that so the equality queries there find it.
        is_default: 1,
        status: 'active',
        created_at: now,
        updated_at: now,
    }, opts);
    const fields = [
        ['name', 'text', 'Name', 'Enter your name...', 1, 0],
        ['email', 'email', 'Email', 'Enter your email...', 1, 1],
        ['phone', 'phone', 'Phone', 'Enter your phone...', 0, 2],
    ];
    for (const [key, type, label, placeholder, required, order] of fields) {
        await col('form_fields').insertOne({
            _id: newId(),
            account_id: accountId,
            website_id: websiteId,
            form_id: formId,
            field_key: key,
            type,
            label,
            placeholder,
            options: '',
            required,
            enabled: 1,
            sort_order: order,
        }, opts);
    }
    await col('widget_settings').updateOne({ website_id: websiteId }, { $set: { active_form_id: formId } }, opts);
}
export async function updateWebsite(accountId, websiteId, patch, actorId) {
    const site = await getWebsiteForAccount(accountId, websiteId);
    const set = {};
    if (patch.name !== undefined)
        set.name = patch.name.trim();
    if (patch.url !== undefined) {
        const host = normaliseHost(patch.url);
        if (!host)
            throw validationFailed('Enter a valid website URL.', { url: 'Enter a valid website URL.' });
        const canonical = canonicalHost(host);
        const clash = await col('websites').findOne({ account_id: accountId, primary_domain: canonical, _id: { $ne: websiteId } }, { projection: { _id: 1 } });
        if (clash)
            throw conflict('That domain is already registered on this account.');
        set.primary_domain = canonical;
        set.url = patch.url.includes('://') ? patch.url.trim() : 'https://' + host;
    }
    if (patch.timezone !== undefined)
        set.timezone = patch.timezone;
    if (patch.status !== undefined) {
        if (site.status === 'suspended') {
            throw new AppError('forbidden', 'This website is suspended by the platform administrator.');
        }
        set.status = patch.status;
    }
    if (patch.inactivity_timeout_minutes !== undefined) {
        set.inactivity_timeout_minutes = Math.min(1440, Math.max(0, Math.round(patch.inactivity_timeout_minutes)));
    }
    if (patch.retention_days !== undefined) {
        set.retention_days = Math.min(3650, Math.max(0, Math.round(patch.retention_days)));
    }
    if (patch.monthly_budget !== undefined) {
        set.monthly_budget = Math.max(0, Number(patch.monthly_budget) || 0);
    }
    if (patch.budget_warning_pct !== undefined) {
        set.budget_warning_pct = Math.min(100, Math.max(50, Number(patch.budget_warning_pct) || 80));
    }
    if (patch.notification_email !== undefined) {
        set.notification_email = String(patch.notification_email || '').trim().toLowerCase();
    }
    if (patch.enable_notifications !== undefined) {
        set.enable_notifications = patch.enable_notifications ? 1 : 0;
    }
    if (patch.notify_on_lead !== undefined) {
        set.notify_on_lead = patch.notify_on_lead ? 1 : 0;
    }
    if (patch.notify_on_form !== undefined) {
        set.notify_on_form = patch.notify_on_form ? 1 : 0;
    }
    if (patch.notify_on_conversation !== undefined) {
        set.notify_on_conversation = patch.notify_on_conversation ? 1 : 0;
    }
    if (patch.notify_on_budget_warning !== undefined) {
        set.notify_on_budget_warning = patch.notify_on_budget_warning ? 1 : 0;
    }
    if (patch.notify_on_ai_failure !== undefined) {
        set.notify_on_ai_failure = patch.notify_on_ai_failure ? 1 : 0;
    }
    if (patch.default_language !== undefined) {
        set.default_language = String(patch.default_language || 'en').trim().slice(0, 10);
    }
    if (patch.store_conversations !== undefined) {
        set.store_conversations = patch.store_conversations ? 1 : 0;
    }
    if (patch.store_visitor_info !== undefined) {
        set.store_visitor_info = patch.store_visitor_info ? 1 : 0;
    }
    if (patch.anonymize_ips !== undefined) {
        set.anonymize_ips = patch.anonymize_ips ? 1 : 0;
    }
    if (patch.smtp_host !== undefined) {
        set.smtp_host = String(patch.smtp_host || '').trim();
    }
    if (patch.smtp_port !== undefined) {
        set.smtp_port = Number(patch.smtp_port) || 587;
    }
    if (patch.smtp_user !== undefined) {
        set.smtp_user = String(patch.smtp_user || '').trim();
    }
    if (patch.smtp_pass !== undefined && patch.smtp_pass !== '') {
        set.smtp_pass = String(patch.smtp_pass);
    }
    if (patch.smtp_secure !== undefined) {
        set.smtp_secure = patch.smtp_secure ? 1 : 0;
    }
    if (patch.smtp_from !== undefined) {
        set.smtp_from = String(patch.smtp_from || '').trim();
    }
    if (!Object.keys(set).length)
        return site;
    set.updated_at = nowIso();
    await col('websites').updateOne({ _id: websiteId, account_id: accountId }, { $set: set });
    await audit({
        accountId, websiteId, actorType: 'user', actorId,
        action: 'website.updated', targetType: 'website', targetId: websiteId, metadata: patch,
    });
    return getWebsiteForAccount(accountId, websiteId);
}
export async function deleteWebsite(accountId, websiteId, actorId) {
    await getWebsiteForAccount(accountId, websiteId);
    await cascadeDeleteWebsite(websiteId);
    await audit({
        accountId, actorType: 'user', actorId,
        action: 'website.deleted', targetType: 'website', targetId: websiteId,
    });
}
export async function setWebsitePlatformStatus(websiteId, status, reason, actorId) {
    const site = await getWebsite(websiteId);
    if (!site)
        throw notFound('Website not found.');
    await col('websites').updateOne({ _id: websiteId }, { $set: { status, suspend_reason: reason, updated_at: nowIso() } });
    await audit({
        accountId: site.account_id, websiteId, actorType: 'super_admin', actorId,
        action: 'website.platform_status_changed', targetType: 'website', targetId: websiteId,
        metadata: { status, reason },
    });
}
function toDomainRow(d) {
    const { _id, ...rest } = d;
    return { id: _id, ...rest };
}
export async function listDomains(accountId, websiteId) {
    const docs = await col('website_domains')
        .find({ website_id: websiteId, account_id: accountId })
        .sort({ domain: 1 })
        .toArray();
    return docs.map(toDomainRow);
}
export async function addDomain(accountId, websiteId, raw) {
    await getWebsiteForAccount(accountId, websiteId);
    const host = normaliseHost(raw);
    if (!host)
        throw validationFailed('Enter a valid domain.', { domain: 'Enter a valid domain.' });
    const existing = await col('website_domains').findOne({ website_id: websiteId, domain: host });
    if (existing)
        return toDomainRow(existing);
    const id = newId();
    const doc = { _id: id, account_id: accountId, website_id: websiteId, domain: host, created_at: nowIso() };
    await col('website_domains').insertOne(doc);
    return toDomainRow(doc);
}
export async function removeDomain(accountId, websiteId, domainId) {
    await col('website_domains').deleteOne({ _id: domainId, website_id: websiteId, account_id: accountId });
}
/**
 * Authoritative host check used by every site-authenticated request.
 * Accepts the primary domain (with or without "www.") plus explicitly added
 * additional domains. Local/private hosts are accepted only when the website
 * itself is registered on a local host (development installs).
 */
export async function hostIsAllowedForWebsite(site, presentedHost) {
    const host = normaliseHost(presentedHost);
    if (!host)
        return false;
    if (canonicalHost(host) === site.primary_domain)
        return true;
    const extra = await col('website_domains').findOne({ website_id: site.id, domain: { $in: [host, canonicalHost(host)] } }, { projection: { _id: 1 } });
    if (extra)
        return true;
    if (isLocalHost(host) && isLocalHost(site.primary_domain))
        return true;
    return false;
}
export async function planLimitFor(accountId, key) {
    const account = await col('accounts').findOne({ _id: accountId }, { projection: { plan_id: 1 } });
    if (!account?.plan_id)
        return 0; // 0 == unlimited / unset
    const plan = await col('plans').findOne({ _id: account.plan_id }, { projection: { [key]: 1 } });
    const value = plan?.[key];
    return typeof value === 'number' ? value : 0;
}
