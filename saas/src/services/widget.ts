/**
 * Widget configuration.
 *
 * `publicWidgetConfig` is the exact payload the WordPress plugin caches and
 * hands to the browser. It is an explicit allow-list: nothing is spread in
 * from a database row, so a new column can never leak to visitors by accident.
 */
import { db, nowIso, toBool } from '../db/index.ts';
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

export function getWidgetSettings(accountId: string, websiteId: string): WidgetSettingsRow {
  const row = db.get<WidgetSettingsRow>(
    'SELECT * FROM widget_settings WHERE website_id = ? AND account_id = ?',
    websiteId, accountId,
  );
  if (row) return row;
  const id = newId();
  const now = nowIso();
  db.run(
    'INSERT INTO widget_settings (id, account_id, website_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    id, accountId, websiteId, now, now,
  );
  return db.get<WidgetSettingsRow>('SELECT * FROM widget_settings WHERE id = ?', id)!;
}

export interface WidgetPatch {
  enabled?: boolean;
  display_name?: string;
  position?: string;
  primary_color?: string;
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

export function updateWidgetSettings(
  accountId: string,
  websiteId: string,
  patch: WidgetPatch,
  actorId: string,
): WidgetSettingsRow {
  getWebsiteForAccount(accountId, websiteId);
  getWidgetSettings(accountId, websiteId);

  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    sets.push(key + ' = ?');
    params.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
  }
  if (sets.length) {
    sets.push('updated_at = ?');
    params.push(nowIso(), websiteId, accountId);
    db.run(`UPDATE widget_settings SET ${sets.join(', ')} WHERE website_id = ? AND account_id = ?`, ...params);
    audit({
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

export function publicWidgetConfig(accountId: string, websiteId: string): PublicWidgetConfig {
  const s = getWidgetSettings(accountId, websiteId);
  // An explicit off switch beats any configured form: when the customer turns
  // pre-chat collection off, the widget must show no form at all.
  const form = toBool(s.prechat_enabled) ? getActiveForm(accountId, websiteId) : null;

  return {
    enabled: toBool(s.enabled),
    displayName: s.display_name || 'Chat Pilot',
    position: s.position || 'bottom-right',
    primaryColor: s.primary_color || '#0678f9',
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
