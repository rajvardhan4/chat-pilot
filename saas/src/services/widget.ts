/**
 * Widget configuration.
 *
 * `publicWidgetConfig` is the exact payload the WordPress plugin caches and
 * hands to the browser. It is an explicit allow-list: nothing is spread in
 * from a database row, so a new column can never leak to visitors by accident.
 */
import { col, nowIso, toBool } from '../db/mongo.ts';
import { newId } from '../core/crypto.ts';
import { audit } from './audit.ts';
import { getWebsiteForAccount } from './websites.ts';
import { getActiveForm } from './forms.ts';

export interface WidgetSettingsRow {
  id: string;
  account_id: string;
  website_id: string;
  enabled: number;
  display_name: string;
  position: string;
  primary_color: string;
  icon_color?: string;
  avatar_type?: string;
  launcher_icon_type?: string;
  launcher_callout_enabled?: number;
  launcher_callout_text?: string;
  launcher_callout_bg?: string;
  launcher_callout_color?: string;
  logo_url: string;
  welcome_message: string;
  placeholder_text: string;
  suggested_questions: string;
  enable_typing: number;
  enable_streaming: number;
  auto_open_chat: number;
  auto_open_delay: number;
  open_once_per_visitor: number;
  prechat_enabled: number;
  active_form_id: string | null;
  created_at: string;
  updated_at: string;
}

type WidgetDoc = Omit<WidgetSettingsRow, 'id'> & { _id: string };

function toWidgetRow(d: WidgetDoc): WidgetSettingsRow {
  const { _id, ...rest } = d;
  return { id: _id, ...rest };
}

export async function getWidgetSettings(accountId: string, websiteId: string): Promise<WidgetSettingsRow> {
  const row = await col<WidgetDoc>('widget_settings').findOne({ website_id: websiteId, account_id: accountId });
  if (row) return toWidgetRow(row);
  const id = newId();
  const now = nowIso();
  const doc: WidgetDoc = {
    _id: id, account_id: accountId, website_id: websiteId,
    enabled: 1, display_name: 'Chat Pilot', position: 'bottom-right', primary_color: '#0678f9',
    icon_color: '#ffffff', avatar_type: 'pilot', launcher_icon_type: 'bubble',
    launcher_callout_enabled: 1, launcher_callout_text: 'Ask any question 👋',
    launcher_callout_bg: '#16213a', launcher_callout_color: '#ffffff',
    logo_url: '', welcome_message: 'Hi there! How can I help you today?', placeholder_text: 'Ask a question...',
    suggested_questions: '', enable_typing: 1, enable_streaming: 1, auto_open_chat: 0, auto_open_delay: 5,
    open_once_per_visitor: 1, prechat_enabled: 1, active_form_id: null, created_at: now, updated_at: now,
  };
  await col<WidgetDoc>('widget_settings').insertOne(doc);
  return toWidgetRow(doc);
}

export interface WidgetPatch {
  enabled?: boolean;
  display_name?: string;
  position?: string;
  primary_color?: string;
  icon_color?: string;
  avatar_type?: string;
  launcher_icon_type?: string;
  launcher_callout_enabled?: boolean;
  launcher_callout_text?: string;
  launcher_callout_bg?: string;
  launcher_callout_color?: string;
  logo_url?: string;
  welcome_message?: string;
  placeholder_text?: string;
  suggested_questions?: string;
  enable_typing?: boolean;
  enable_streaming?: boolean;
  auto_open_chat?: boolean;
  auto_open_delay?: number;
  open_once_per_visitor?: boolean;
  prechat_enabled?: boolean;
  active_form_id?: string | null;
}

export async function updateWidgetSettings(
  accountId: string,
  websiteId: string,
  patch: WidgetPatch,
  actorId: string,
): Promise<WidgetSettingsRow> {
  await getWebsiteForAccount(accountId, websiteId);
  await getWidgetSettings(accountId, websiteId);

  const set: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
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

export interface PublicWidgetConfig {
  enabled: boolean;
  displayName: string;
  position: string;
  primaryColor: string;
  iconColor: string;
  avatarType: string;
  launcherIconType: string;
  launcherCalloutEnabled: boolean;
  launcherCalloutText: string;
  launcherCalloutBg: string;
  launcherCalloutColor: string;
  logoUrl: string;
  welcomeMessage: string;
  placeholderText: string;
  suggestedQuestions: string[];
  enableTyping: boolean;
  enableStreaming: boolean;
  autoOpenChat: boolean;
  autoOpenDelay: number;
  openOncePerVisitor: boolean;
  prechat: {
    enabled: boolean;
    formId: string;
    intro: string;
    fields: Array<{
      key: string;
      type: string;
      label: string;
      placeholder: string;
      options: string[];
      required: boolean;
    }>;
  };
  /** Bumped whenever anything above changes, so the plugin can cache safely. */
  configVersion: string;
}

export async function publicWidgetConfig(accountId: string, websiteId: string): Promise<PublicWidgetConfig> {
  const s = await getWidgetSettings(accountId, websiteId);
  // An explicit off switch beats any configured form: when the customer turns
  // pre-chat collection off, the widget must show no form at all.
  const form = toBool(s.prechat_enabled) ? await getActiveForm(accountId, websiteId) : null;

  return {
    enabled: toBool(s.enabled),
    displayName: s.display_name || 'Chat Pilot',
    position: s.position || 'bottom-right',
    primaryColor: s.primary_color || '#0678f9',
    iconColor: s.icon_color || '#ffffff',
    avatarType: s.avatar_type || 'pilot',
    launcherIconType: s.launcher_icon_type || 'bubble',
    launcherCalloutEnabled: s.launcher_callout_enabled !== undefined ? toBool(s.launcher_callout_enabled) : true,
    launcherCalloutText: s.launcher_callout_text || 'Ask any question 👋',
    launcherCalloutBg: s.launcher_callout_bg || '#16213a',
    launcherCalloutColor: s.launcher_callout_color || '#ffffff',
    logoUrl: s.logo_url || '',
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
          intro: 'Please introduce yourself to start the conversation.',
          fields: form.fields.map((f) => ({
            key: f.field_key,
            type: f.type,
            label: f.label,
            placeholder: f.placeholder,
            options: f.options.split('\n').map((o) => o.trim()).filter(Boolean),
            required: toBool(f.required),
          })),
        }
      : { enabled: false, formId: '', intro: '', fields: [] },
    configVersion: s.updated_at,
  };
}
