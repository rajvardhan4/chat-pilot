/**
 * Widget configuration.
 *
 * `publicWidgetConfig` is the exact payload the WordPress plugin caches and
 * hands to the browser. It is an explicit allow-list: nothing is spread in
 * from a database row, so a new column can never leak to visitors by accident.
 */
import { col, nowIso, toBool } from "../db/mongo.js";
import { newId } from "../core/crypto.js";
import { env } from "../config/env.js";
import { audit } from "./audit.js";
import { getWebsiteForAccount } from "./websites.js";
import { getActiveForm } from "./forms.js";
function toWidgetRow(d) {
    const { _id, ...rest } = d;
    return {
        id: _id,
        icon_color: '#ffffff',
        avatar_type: 'pilot',
        launcher_icon_type: 'bubble',
        launcher_callout_enabled: 1,
        launcher_callout_text: 'Ask any question 👋',
        prechat_enabled: 1,
        prechat_intro: 'Please introduce yourself to start the conversation.',
        ...rest,
    };
}
export async function getWidgetSettings(accountId, websiteId) {
    const row = await col('widget_settings').findOne({ website_id: websiteId, account_id: accountId });
    if (row)
        return toWidgetRow(row);
    const id = newId();
    const now = nowIso();
    const doc = {
        _id: id, account_id: accountId, website_id: websiteId,
        enabled: 1, display_name: 'Chat Pilot', position: 'bottom-right', primary_color: '#0678f9',
        icon_color: '#ffffff', avatar_type: 'pilot', launcher_icon_type: 'bubble',
        launcher_callout_enabled: 1, launcher_callout_text: 'Ask any question 👋',
        logo_url: '', welcome_message: 'Hi there! How can I help you today?', placeholder_text: 'Ask a question...',
        suggested_questions: '', enable_typing: 1, enable_streaming: 1, auto_open_chat: 0, auto_open_delay: 5,
        open_once_per_visitor: 1, prechat_enabled: 1, active_form_id: null, created_at: now, updated_at: now,
    };
    await col('widget_settings').insertOne(doc);
    return toWidgetRow(doc);
}
export async function updateWidgetSettings(accountId, websiteId, patch, actorId) {
    await getWebsiteForAccount(accountId, websiteId);
    await getWidgetSettings(accountId, websiteId);
    const set = {};
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined)
            continue;
        set[key] = typeof value === 'boolean' ? (value ? 1 : 0) : value;
    }
    if (Object.keys(set).length) {
        set.updated_at = nowIso();
        await col('widget_settings').updateOne({ website_id: websiteId, account_id: accountId }, { $set: set });
        await audit({
            accountId, websiteId, actorType: 'user', actorId,
            action: 'widget.updated', targetType: 'website', targetId: websiteId,
            metadata: { fields: Object.keys(patch) },
        });
    }
    return getWidgetSettings(accountId, websiteId);
}
export async function publicWidgetConfig(accountId, websiteId) {
    const s = await getWidgetSettings(accountId, websiteId);
    // An explicit off switch beats any configured form: when the customer turns
    // pre-chat collection off, the widget must show no form at all.
    const form = toBool(s.prechat_enabled) ? await getActiveForm(accountId, websiteId) : null;
    const avatarType = s.avatar_type || 'pilot';
    let effectiveLogoUrl = s.logo_url || '';
    if (avatarType !== 'custom' || !effectiveLogoUrl) {
        const knownAvatars = ['pilot', 'female', 'male', 'robot', 'sparkle'];
        const chosen = knownAvatars.includes(avatarType) ? avatarType : 'pilot';
        effectiveLogoUrl = `${env.APP_URL}/assets/img/avatars/avatar-${chosen}.svg`;
    }
    return {
        enabled: toBool(s.enabled),
        displayName: s.display_name || 'Chat Pilot',
        position: s.position || 'bottom-right',
        primaryColor: s.primary_color || '#0678f9',
        iconColor: s.icon_color || '#ffffff',
        avatarType,
        launcherIconType: s.launcher_icon_type || 'bubble',
        launcherCalloutEnabled: s.launcher_callout_enabled !== undefined ? toBool(s.launcher_callout_enabled) : true,
        launcherCalloutText: s.launcher_callout_text || 'Ask any question 👋',
        logoUrl: effectiveLogoUrl,
        welcomeMessage: s.welcome_message || 'Hi there! How can I help you today?',
        placeholderText: s.placeholder_text || 'Ask a question...',
        suggestedQuestions: (s.suggested_questions || '')
            .split('\n')
            .map((q) => q.trim())
            .filter(Boolean)
            .slice(0, 6),
        enableTyping: toBool(s.enable_typing),
        enableStreaming: toBool(s.enable_streaming),
        autoOpenChat: toBool(s.auto_open_chat),
        autoOpenDelay: Number(s.auto_open_delay ?? 5),
        openOncePerVisitor: toBool(s.open_once_per_visitor),
        prechat: form
            ? {
                enabled: true,
                formId: form.id,
                intro: s.prechat_intro || 'Please introduce yourself to start the conversation.',
                fields: form.fields.map((f) => ({
                    key: f.field_key,
                    type: f.type,
                    label: f.label,
                    placeholder: f.placeholder,
                    options: (f.options || '').split('\n').map((o) => o.trim()).filter(Boolean),
                    required: toBool(f.required),
                })),
            }
            : { enabled: false, formId: '', intro: '', fields: [] },
        configVersion: s.updated_at,
    };
}
