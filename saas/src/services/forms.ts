/**
 * Pre-chat forms, fields and submissions (leads).
 *
 * Validation runs server-side on the SaaS, so a tampered widget cannot bypass
 * required fields or inject extra columns.
 */
import { db, nowIso, toBool } from '../db/index.ts';
import { conflict, notFound, validationFailed } from '../core/errors.ts';
import { newId } from '../core/crypto.ts';
import { stripControlChars } from '../core/validate.ts';
import { audit } from './audit.ts';
import { getWebsiteForAccount } from './websites.ts';
import { notifyNewLead } from './notifications.ts';

export type FieldType = 'text' | 'email' | 'phone' | 'textarea' | 'dropdown' | 'checkbox' | 'radio';

export const FIELD_TYPES: FieldType[] = ['text', 'email', 'phone', 'textarea', 'dropdown', 'checkbox', 'radio'];

export interface FormFieldRow {
  id: string;
  form_id: string;
  field_key: string;
  type: FieldType;
  label: string;
  placeholder: string;
  options: string;
  required: number;
  enabled: number;
  sort_order: number;
}

export interface FormRow {
  id: string;
  account_id: string;
  website_id: string;
  name: string;
  is_default: number;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

export interface FormWithFields extends FormRow {
  fields: FormFieldRow[];
}

export function listForms(accountId: string, websiteId: string): FormWithFields[] {
  const forms = db.all<FormRow>(
    'SELECT * FROM forms WHERE website_id = ? AND account_id = ? ORDER BY is_default DESC, created_at ASC',
    websiteId, accountId,
  );
  return forms.map((f) => ({ ...f, fields: listFields(f.id) }));
}

export function listFields(formId: string): FormFieldRow[] {
  return db.all<FormFieldRow>(
    'SELECT * FROM form_fields WHERE form_id = ? ORDER BY sort_order ASC',
    formId,
  );
}

export function getForm(accountId: string, websiteId: string, formId: string): FormWithFields {
  const form = db.get<FormRow>(
    'SELECT * FROM forms WHERE id = ? AND website_id = ? AND account_id = ?',
    formId, websiteId, accountId,
  );
  if (!form) throw notFound('Form not found.');
  return { ...form, fields: listFields(form.id) };
}

/** The form the widget should render, honouring widget_settings.active_form_id. */
export function getActiveForm(accountId: string, websiteId: string): FormWithFields | null {
  const settings = db.get<{ active_form_id: string | null }>(
    'SELECT active_form_id FROM widget_settings WHERE website_id = ? AND account_id = ?',
    websiteId, accountId,
  );
  let form: FormRow | undefined;
  if (settings?.active_form_id) {
    form = db.get<FormRow>(
      "SELECT * FROM forms WHERE id = ? AND website_id = ? AND status = 'active'",
      settings.active_form_id, websiteId,
    );
  }
  if (!form) {
    form = db.get<FormRow>(
      "SELECT * FROM forms WHERE website_id = ? AND account_id = ? AND is_default = 1 AND status = 'active' LIMIT 1",
      websiteId, accountId,
    );
  }
  if (!form) return null;
  const fields = listFields(form.id).filter((f) => toBool(f.enabled));
  if (!fields.length) return null;
  return { ...form, fields };
}

export interface FieldInput {
  fieldKey?: string;
  type: FieldType;
  label: string;
  placeholder?: string;
  options?: string;
  required?: boolean;
  enabled?: boolean;
}

function normaliseKey(input: string, index: number): string {
  const key = String(input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return key || 'field_' + (index + 1);
}

export function saveForm(
  accountId: string,
  websiteId: string,
  input: { formId?: string; name: string; status?: 'active' | 'inactive'; fields: FieldInput[] },
  actorId: string,
): FormWithFields {
  getWebsiteForAccount(accountId, websiteId);
  const name = input.name.trim();
  if (!name) throw validationFailed('Give this form a name.', { name: 'A form name is required.' });
  if (!input.fields.length) {
    throw validationFailed('Add at least one field.', { fields: 'At least one field is required.' });
  }

  const seenKeys = new Set<string>();
  const fields = input.fields.map((f, index) => {
    if (!FIELD_TYPES.includes(f.type)) {
      throw validationFailed('Unsupported field type: ' + f.type, { fields: 'Unsupported field type.' });
    }
    const label = stripControlChars(f.label ?? '').trim();
    if (!label) throw validationFailed('Every field needs a label.', { fields: 'Every field needs a label.' });
    let key = normaliseKey(f.fieldKey ?? label, index);
    while (seenKeys.has(key)) key = key + '_' + (index + 1);
    seenKeys.add(key);
    if ((f.type === 'dropdown' || f.type === 'radio') && !(f.options ?? '').trim()) {
      throw validationFailed('Add options for "' + label + '".', { fields: 'Choice fields need options.' });
    }
    return {
      key,
      type: f.type,
      label: label.slice(0, 120),
      placeholder: stripControlChars(f.placeholder ?? '').trim().slice(0, 160),
      options: stripControlChars(f.options ?? '').trim().slice(0, 2000),
      required: f.required ? 1 : 0,
      enabled: f.enabled === false ? 0 : 1,
      order: index,
    };
  });

  const now = nowIso();
  const formId = input.formId ?? newId();

  db.tx(() => {
    if (input.formId) {
      const existing = db.get<FormRow>(
        'SELECT * FROM forms WHERE id = ? AND website_id = ? AND account_id = ?',
        input.formId, websiteId, accountId,
      );
      if (!existing) throw notFound('Form not found.');
      db.run(
        'UPDATE forms SET name = ?, status = ?, updated_at = ? WHERE id = ?',
        name, input.status ?? existing.status, now, formId,
      );
      db.run('DELETE FROM form_fields WHERE form_id = ?', formId);
    } else {
      db.run(
        `INSERT INTO forms (id, account_id, website_id, name, is_default, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
        formId, accountId, websiteId, name, input.status ?? 'active', now, now,
      );
    }

    for (const f of fields) {
      db.run(
        `INSERT INTO form_fields
           (id, account_id, website_id, form_id, field_key, type, label, placeholder, options, required, enabled, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId(), accountId, websiteId, formId, f.key, f.type, f.label,
        f.placeholder, f.options, f.required, f.enabled, f.order,
      );
    }
  });

  audit({
    accountId, websiteId, actorType: 'user', actorId,
    action: input.formId ? 'form.updated' : 'form.created', targetType: 'form', targetId: formId,
  });
  return getForm(accountId, websiteId, formId);
}

export function setDefaultForm(accountId: string, websiteId: string, formId: string): void {
  getForm(accountId, websiteId, formId);
  db.tx(() => {
    db.run('UPDATE forms SET is_default = 0 WHERE website_id = ? AND account_id = ?', websiteId, accountId);
    db.run('UPDATE forms SET is_default = 1 WHERE id = ?', formId);
    db.run(
      `UPDATE widget_settings SET active_form_id = ?, prechat_enabled = 1, updated_at = ?
        WHERE website_id = ? AND account_id = ?`,
      formId, nowIso(), websiteId, accountId,
    );
  });
}

/**
 * Chooses the widget's pre-chat form. Passing null is an explicit "no pre-chat
 * form" instruction, not "fall back to the default" - the two states are
 * different and visitors must see the difference.
 */
export function setActiveForm(accountId: string, websiteId: string, formId: string | null): void {
  if (formId) getForm(accountId, websiteId, formId);
  db.run(
    `UPDATE widget_settings SET active_form_id = ?, prechat_enabled = ?, updated_at = ?
      WHERE website_id = ? AND account_id = ?`,
    formId, formId ? 1 : 0, nowIso(), websiteId, accountId,
  );
}

export function duplicateForm(accountId: string, websiteId: string, formId: string, actorId: string): FormWithFields {
  const source = getForm(accountId, websiteId, formId);
  return saveForm(
    accountId, websiteId,
    {
      name: 'Copy of ' + source.name,
      status: 'active',
      fields: source.fields.map((f) => ({
        fieldKey: f.field_key,
        type: f.type,
        label: f.label,
        placeholder: f.placeholder,
        options: f.options,
        required: toBool(f.required),
        enabled: toBool(f.enabled),
      })),
    },
    actorId,
  );
}

export function deleteForm(accountId: string, websiteId: string, formId: string): void {
  const form = getForm(accountId, websiteId, formId);
  const count = db.scalar<number>(
    'SELECT COUNT(*) AS c FROM forms WHERE website_id = ? AND account_id = ?', websiteId, accountId,
  ) ?? 0;
  if (count <= 1) throw conflict('You cannot delete the only form for this website.');

  db.tx(() => {
    db.run('DELETE FROM forms WHERE id = ? AND website_id = ? AND account_id = ?', formId, websiteId, accountId);
    if (form.is_default) {
      const next = db.get<{ id: string }>(
        'SELECT id FROM forms WHERE website_id = ? AND account_id = ? LIMIT 1', websiteId, accountId,
      );
      if (next) setDefaultForm(accountId, websiteId, next.id);
    }
    db.run(
      'UPDATE widget_settings SET active_form_id = NULL WHERE website_id = ? AND active_form_id = ?',
      websiteId, formId,
    );
  });
}

/* --------------------------------------------------------- submissions -- */

export interface SubmissionResult {
  id: string;
  name: string;
  email: string;
  phone: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Validates a visitor submission against the form definition on the server.
 * Unknown keys are dropped; required and format rules are enforced here.
 */
export function submitForm(
  accountId: string,
  websiteId: string,
  input: {
    formId: string;
    values: Record<string, unknown>;
    sessionKey: string;
    pageUrl?: string;
    visitorKey?: string;
  },
): SubmissionResult {
  const form = getForm(accountId, websiteId, input.formId);
  if (form.status !== 'active') throw notFound('This form is no longer available.');

  const errors: Record<string, string> = {};
  const clean: Record<string, string> = {};

  for (const field of form.fields) {
    if (!toBool(field.enabled)) continue;
    const raw = input.values[field.field_key];
    const value = stripControlChars(typeof raw === 'string' ? raw : raw == null ? '' : String(raw))
      .trim()
      .slice(0, field.type === 'textarea' ? 4000 : 300);

    if (toBool(field.required) && !value) {
      errors[field.field_key] = field.label + ' is required.';
      continue;
    }
    if (!value) continue;

    if (field.type === 'email' && !EMAIL_RE.test(value)) {
      errors[field.field_key] = 'Enter a valid email address for ' + field.label + '.';
      continue;
    }
    if (field.type === 'phone' && value.replace(/\D/g, '').length < 5) {
      errors[field.field_key] = 'Enter a valid phone number for ' + field.label + '.';
      continue;
    }
    if (field.type === 'dropdown' || field.type === 'radio') {
      const allowed = field.options.split('\n').map((o) => o.trim()).filter(Boolean);
      if (allowed.length && !allowed.includes(value)) {
        errors[field.field_key] = 'Choose one of the available options for ' + field.label + '.';
        continue;
      }
    }
    clean[field.field_key] = value;
  }

  if (Object.keys(errors).length) {
    throw validationFailed(Object.values(errors)[0] as string, errors);
  }

  const id = newId();
  const name = clean.name ?? clean.full_name ?? '';
  const email = clean.email ?? '';
  const phone = clean.phone ?? '';

  const conversation = db.get<{ id: string }>(
    'SELECT id FROM conversations WHERE website_id = ? AND session_key = ?',
    websiteId, input.sessionKey,
  );
  const visitor = input.visitorKey
    ? db.get<{ id: string }>('SELECT id FROM visitors WHERE website_id = ? AND visitor_key = ?', websiteId, input.visitorKey)
    : undefined;

  db.run(
    `INSERT INTO form_submissions
       (id, account_id, website_id, form_id, conversation_id, visitor_id, session_key,
        name, email, phone, fields, page_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, accountId, websiteId, form.id, conversation?.id ?? null, visitor?.id ?? null,
    input.sessionKey, name, email, phone, JSON.stringify(clean),
    (input.pageUrl ?? '').slice(0, 2000), nowIso(),
  );

  if (conversation) {
    db.run(
      `UPDATE conversations SET form_id = ?,
              visitor_name  = CASE WHEN ? <> '' THEN ? ELSE visitor_name END,
              visitor_email = CASE WHEN ? <> '' THEN ? ELSE visitor_email END,
              visitor_phone = CASE WHEN ? <> '' THEN ? ELSE visitor_phone END
        WHERE id = ? AND website_id = ?`,
      form.id, name, name, email, email, phone, phone, conversation.id, websiteId,
    );
  }

  notifyNewLead({
    account_id: accountId, website_id: websiteId, id,
    name, email, phone, page_url: input.pageUrl ?? '',
  });

  return { id, name, email, phone };
}

export interface SubmissionRow {
  id: string;
  account_id: string;
  website_id: string;
  form_id: string;
  conversation_id: string | null;
  session_key: string;
  name: string;
  email: string;
  phone: string;
  fields: string;
  page_url: string;
  created_at: string;
}

export function listSubmissions(
  accountId: string,
  websiteId: string,
  filter: { formId?: string; search?: string; limit?: number; offset?: number } = {},
): SubmissionRow[] {
  const where = ['website_id = ?', 'account_id = ?'];
  const params: unknown[] = [websiteId, accountId];
  if (filter.formId) {
    where.push('form_id = ?');
    params.push(filter.formId);
  }
  if (filter.search) {
    where.push('(name LIKE ? OR email LIKE ? OR phone LIKE ?)');
    const like = '%' + filter.search.replace(/[%_]/g, '') + '%';
    params.push(like, like, like);
  }
  params.push(Math.min(filter.limit ?? 50, 200), filter.offset ?? 0);
  return db.all<SubmissionRow>(
    `SELECT * FROM form_submissions WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ...params,
  );
}

export function getSubmission(accountId: string, websiteId: string, id: string): SubmissionRow {
  const row = db.get<SubmissionRow>(
    'SELECT * FROM form_submissions WHERE id = ? AND website_id = ? AND account_id = ?',
    id, websiteId, accountId,
  );
  if (!row) throw notFound('Submission not found.');
  return row;
}

export function deleteSubmission(accountId: string, websiteId: string, id: string): void {
  getSubmission(accountId, websiteId, id);
  db.run(
    'DELETE FROM form_submissions WHERE id = ? AND website_id = ? AND account_id = ?',
    id, websiteId, accountId,
  );
}
